/**
 * File load tool
 */

import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const fileLoadSchema = z.object({
    path: z.string(),
    start: z.number().optional(),
    end: z.number().optional(),
});

type FileLoadParams = z.infer<typeof fileLoadSchema>;

export class FileLoadTool extends BaseTool<typeof fileLoadSchema> {
    protected schema = fileLoadSchema;
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

    async run(params: FileLoadParams): Promise<ToolResult> {
        const { path, start, end } = params;

        try {
            const entry = await this.workspace.loadFile(path, start, end);

            return this.success({
                total_lines: entry.totalLines,
                loaded_range: entry.ranges.map((range) => [range.start, range.end]),
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
        if (
            result.success &&
            result.data &&
            typeof result.data.total_lines === "number" &&
            Array.isArray(result.data.loaded_range)
        ) {
            const ranges = result.data.loaded_range.filter((r): r is [number, number] => {
                return (
                    Array.isArray(r) &&
                    r.length >= 2 &&
                    typeof r[0] === "number" &&
                    typeof r[1] === "number"
                );
            });
            const total = result.data.total_lines;
            const totalLoaded = ranges.reduce((sum, r) => sum + (r[1] - r[0] + 1), 0);
            const rangeStr = ranges.map((r) => `${r[0]}-${r[1]}`).join(", ");
            return `\x1b[32m\x1b[1m✓\x1b[0m Loaded ${totalLoaded} lines (${rangeStr}) of ${total} total`;
        }
        return undefined;
    }
}
