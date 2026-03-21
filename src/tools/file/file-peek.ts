/**
 * File peek tool - quick preview without loading
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";
import * as fs from "fs";
import * as path from "path";

export class FilePeekTool extends BaseTool {
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "peek",
            description: "Quick preview of file (max 10 lines) without loading into workspace. Use file.load instead for full context awareness.",
            params: {
                path: { type: "string", description: "File path to peek" },
                start: {
                    type: "number",
                    optional: true,
                    description: "Start line (1-indexed, default: 1)",
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

        const { path: filePath, start } = validation.data as {
            path: string;
            start?: number;
        };

        try {
            const absolutePath = this.resolvePath(filePath);

            const content = await fs.promises.readFile(absolutePath, "utf-8");
            const allLines = content.split("\n");
            const totalLines = allLines.length;

            const startLine = Math.max(1, start || 1);
            const maxLines = 10;
            const endLine = Math.min(startLine + maxLines - 1, totalLines);

            if (startLine > totalLines) {
                return this.error(
                    "OUT_OF_RANGE",
                    `Start line ${startLine} exceeds total lines ${totalLines}`,
                    { path: filePath, start: startLine, total_lines: totalLines },
                    "Use a start line within the file's range",
                );
            }

            const lines = allLines.slice(startLine - 1, endLine).map(l => l.replace(/\r$/, ""));

            return this.success({
                lines,
                total_lines: totalLines,
                preview_range: [startLine, endLine],
                _note: "Peek does not load file into workspace. Use file.load for context-aware editing.",
            });
        } catch (error) {
            return this.error(
                "FILE_ERROR",
                `Failed to peek file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath, start },
                "Check if the file exists and is readable",
            );
        }
    }

    private resolvePath(filePath: string): string {
        const root = (this.workspace as any).workspaceRoot as string;
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        return path.resolve(root, filePath);
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.lines) {
            const lines = result.data.lines as string[];
            const [start, end] = result.data.preview_range as [number, number];
            const total = result.data.total_lines as number;

            const padWidth = String(end).length;
            const formatted = lines.map((line, i) => {
                const lineNum = String(start + i).padStart(padWidth, " ");
                return `${lineNum}| ${line}`;
            }).join("\n");

            const warning = "\n\x1b[33m⚠ Not loaded into workspace. Use file.load for editing.\x1b[0m";
            return `\x1b[32m✓\x1b[0m Peeking lines ${start}-${end} of ${total}:\n${formatted}${warning}`;
        }
        return undefined;
    }
}
