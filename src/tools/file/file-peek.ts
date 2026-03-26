/**
 * File peek tool - quick preview without loading
 */

import { BaseTool } from "../base-tool";
import { ToolCall, ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";
import * as fs from "fs";
import { formatDisplayLine } from "../../utils/str";

export class FilePeekTool extends BaseTool {
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "peek",
            description: `Quick preview of file content WITHOUT loading into workspace.

USE THIS WHEN:
- Verifying exact line content before editing (find anchors)
- Checking content outside your currently loaded range
- Scouting for the right lines to edit

DO NOT USE WHEN:
- You need the content available for editing (use file.load instead)
- You want to load large portions of the file (use file.load instead)

This tool is lightweight and doesn't affect your workspace context.`,
            params: {
                path: { type: "string", description: "File path to peek" },
                start: {
                    type: "number",
                    optional: true,
                    description: "Start line (1-indexed, default: 1)",
                },
                end: {
                    type: "number",
                    optional: true,
                    description: "End line (optional, max 30 lines from start if not specified)",
                },
            },
            returns: {
                lines: "Array of line strings",
                total_lines: "Total lines in file",
                preview_range: "[start, end] range shown",
            },
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.peek",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { path: filePath, start, end } = validation.data as {
            path: string;
            start?: number;
            end?: number;
        };

        try {
            const absolutePath = await this.workspace.resolveReadableFilePath(filePath);

            const content = await fs.promises.readFile(absolutePath, "utf-8");
            const allLines = content.split("\n");
            const totalLines = allLines.length;

            const startLine = Math.max(1, start || 1);
            const maxLines = 30;

            let endLine: number;
            if (end !== undefined) {
                endLine = Math.min(end, startLine + maxLines - 1);
            } else {
                endLine = Math.min(startLine + maxLines - 1, totalLines);
            }
            endLine = Math.max(endLine, startLine);
            endLine = Math.min(endLine, totalLines);

            if (startLine > totalLines) {
                return this.error(
                    "OUT_OF_RANGE",
                    `Start line ${startLine} exceeds total lines ${totalLines}`,
                    { path: filePath, start: startLine, total_lines: totalLines },
                    "Use a start line within the file's range",
                );
            }

            const lines: string[] = [];
            for (let i = startLine; i <= endLine; i++) {
                lines.push(formatDisplayLine(i, allLines[i - 1]));
            }

            return this.success({
                lines,
                total_lines: totalLines,
                preview_range: [startLine, endLine],
                _note: "Peeked content not loaded into workspace. Use file.load to load for editing.",
            });
        } catch (error) {
            return this.error(
                "FILE_ERROR",
                `Failed to peek file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath, start, end },
                "Check if the file exists and is readable",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.lines) {
            const lines = result.data.lines as string[];
            const [start, end] = result.data.preview_range as [number, number];
            const total = result.data.total_lines as number;
            const formatted = lines.join("\n");

            const warning = "\n\x1b[33m⚠ Peeked content not loaded into workspace. Use file.load to load for editing.\x1b[0m";
            return `\x1b[32m✓\x1b[0m Peeked lines ${start}-${end} of ${total}:\n${formatted}${warning}`;
        }
        return undefined;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (!result.success || !result.data?.lines || !result.data?.preview_range) {
            return super.formatResultForLLM(toolCall, result);
        }

        const filePath = typeof toolCall.params.path === "string" ? toolCall.params.path : "unknown file";
        const [start, end] = result.data.preview_range as [number, number];
        const total = result.data.total_lines as number;
        const lines = result.data.lines as string[];
        const note = typeof result.data._note === "string" ? result.data._note : "";

        return [
            `Peeked ${filePath}`,
            `Lines ${start}-${end} of ${total}`,
            "",
            ...lines,
            "",
            note ? note : "",
        ]
            .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))
            .join("\n");
    }
}
