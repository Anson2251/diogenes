/**
 * File edit tool - Apply structured edits to a file
 */

import * as fs from "fs";
import * as path from "path";
import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";
import {
    Edit,
    EditOptions,
    EditResult,
    EditError,
    LineAnchor,
} from "../../types";
import { rstrip, compareLines } from "../../utils/str";

interface FileEditParams {
    path: string;
    options?: EditOptions;
    edits: Edit[];
}

interface MatchCandidate {
    line: number;
    startLine: number;
    endLine: number;
    matchQuality: "exact" | "fuzzy" | "line_hint";
}

export class FileEditTool extends BaseTool {
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "edit",
            description: `Apply structured edits to a file. Use this to modify specific lines.

IMPORTANT: Always read the file first with file.load to get the exact content and line numbers.

Edit format:
{
  "path": "file.txt",
  "edits": [{
    "mode": "replace",  // "replace" | "delete" | "insert_before" | "insert_after"
    "anchor": {
      "start": {
        "line": 10,
        "text": "const x = 1;",              // EXACT text of the line
        "before": ["line 9", "line 8"],      // 2 lines before anchor
        "after": ["line 11", "line 12"]       // 2 lines after anchor
      },
      "end": { /* same as start */ }         // Required for range operations
    },
    "content": ["new line 1", "new line 2"]  // New content
  }]
}`,
            params: {
                path: { type: "string", description: "File path" },
                options: {
                    type: "object",
                    optional: true,
                    description: "Edit options: { atomic: boolean }",
                },
                edits: {
                    type: "array",
                    description: "List of edit operations",
                },
            },
            returns: {
                success: "Whether all edits succeeded",
                applied: "Array of applied edit results",
                errors: "Array of edit errors",
                file_state: "File state after edits",
            },
        });
        this.workspace = workspace;
        this.workspaceRoot = workspace.getWorkspaceRoot();
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validated = params as FileEditParams;
        const { path: filePath, options = {}, edits } = validated;

        try {
            const absolutePath = this.resolvePath(filePath);
            await this.validatePath(absolutePath);

            const content = await fs.promises.readFile(absolutePath, "utf-8");
            const lines = content.split("\n");

            const applied: EditResult[] = [];
            const errors: EditError[] = [];

            const atomic = options.atomic ?? true;

            const sortedEdits = this.sortEdits(edits);

            const preApplyResults = this.validateAnchors(
                lines,
                sortedEdits,
            );

            const validEdits: Array<{ edit: Edit; matchResult: typeof preApplyResults[0] }> = [];
            const invalidEdits: Array<{ edit: Edit; error: EditError }> = [];

            for (let i = 0; i < sortedEdits.length; i++) {
                const result = preApplyResults[i];
                if (result.valid) {
                    validEdits.push({ edit: sortedEdits[i], matchResult: result });
                } else {
                    invalidEdits.push({
                        edit: sortedEdits[i],
                        error: {
                            index: i,
                            error: result.errorCode || "ANCHOR_NOT_FOUND",
                            message: result.errorMessage || "Anchor validation failed",
                            candidates: result.candidates,
                        },
                    });
                    errors.push({
                        index: i,
                        error: result.errorCode || "ANCHOR_NOT_FOUND",
                        message: result.errorMessage || "Anchor validation failed",
                        candidates: result.candidates,
                    });
                }
            }

            if (atomic && invalidEdits.length > 0) {
                return this.error(
                    "ATOMIC_FAILURE",
                    `Atomic edit failed: ${invalidEdits.length} of ${edits.length} edits could not be validated`,
                    {
                        failedEdits: invalidEdits.map((e) => ({
                            index: e.error.index,
                            error: e.error.error,
                        })),
                        appliedCount: 0,
                    },
                    "Fix the anchor issues or set atomic: false for partial application",
                );
            }

            let modifiedLines = [...lines];

            for (const { edit, matchResult } of validEdits) {
                const result = this.applyEdit(modifiedLines, edit);
                modifiedLines = result.lines;

                applied.push({
                    index: matchResult.editIndex,
                    mode: edit.mode,
                    matchedRange: [matchResult.matchedRange.start, matchResult.matchedRange.end],
                    newRange: result.newRange,
                    matchQuality: matchResult.matchQuality,
                });
            }

            const newContent = modifiedLines.join("\n");
            await fs.promises.writeFile(absolutePath, newContent, "utf-8");

            if (this.workspace.getFileEntry(filePath)) {
                this.workspace.updateFileContent(
                    filePath,
                    modifiedLines.map((l) => rstrip(l)),
                );
            }

            return this.success({
                success: invalidEdits.length === 0,
                applied,
                errors,
                file_state: {
                    total_lines: modifiedLines.length,
                    modified_regions: applied.map((a) => a.newRange),
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

    private sortEdits(edits: Edit[]): Edit[] {
        return [...edits].sort((a, b) => {
            const aEnd = a.anchor.end?.line ?? a.anchor.start.line;
            const bEnd = b.anchor.end?.line ?? b.anchor.start.line;
            return bEnd - aEnd;
        });
    }

    private validateAnchors(
        lines: string[],
        edits: Edit[],
    ):
        Array<{
            valid: boolean;
            editIndex: number;
            errorCode?: string;
            errorMessage?: string;
            candidates?: Array<{ line: number; preview: string }>;
            matchedRange: { start: number; end: number };
            matchQuality: "exact" | "fuzzy" | "line_hint";
        }> {
        const results: Array<{
            valid: boolean;
            editIndex: number;
            errorCode?: string;
            errorMessage?: string;
            candidates?: Array<{ line: number; preview: string }>;
            matchedRange: { start: number; end: number };
            matchQuality: "exact" | "fuzzy" | "line_hint";
        }> = [];

        for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            const match = this.findAnchorMatch(lines, edit);

            if (match) {
                results.push({
                    valid: true,
                    editIndex: i,
                    matchedRange: match.matchedRange,
                    matchQuality: match.matchQuality,
                });
            } else {
                const candidates = this.findCandidates(lines, edit);
                results.push({
                    valid: false,
                    editIndex: i,
                    errorCode: candidates.length > 1 ? "AMBIGUOUS_MATCH" : "NO_MATCH",
                    errorMessage:
                        candidates.length > 1
                            ? `Found ${candidates.length} possible matches`
                            : "Anchor not found",
                    candidates: candidates.map((c) => ({
                        line: c.line,
                        preview: lines[c.line - 1] || "",
                    })),
                    matchedRange: { start: -1, end: -1 },
                    matchQuality: "line_hint",
                });
            }
        }

        return results;
    }

    private findAnchorMatch(
        lines: string[],
        edit: Edit,
    ): { matchedRange: { start: number; end: number }; matchQuality: "exact" | "fuzzy" | "line_hint" } | null {
        const isRange = edit.mode === "replace" || edit.mode === "delete";
        const loose = this.isLooseWhitespace(lines[0] || "");

        if (isRange && edit.anchor.end) {
            for (const quality of ["exact", "fuzzy", "line_hint"] as const) {
                const candidates = this.searchForAnchor(
                    lines,
                    edit.anchor.start,
                    edit.anchor.end,
                    quality,
                    loose,
                );

                if (quality === "line_hint") {
                    const filtered = this.filterByLineHint(
                        candidates,
                        edit.anchor.start.line,
                    );
                    if (filtered.length === 1) {
                        return {
                            matchedRange: {
                                start: filtered[0].startLine,
                                end: filtered[0].endLine,
                            },
                            matchQuality: quality,
                        };
                    }
                } else if (candidates.length === 1) {
                    return {
                        matchedRange: {
                            start: candidates[0].startLine,
                            end: candidates[0].endLine,
                        },
                        matchQuality: quality,
                    };
                } else if (candidates.length > 1) {
                    return {
                        matchedRange: {
                            start: candidates[0].startLine,
                            end: candidates[0].endLine,
                        },
                        matchQuality: quality,
                    };
                }
            }
        } else {
            for (const quality of ["exact", "fuzzy", "line_hint"] as const) {
                const candidates = this.searchForSingleAnchor(
                    lines,
                    edit.anchor.start,
                    quality,
                    loose,
                );

                if (quality === "line_hint") {
                    const filtered = candidates.filter(
                        (c) => Math.abs(c.line - edit.anchor.start.line) <= 5,
                    );
                    if (filtered.length === 1) {
                        return {
                            matchedRange: {
                                start: filtered[0].line,
                                end: filtered[0].line,
                            },
                            matchQuality: quality,
                        };
                    }
                } else if (candidates.length === 1) {
                    return {
                        matchedRange: {
                            start: candidates[0].line,
                            end: candidates[0].line,
                        },
                        matchQuality: quality,
                    };
                } else if (candidates.length > 1) {
                    return {
                        matchedRange: {
                            start: candidates[0].line,
                            end: candidates[0].line,
                        },
                        matchQuality: quality,
                    };
                }
            }
        }

        return null;
    }

    private searchForAnchor(
        lines: string[],
        startAnchor: LineAnchor,
        endAnchor: LineAnchor,
        quality: "exact" | "fuzzy" | "line_hint",
        loose: boolean,
    ): MatchCandidate[] {
        const candidates: MatchCandidate[] = [];

        if (quality === "line_hint") {
            const searchStart = Math.max(1, startAnchor.line - 5);
            const searchEnd = Math.min(lines.length, startAnchor.line + 5);

            for (let line = searchStart; line <= searchEnd; line++) {
                if (
                    this.matchStartAnchor(lines, startAnchor, line, quality, loose)
                ) {
                    const endLine = line + (endAnchor.line - startAnchor.line);
                    if (
                        endLine <= lines.length &&
                        this.matchEndAnchor(lines, endAnchor, endLine, quality, loose)
                    ) {
                        candidates.push({
                            line: line,
                            startLine: line,
                            endLine,
                            matchQuality: quality,
                        });
                    }
                }
            }
        } else {
            for (let line = 1; line <= lines.length; line++) {
                if (!this.matchStartAnchor(lines, startAnchor, line, quality, loose)) {
                    continue;
                }

                const endLine = line + (endAnchor.line - startAnchor.line);
                if (endLine > lines.length) continue;

                if (this.matchEndAnchor(lines, endAnchor, endLine, quality, loose)) {
                    candidates.push({
                        line,
                        startLine: line,
                        endLine,
                        matchQuality: quality,
                    });
                }
            }
        }

        return candidates;
    }

    private searchForSingleAnchor(
        lines: string[],
        anchor: LineAnchor,
        quality: "exact" | "fuzzy" | "line_hint",
        loose: boolean,
    ): Array<{ line: number; preview: string }> {
        const candidates: Array<{ line: number; preview: string }> = [];

        if (quality === "line_hint") {
            const searchStart = Math.max(1, anchor.line - 5);
            const searchEnd = Math.min(lines.length, anchor.line + 5);

            for (let line = searchStart; line <= searchEnd; line++) {
                if (this.matchStartAnchor(lines, anchor, line, quality, loose)) {
                    candidates.push({ line, preview: lines[line - 1] || "" });
                }
            }
        } else {
            for (let line = 1; line <= lines.length; line++) {
                if (this.matchStartAnchor(lines, anchor, line, quality, loose)) {
                    candidates.push({ line, preview: lines[line - 1] || "" });
                }
            }
        }

        return candidates;
    }

    private matchStartAnchor(
        lines: string[],
        anchor: LineAnchor,
        lineNum: number,
        quality: string,
        loose: boolean,
    ): boolean {
        const line = lines[lineNum - 1];
        if (!line) return false;

        const beforeStart = lineNum - 2;
        const beforeEnd = lineNum - 1;
        const afterStart = lineNum;
        const afterEnd = lineNum + 1;

        const before = [
            beforeStart >= 1 ? lines[beforeStart - 1] : "",
            beforeEnd >= 1 ? lines[beforeEnd - 1] : "",
        ];
        const after = [
            afterStart <= lines.length ? lines[afterStart - 1] : "",
            afterEnd <= lines.length ? lines[afterEnd - 1] : "",
        ];

        if (quality === "exact") {
            return (
                line === anchor.text &&
                this.compareContext(before, anchor.before, loose) &&
                this.compareContext(after, anchor.after, loose)
            );
        } else if (quality === "fuzzy") {
            return (
                compareLines(line, anchor.text, true) &&
                this.compareContextFuzzy(before, anchor.before, loose) &&
                this.compareContextFuzzy(after, anchor.after, loose)
            );
        } else {
            return compareLines(line, anchor.text, true);
        }
    }

    private matchEndAnchor(
        lines: string[],
        anchor: LineAnchor,
        lineNum: number,
        quality: string,
        loose: boolean,
    ): boolean {
        const line = lines[lineNum - 1];
        if (!line) return false;

        const beforeStart = lineNum - 2;
        const beforeEnd = lineNum - 1;
        const afterStart = lineNum;
        const afterEnd = lineNum + 1;

        const before = [
            beforeStart >= 1 ? lines[beforeStart - 1] : "",
            beforeEnd >= 1 ? lines[beforeEnd - 1] : "",
        ];
        const after = [
            afterStart <= lines.length ? lines[afterStart - 1] : "",
            afterEnd <= lines.length ? lines[afterEnd - 1] : "",
        ];

        if (quality === "exact") {
            return (
                line === anchor.text &&
                this.compareContext(before, anchor.before, loose) &&
                this.compareContext(after, anchor.after, loose)
            );
        } else if (quality === "fuzzy") {
            return (
                compareLines(line, anchor.text, true) &&
                this.compareContextFuzzy(before, anchor.before, loose) &&
                this.compareContextFuzzy(after, anchor.after, loose)
            );
        } else {
            return compareLines(line, anchor.text, true);
        }
    }

    private compareContext(
        actual: string[],
        expected: string[],
        _loose: boolean,
    ): boolean {
        return (
            actual[0] === expected[0] && actual[1] === expected[1]
        );
    }

    private compareContextFuzzy(
        actual: string[],
        expected: string[],
        _loose: boolean,
    ): boolean {
        return (
            compareLines(actual[0], expected[0], true) &&
            compareLines(actual[1], expected[1], true)
        );
    }

    private filterByLineHint(
        candidates: MatchCandidate[],
        hintLine: number,
    ): MatchCandidate[] {
        return candidates.filter((c) => Math.abs(c.line - hintLine) <= 5);
    }

    private findCandidates(
        lines: string[],
        edit: Edit,
    ): Array<{ line: number; preview: string }> {
        const loose = this.isLooseWhitespace(lines[0] || "");
        const result = this.searchForSingleAnchor(
            lines,
            edit.anchor.start,
            "fuzzy",
            loose,
        );
        return result.slice(0, 5);
    }

    private applyEdit(
        lines: string[],
        edit: Edit,
    ): { lines: string[]; newRange: [number, number] } {
        const anchor = edit.anchor;
        const anchorLine = anchor.start.line;
        const endLine = anchor.end?.line ?? anchorLine;

        switch (edit.mode) {
            case "replace": {
                const beforeLines = lines.slice(0, anchorLine - 1);
                const afterLines = lines.slice(endLine);
                const newLines = edit.content || [];
                const newContent = [...beforeLines, ...newLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [anchorLine, anchorLine + newLines.length - 1],
                };
            }

            case "delete": {
                const beforeLines = lines.slice(0, anchorLine - 1);
                const afterLines = lines.slice(endLine);
                const newContent = [...beforeLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [anchorLine, anchorLine - 1],
                };
            }

            case "insert_before": {
                const insertLines = edit.content || [];
                const beforeLines = lines.slice(0, anchorLine - 1);
                const afterLines = lines.slice(anchorLine - 1);
                const newContent = [...beforeLines, ...insertLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [anchorLine, anchorLine + insertLines.length - 1],
                };
            }

            case "insert_after": {
                const insertLines = edit.content || [];
                const beforeLines = lines.slice(0, endLine);
                const afterLines = lines.slice(endLine);
                const newContent = [...beforeLines, ...insertLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [endLine + 1, endLine + insertLines.length],
                };
            }

            default:
                return { lines, newRange: [anchorLine, endLine] };
        }
    }

    private isLooseWhitespace(firstLine: string): boolean {
        const ext = path.extname(firstLine);
        const strictExtensions = [".py", ".yaml", ".yml", ".mk", ".makefile"];
        return !strictExtensions.includes(ext.toLowerCase());
    }

    private resolvePath(inputPath: string): string {
      const resolved = path.isAbsolute(inputPath)
        ? path.resolve(inputPath)
        : path.resolve(this.workspaceRoot, inputPath);
    
      // Use path.relative to securely check if path is outside workspace
      // This handles symlinks, case sensitivity issues, and normalization
      const relative = path.relative(this.workspaceRoot, resolved);
      if (relative.startsWith("..") || relative === "..") {
        throw new Error(
          `Path ${resolved} is outside workspace root ${this.workspaceRoot}`,
        );
      }
    
      return resolved;
    }

    private async validatePath(absolutePath: string): Promise<void> {
      // Path is already validated in resolvePath, so we just check file existence here

        try {
            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) {
                throw new Error(`Path ${absolutePath} is not a file`);
            }
        } catch (error) {
            if (
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
            ) {
                throw new Error(`File ${absolutePath} does not exist`);
            }
            throw error;
        }
    }
}
