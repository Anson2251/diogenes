import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolCall, ToolResult } from "../../types";
import { computeMyersLineDiffHunks } from "../../utils/str";
import { BaseTool } from "../base-tool";

const matchPreviewSchema = z.object({ line: z.number(), preview: z.string() });
const fileStateSchema = z.object({ total_lines: z.number().optional() }).loose();
const rangeSchema = z.object({ start: z.number(), end: z.number() });
const workspaceUpdateSchema = z.object({
    loaded_ranges: z.array(rangeSchema).optional(),
    total_lines_in_workspace: z.number().optional(),
}).loose();

const fileEditSchema = z.object({
    path: z.string(),
    oldString: z.string(),
    newString: z.string(),
    approxLineNumber: z.number().optional(),
});

type FileEditParams = z.infer<typeof fileEditSchema>;

export class FileEditTool extends BaseTool<typeof fileEditSchema> {
    protected schema = fileEditSchema;
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "edit",
            description: `Find and replace text in a file.

Parameters:
  - path: file path
  - oldString: the exact text to find (must match verbatim)
  - newString: the replacement text
  - approxLineNumber: optional line number to disambiguate when oldString appears multiple times

The tool finds oldString in the file and replaces it with newString.
If oldString is found exactly once, the replacement is applied.
If multiple matches exist and approxLineNumber is provided, the match is used only if exactly one match falls within ±10 lines of the approximate line. If multiple matches are within that window, an error is raised asking for more unique context.
If multiple matches exist and no approxLineNumber is given, the tool returns an error listing all match locations so you can pick one.

Always read the file first with file.load to get exact content before editing. Copy text verbatim — never paraphrase.
`,
            params: {
                path: { type: "string", description: "File path" },
                oldString: { type: "string", description: "The exact text to find and replace" },
                newString: { type: "string", description: "The replacement text" },
                approxLineNumber: { type: "number", optional: true, description: "Approximate line number to disambiguate multiple matches" },
            },
            returns: {
                success: "Whether the edit succeeded",
                match_line: "Line number where the match was found",
                match_count: "Total number of matches for oldString in the file",
                file_state: "File state after edits",
            },
        });
        this.workspace = workspace;
        this.workspaceRoot = workspace.getWorkspaceRoot();
    }

    async run(params: FileEditParams): Promise<ToolResult> {
        const { path: filePath, oldString, newString, approxLineNumber } = params;

        try {
            const absolutePath = this.resolvePath(filePath);
            await this.validatePath(absolutePath);

            const content = await fs.promises.readFile(absolutePath, "utf-8");

            const matches = this.findAllMatches(content, oldString);

            if (matches.length === 0) {
                const searchLines = approxLineNumber
                    ? this.getSurroundingLines(content, approxLineNumber)
                    : "";
                return this.error(
                    "NO_MATCH",
                    `oldString not found in file. Use file.peek to re-read exact content.`,
                    {
                        oldString,
                        ...(searchLines ? { surrounding_context: searchLines } : {}),
                    },
                );
            }

            let matchIndex: number;
            let matchLine: number;

            if (matches.length > 1) {
                if (approxLineNumber === undefined) {
                    return this.error(
                        "AMBIGUOUS_MATCH",
                        `oldString found ${matches.length} times. Provide approxLineNumber to disambiguate, or use a more unique oldString.`,
                        {
                            oldString,
                            matchCount: matches.length,
                            matchLines: matches.map((m) => m.line),
                            matchPreviews: matches.map((m) => ({
                                line: m.line,
                                preview: this.getPreviewLine(content, m.index),
                            })),
                        },
                    );
                }

                const windowMatches = matches.filter((m) => Math.abs(m.line - approxLineNumber) <= 10);
                if (windowMatches.length !== 1) {
                    return this.error(
                        "AMBIGUOUS_MATCH",
                        `oldString found ${matches.length} times, ${windowMatches.length} within ±10 lines of line ${approxLineNumber}. Include surrounding lines in oldString for unique matching.`,
                        {
                            oldString,
                            approxLineNumber,
                            matchCount: matches.length,
                            matchLines: matches.map((m) => m.line),
                            matchPreviews: matches.map((m) => ({
                                line: m.line,
                                preview: this.getPreviewLine(content, m.index),
                            })),
                            nearMatchLines: windowMatches.map((m) => m.line),
                        },
                    );
                }

                matchIndex = windowMatches[0].index;
                matchLine = windowMatches[0].line;
            } else {
                matchIndex = matches[0].index;
                matchLine = matches[0].line;
            }

            const newContent = content.slice(0, matchIndex) + newString + content.slice(matchIndex + oldString.length);

            await fs.promises.writeFile(absolutePath, newContent, "utf-8");

            const newLines = newContent.split("\n");
            const oldLineCount = oldString.split("\n").length;
            const newLineCount = newString.split("\n").length;

            const applied = [
                {
                    matchedRange: [matchLine, matchLine + oldLineCount - 1] as [number, number],
                    newRange: [matchLine, matchLine + newLineCount - 1] as [number, number],
                },
            ];

            const workspaceUpdate = await this.workspace.syncLoadedFileAfterEdit(filePath, applied);

            return this.success({
                match_line: matchLine,
                match_count: matches.length,
                file_state: {
                    total_lines: newLines.length,
                    modified_regions: [applied[0].newRange],
                },
                workspace_update: workspaceUpdate,
                _diff: {
                    path: absolutePath,
                    oldText: content,
                    newText: newContent,
                    hunks: computeMyersLineDiffHunks(content, newContent),
                },
            });
        } catch (error) {
            return this.error(
                "FILE_EDIT_ERROR",
                `Failed to edit file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath },
                "Check if the file exists and is writable",
            );
        }
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success) {
            const data = result.data as Record<string, unknown> | undefined;
            const line: unknown = data?.match_line;
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Replaced at line ${String(line)}`,
            ].join("\n");
        }

        const details = result.error?.details;
        const matchLines = Array.isArray(details?.matchLines) ? details.matchLines : [];
        return [
            `[FAIL] ${toolCall.tool}`,
            "---",
            result.error?.message ?? "",
            ...(matchLines.length
                ? [`Matches at lines: ${matchLines.join(", ")}`]
                : []),
        ].join("\n");
    }

    private findAllMatches(content: string, search: string): Array<{ index: number; line: number }> {
        const matches: Array<{ index: number; line: number }> = [];
        let startIndex = 0;

        while (startIndex < content.length) {
            const idx = content.indexOf(search, startIndex);
            if (idx === -1) break;

            const linesBefore = content.slice(0, idx).split("\n");
            const foundLine = linesBefore.length;

            matches.push({ index: idx, line: foundLine });
            startIndex = idx + 1;
        }

        return matches;
    }

    private getPreviewLine(content: string, index: number): string {
        const after = content.slice(index);
        const endOfLine = after.indexOf("\n");
        return endOfLine === -1 ? after : after.slice(0, endOfLine);
    }

    private getSurroundingLines(content: string, centerLine: number): string {
        const lines = content.split("\n");
        const start = Math.max(0, centerLine - 3);
        const end = Math.min(lines.length, centerLine + 2);
        const result: string[] = [];
        for (let i = start; i < end; i++) {
            result.push(`${i + 1}: ${lines[i]}`);
        }
        return result.join("\n");
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data) {
            const data = result.data as Record<string, unknown>;
            const lineNumber = z.number().safeParse(data.match_line);
            const line = lineNumber.success ? lineNumber.data : 0;
            const parsedFileState = fileStateSchema.safeParse(data.file_state);
            const fileState = parsedFileState.success ? parsedFileState.data : {};
            const totalLines = typeof fileState.total_lines === "number" ? fileState.total_lines : 0;
 const workspaceUpdate = data.workspace_update;

            const lines: string[] = [
                `\x1b[32m\x1b[1m✓\x1b[0m Replaced at line ${String(line)}, ${String(totalLines)} total lines`,
            ];

            if (workspaceUpdate && typeof workspaceUpdate === "object") {
                const workspaceUpdateParsed = workspaceUpdateSchema.safeParse(workspaceUpdate);
                const workspaceUpdateObj = workspaceUpdateParsed.success ? workspaceUpdateParsed.data : {};
                const loadedRangesRaw = workspaceUpdateObj.loaded_ranges;
                const loadedRanges = Array.isArray(loadedRangesRaw) ? loadedRangesRaw : [];
                const totalLinesWs = workspaceUpdateObj.total_lines_in_workspace;
                const totalLinesInWorkspace = typeof totalLinesWs === "number" ? totalLinesWs : 0;
                const rangeStrParts: string[] = [];
                for (const r of loadedRanges) {
                    const parsed = rangeSchema.safeParse(r);
                    if (parsed.success) {
                        rangeStrParts.push(`${parsed.data.start}-${parsed.data.end}`);
                    }
                }
                const rangeStr = rangeStrParts.join(", ");
                lines.push(
                    `\x1b[36mWorkspace:\x1b[0m ${String(totalLinesInWorkspace)} lines loaded (${rangeStr})`,
                );
            }

            return lines.join("\n");
        }

        const failureLines = this.formatReadableFailure(result);
        return failureLines ? failureLines.join("\n") : undefined;
    }

    private formatReadableFailure(result: ToolResult, filePath?: string): string[] | null {
        if (result.success || !result.error) return null;
        const target = filePath ?? "the target file";
        const lines: string[] = [];

        if (result.error.code === "INVALID_PARAMS") {
            lines.push(`Invalid parameters for file.edit on ${target}`);
            const details = result.error.details;
            if (details?.issues && Array.isArray(details.issues)) {
                const issuesSchema = z.array(z.object({ path: z.unknown().optional(), message: z.unknown().optional() }).loose());
                const parsedIssues = issuesSchema.safeParse(details.issues);
                const issues = parsedIssues.success ? parsedIssues.data : [];
                for (const issue of issues) {
                    const issuePath = Array.isArray(issue.path) ? (issue.path as unknown[]).join(".") : "(root)";
                    lines.push(`  ${issuePath}: ${String(issue.message)}`);
                }
            } else {
                lines.push(result.error.message);
            }
            return lines;
        }

        lines.push(`Could not edit ${target}`);
        lines.push(result.error.message);
        const details = result.error.details;
        if (details?.matchLines && Array.isArray(details.matchLines)) {
            const matchLinesArr = z.array(z.number()).safeParse(details.matchLines);
            if (matchLinesArr.success) {
                lines.push(`Matches found at lines: ${matchLinesArr.data.join(", ")}`);
            }
        }
        if (details?.nearMatchLines && Array.isArray(details.nearMatchLines)) {
            const nearMatchLinesArr = z.array(z.number()).safeParse(details.nearMatchLines);
            if (nearMatchLinesArr.success) {
                lines.push(`Near matches (within ±10): ${nearMatchLinesArr.data.join(", ")}`);
            }
        }
        if (details?.matchPreviews && Array.isArray(details.matchPreviews)) {
            const matchPreviewsArr = z.array(matchPreviewSchema).safeParse(details.matchPreviews);
            if (matchPreviewsArr.success) {
                for (const mp of matchPreviewsArr.data) {
                    lines.push(`  Line ${mp.line}: ${mp.preview}`);
                }
            }
        }
        if (details?.surrounding_context) {
            lines.push("");
            lines.push("Context around requested line:");
            lines.push(String(details.surrounding_context));
        }
        if (typeof result.error.suggestion === "string" && result.error.suggestion.length > 0) {
            lines.push("");
            lines.push(result.error.suggestion);
        }

        return lines;
    }

    private resolvePath(inputPath: string): string {
        const resolved = path.isAbsolute(inputPath)
            ? path.resolve(inputPath)
            : path.resolve(this.workspaceRoot, inputPath);

        const relative = path.relative(this.workspaceRoot, resolved);
        if (relative.startsWith("..") || relative === "..") {
            throw new Error(`Path ${resolved} is outside workspace root ${this.workspaceRoot}`);
        }

        return resolved;
    }

    private async validatePath(absolutePath: string): Promise<void> {
        try {
            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) {
                throw new Error(`Path ${absolutePath} is not a file`);
            }
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                throw new Error(`File ${absolutePath} does not exist`);
            }
            throw error;
        }
    }
}
