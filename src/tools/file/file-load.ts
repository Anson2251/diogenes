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
                total_lines: "Total lines in file",
                loaded_range: "Array of [start, end] lines loaded",
            },
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.load",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { path, start, end } = validation.data as {
            path: string;
            start?: number;
            end?: number;
        };

        try {
            const entry = await this.workspace.loadFile(path, start, end);

            return this.success({
                total_lines: entry.totalLines,
                loaded_range: entry.ranges.map((range) => [
                    range.start,
                    range.end,
                ]),
            });
        } catch (error) {
            return this.error(
                "FILE_ERROR",
                `Failed to load file ${path}: ${error instanceof Error ? error.message : String(error)}`,
                { path, start, end },
                "Check if the file exists, is readable, and the line range is valid",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.loaded_range) {
            const ranges = result.data.loaded_range as [number, number][];
            const total = result.data.total_lines;
            const totalLoaded = ranges.reduce((sum, r) => sum + (r[1] - r[0] + 1), 0);
            const rangeStr = ranges.map((r) => `${r[0]}-${r[1]}`).join(", ");
            return `\x1b[32m\x1b[1m✓\x1b[0m Loaded ${totalLoaded} lines (${rangeStr}) of ${total} total`;
        }
        return undefined;
    }
}
