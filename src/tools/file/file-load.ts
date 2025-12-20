/**
 * File load tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";

export class FileLoadTool extends BaseTool {
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "load",
            description: "Load file content into workspace",
            params: {
                path: { type: "string", description: "File path" },
                start: {
                    type: "number",
                    optional: true,
                    description: "Start line (1-indexed)",
                },
                end: {
                    type: "number",
                    optional: true,
                    description: "End line (inclusive)",
                },
            },
            returns: {
                content: "File content as string",
                total_lines: "Total lines in file",
                loaded_range: "Array of [start, end] lines loaded",
            },
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validated = params as {
            path: string;
            start?: number;
            end?: number;
        };

        try {
            const entry = await this.workspace.loadFile(
                validated.path,
                validated.start,
                validated.end,
            );

            return this.success({
                content: entry.content.join("\n"),
                total_lines: entry.totalLines,
                loaded_range: entry.ranges.map((range) => [
                    range.start,
                    range.end,
                ]),
            });
        } catch (error) {
            return this.error(
                "FILE_ERROR",
                `Failed to load file ${validated.path}: ${error instanceof Error ? error.message : String(error)}`,
                {
                    path: validated.path,
                    start: validated.start,
                    end: validated.end,
                },
                "Check if the file exists, is readable, and the line range is valid",
            );
        }
    }
}
