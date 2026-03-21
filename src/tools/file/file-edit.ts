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
    EditMode,
    EditOptions,
    EditResult,
    EditError,
    LineAnchor,
} from "../../types";
import { rstrip, compareLines, containsOrContained } from "../../utils/str";

interface FileEditParams {
    path: string;
    options?: EditOptions;
    edits: Edit[];
}

interface MatchCandidate {
    line: number;
    startLine: number;
    endLine: number;
    matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
}

export class FileEditTool extends BaseTool {
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "edit",
            description: `Apply structured edits to a file.

CRITICAL REQUIREMENTS - READ THIS FIRST:
1. ALWAYS read the file first with file.load to get exact content and line numbers
2. The "text" field MUST be copied VERBATIM from the file - no paraphrasing, no truncation
3. ALWAYS include "before" and "after" context (2 lines each) - this is NOT optional
4. ALWAYS use heredoc syntax for content with newlines, quotes, or special characters

ANCHOR MATCHING - HOW IT WORKS:
The tool tries to find your anchor in this order:
1. Exact match: "text" matches exactly + "before"/"after" context matches
2. Fuzzy match: "text" is similar + "before"/"after" context matches
3. Line hint: Falls back to searching around the specified "line" number (±10 lines)

COMMON FAILURE MODES - AVOID THESE:
❌ WRONG: Paraphrasing text: "text": "function that does something"
✅ RIGHT: Copy exact text: "text": "function processData(input: string): void {"

❌ WRONG: Skipping context: { "line": 10, "text": "const x = 1;" }
✅ RIGHT: Include context: { "line": 10, "text": "const x = 1;", "before": ["// init", "import { x }"], "after": ["const y = 2", "return x"] }

❌ WRONG: Using JSON escaping for multi-line content: "content": ["line 1\\n", "line 2\\n"]
✅ RIGHT: Use heredoc (see below)

HEREDOC SYNTAX - USE THIS FOR MULTI-LINE CONTENT:
{
  "content": {"$heredoc": "EOF"}
}

// AT THE END OF THE tool-call BLOCK, OUTSIDE THE JSON ARRAY
<<<EOF
line 1 with "quotes" and 'apostrophes'
line 2 with backslashes and special chars: \\n \\t $variable
line 3
EOF

Benefits:
- No JSON escaping needed - just paste your content as-is
- Works with any characters: quotes, backslashes, dollar signs, etc.
- Essential for code, markdown, or any content with special characters

EDIT MODES:
- "replace": Replace the anchor line(s) with new content (requires "end" anchor)
- "delete": Remove the anchor line(s) (requires "end" anchor)
- "insert_before": Insert new content before the anchor line
- "insert_after": Insert new content after the anchor line

MULTIPLE EDITS:
- Edits are applied bottom-to-top (descending line order)
- Overlapping ranges are rejected
- MERGE nearby edits into one larger edit instead of many small ones

EXAMPLE - Replace multiple lines using heredoc:

\`\`\`tool-call
[
    {"tool": "file.edit", "params": {
        "path": "src/file.ts",
        "edits": [{
            "mode": "replace",
            "anchor": {
            "start": {
                "line": 10,
                "text": "function old() {",
                "before": ["import { x } from 'lib';", ""],
                "after": ["  return x;", "}"]
            },
            "end": {
                "line": 13,
                "text": "}",
                "before": ["  return x;", "function old() {"],
                "after": ["", "export { old };"]
            }
            },
            "content": {"$heredoc": "EOF"}
        }]
        }
    }}
]

<<<EOF
function new() {
  return x * 2;
}
EOF
\`\`\`

EXAMPLE - Append to end of file (file has 3 lines):
\`\`\`tool-call
[
    {"tool": "file.edit", "params": {
        "path": "file.txt",
        "edits": [{
            "mode": "insert_after",
            "anchor": {
            "start": {
                "line": 3,
                "text": "last line content",
                "before": ["line 2 content", "line 1 content"],
                "after": []
            }
            },
            "content": {"$heredoc": "EOF"}
        }]
    }}
]

<<<EOF
new line at end
EOF
\`\`\``,
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
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.edit",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { path: filePath, options = {}, edits } = validation.data as FileEditParams;

        try {
            const absolutePath = this.resolvePath(filePath);
            await this.validatePath(absolutePath);

            const content = await fs.promises.readFile(absolutePath, "utf-8");
            const lines = content.split("\n");

            const applied: EditResult[] = [];
            const errors: EditError[] = [];

            const atomic = options.atomic ?? true;

            const preApplyResults = this.validateAnchors(lines, edits);

            const validEdits: Array<{ edit: Edit; matchResult: typeof preApplyResults[0] }> = [];
            const invalidEdits: Array<{ edit: Edit; error: EditError }> = [];

            for (let i = 0; i < edits.length; i++) {
                const result = preApplyResults[i];
                if (result.valid) {
                    validEdits.push({ edit: edits[i], matchResult: result });
                } else {
                    invalidEdits.push({
                        edit: edits[i],
                        error: {
                            index: result.editIndex,
                            error: result.errorCode || "ANCHOR_NOT_FOUND",
                            message: result.errorMessage || "Anchor validation failed",
                            candidates: result.candidates,
                        },
                    });
                    errors.push({
                        index: result.editIndex,
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
                    "Fix the anchor issues or set atomic: false for partial application. To view the exact content again, use tool `file.peek` instead of `file.load`",
                );
            }

            const overlapErrors = this.checkOverlappingRanges(lines, validEdits);
            if (overlapErrors.length > 0) {
                return this.error(
                    "OVERLAPPING_RANGES",
                    `Found ${overlapErrors.length} overlapping edit range(s)`,
                    { overlaps: overlapErrors },
                    "Ensure edit ranges do not overlap, or combine overlapping edits into a single edit",
                );
            }

            let modifiedLines = [...lines];

            const sortedValidEdits = [...validEdits].sort((a, b) => {
                const aStart = a.matchResult.matchedRange.start;
                const bStart = b.matchResult.matchedRange.start;
                return bStart - aStart;
            });

            for (const { edit, matchResult } of sortedValidEdits) {
                const startLine = matchResult.matchedRange.start;
                const endLine = matchResult.matchedRange.end;

                const result = this.applyEdit(
                    modifiedLines,
                    edit.mode,
                    edit.content,
                    startLine,
                    endLine,
                );
                modifiedLines = result.lines;

                applied.push({
                    index: matchResult.editIndex,
                    mode: edit.mode,
                    matchedRange: [startLine, endLine],
                    newRange: result.newRange,
                    matchQuality: matchResult.matchQuality,
                });
            }

            const newContent = modifiedLines.join("\n");
            await fs.promises.writeFile(absolutePath, newContent, "utf-8");

            // Update workspace: adjust ranges for line count changes and reload
            const existingEntry = this.workspace.getFileEntry(filePath);
            let updatedRanges: Array<{ start: number; end: number }> = [];
            let totalLinesInWorkspace = 0;

            if (existingEntry) {
                // Calculate line deltas from applied edits
                const editDeltas = applied.map((edit) => {
                    const originalLineCount = edit.matchedRange[1] - edit.matchedRange[0] + 1;
                    const newLineCount = edit.newRange[1] - edit.newRange[0] + 1;
                    return {
                        at: edit.matchedRange[0],
                        delta: newLineCount - originalLineCount,
                    };
                });

                // Sort deltas by position (descending) for proper application
                editDeltas.sort((a, b) => b.at - a.at);

                // Apply deltas to existing ranges to get adjusted ranges
                updatedRanges = existingEntry.ranges.map((range) => {
                    let newStart = range.start;
                    let newEnd = range.end;
                    for (const delta of editDeltas) {
                        if (delta.at < range.start) {
                            // Delta is before this range - shift entire range
                            newStart += delta.delta;
                            newEnd += delta.delta;
                        } else if (delta.at <= range.end) {
                            // Delta is within this range - adjust the end
                            newEnd += delta.delta;
                        }
                    }
                    // Clamp to valid line numbers
                    newStart = Math.max(1, Math.min(newStart, modifiedLines.length));
                    newEnd = Math.max(newStart, Math.min(newEnd, modifiedLines.length));
                    return { start: newStart, end: newEnd };
                });

                // Unload and reload with adjusted ranges
                this.workspace.unloadFile(filePath);
                const newEntry = await this.workspace.reloadFileWithRangesContent(
                    filePath,
                    newContent,
                    updatedRanges,
                );

                if (newEntry) {
                    totalLinesInWorkspace = newEntry.content.length;
                }
            }

            return this.success({
                success: invalidEdits.length === 0,
                applied,
                errors,
                file_state: {
                    total_lines: modifiedLines.length,
                    modified_regions: applied.map((a) => a.newRange),
                },
                workspace_update: updatedRanges.length > 0 ? {
                    loaded_ranges: updatedRanges.filter(r => r.start <= r.end),
                    total_lines_in_workspace: totalLinesInWorkspace,
                } : undefined,
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
            matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
        }> {
        const results: Array<{
            valid: boolean;
            editIndex: number;
            errorCode?: string;
            errorMessage?: string;
            candidates?: Array<{ line: number; preview: string }>;
            matchedRange: { start: number; end: number };
            matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
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
                let errorMessage: string;
                let errorCode: string;

                if (candidates.length === 0) {
                    errorCode = "NO_MATCH";
                    errorMessage = `Anchor text not found anywhere in file.
Expected: "${edit.anchor.start.text.slice(0, 80)}${edit.anchor.start.text.length > 80 ? '...' : ''}"

TROUBLESHOOTING:
1. Verify whether you copied the EXACT text from the file again (use file.peek to read it)
2. Include "before" and "after" context fields to help locate the line
3. Check if the file has been modified since you last read it`;
                } else if (candidates.length === 1) {
                    errorCode = "NO_MATCH";
                    const c = candidates[0];
                    const actualLine = lines[c.line - 1] || "";
                    errorMessage = `Anchor not found at line ${edit.anchor.start.line}.
Similar content found at line ${c.line}.

Expected: "${edit.anchor.start.text.slice(0, 60)}${edit.anchor.start.text.length > 60 ? '...' : ''}"
Actual:   "${actualLine.slice(0, 60)}${actualLine.length > 60 ? '...' : ''}"

TROUBLESHOOTING:
1. Use line ${c.line} instead of ${edit.anchor.start.line}
2. Copy the EXACT text from the file (the actual line is shown above)
3. Include "before" and "after" context fields for disambiguation`;
                } else {
                    errorCode = "AMBIGUOUS_MATCH";
                    errorMessage = `Found ${candidates.length} possible matches for anchor.
This usually means the line appears multiple times or is not unique enough.

TROUBLESHOOTING:
1. Add "before" and "after" context fields (2 lines each) to disambiguate
2. Use a more unique portion of the line as the "text" field
3. Verify the line number is correct`;
                }

                results.push({
                    valid: false,
                    editIndex: i,
                    errorCode,
                    errorMessage,
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
    ): { matchedRange: { start: number; end: number }; matchQuality: "exact" | "fuzzy" | "substring" | "line_hint" } | null {
        const isRange = edit.mode === "replace" || edit.mode === "delete";
        const loose = this.isLooseWhitespace(lines[0] || "");

        if (isRange && edit.anchor.end) {
            for (const quality of ["exact", "fuzzy", "substring", "line_hint"] as const) {
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
                    if (filtered.length >= 1) {
                        const best = filtered.reduce((closest, c) =>
                            Math.abs(c.startLine - edit.anchor.start.line) < Math.abs(closest.startLine - edit.anchor.start.line)
                                ? c : closest
                        );
                        return {
                            matchedRange: {
                                start: best.startLine,
                                end: best.endLine,
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
            for (const quality of ["exact", "fuzzy", "substring", "line_hint"] as const) {
                const candidates = this.searchForSingleAnchor(
                    lines,
                    edit.anchor.start,
                    quality,
                    loose,
                );

                if (quality === "line_hint") {
                    const filtered = candidates.filter(
                        (c) => Math.abs(c.line - edit.anchor.start.line) <= 10,
                    );
                    if (filtered.length >= 1) {
                        const best = filtered.reduce((closest, c) =>
                            Math.abs(c.line - edit.anchor.start.line) < Math.abs(closest.line - edit.anchor.start.line)
                                ? c : closest
                        );
                        return {
                            matchedRange: {
                                start: best.line,
                                end: best.line,
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
        quality: "exact" | "fuzzy" | "substring" | "line_hint",
        loose: boolean,
    ): MatchCandidate[] {
        const candidates: MatchCandidate[] = [];

        if (quality === "line_hint") {
            const searchStart = Math.max(1, startAnchor.line - 10);
            const searchEnd = Math.min(lines.length, startAnchor.line + 10);

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
            // For "exact", "fuzzy", and "substring" - search all lines
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
        quality: "exact" | "fuzzy" | "substring" | "line_hint",
        loose: boolean,
    ): Array<{ line: number; preview: string }> {
        const candidates: Array<{ line: number; preview: string }> = [];

        if (quality === "line_hint") {
            const searchStart = Math.max(1, anchor.line - 10);
            const searchEnd = Math.min(lines.length, anchor.line + 10);

            for (let line = searchStart; line <= searchEnd; line++) {
                if (this.matchStartAnchor(lines, anchor, line, quality, loose)) {
                    candidates.push({ line, preview: lines[line - 1] || "" });
                }
            }
        } else {
            // For "exact", "fuzzy", and "substring" - search all lines
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
        const afterStart = lineNum + 1;
        const afterEnd = lineNum + 2;

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
        } else if (quality === "substring") {
            // Substring matching for end anchor
            return (
                containsOrContained(line, anchor.text, 15) &&
                this.compareContextFuzzy(before, anchor.before, loose) &&
                this.compareContextFuzzy(after, anchor.after, loose)
            );
        } else {
            // line_hint - just check text similarity without context
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
        const afterStart = lineNum + 1;
        const afterEnd = lineNum + 2;

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
        } else if (quality === "substring") {
            // Substring matching: check if anchor text is contained in line or vice versa
            // This helps when LLMs provide partial/truncated text
            return (
                containsOrContained(line, anchor.text, 15) &&
                this.compareContextFuzzy(before, anchor.before, loose) &&
                this.compareContextFuzzy(after, anchor.after, loose)
            );
        } else {
            // line_hint - just check text similarity without context
            return compareLines(line, anchor.text, true);
        }
    }

    private compareContext(
        actual: string[],
        expected: string[] | undefined,
        _loose: boolean,
    ): boolean {
        // If no expected context, match succeeds
        if (!expected || expected.length === 0) {
            return true;
        }
        return (
            actual[0] === expected[0] && actual[1] === expected[1]
        );
    }

    private compareContextFuzzy(
        actual: string[],
        expected: string[] | undefined,
        _loose: boolean,
    ): boolean {
        // If no expected context, match succeeds
        if (!expected || expected.length === 0) {
            return true;
        }
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
        const anchorText = edit.anchor.start.text;
        const hintLine = edit.anchor.start.line;

        const candidates: Array<{ line: number; preview: string; score: number }> = [];

        for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
            const line = lines[lineNum - 1] || "";
            let score = 0;
            const lineDiff = Math.abs(lineNum - hintLine);
            const proximityBonus = Math.max(0, 20 - lineDiff);

            if (line === anchorText) {
                score = 100 + proximityBonus;
            } else if (rstrip(line) === rstrip(anchorText)) {
                score = 90 + proximityBonus;
            } else if (line.trim() === anchorText.trim()) {
                score = 80 + proximityBonus - Math.min(lineDiff, 30);
            } else if (line.includes(anchorText)) {
                score = 50 + proximityBonus;
            } else if (anchorText.length > 10 && this.similarity(line, anchorText) > 0.7) {
                score = 30 + proximityBonus;
            }

            if (score > 0) {
                candidates.push({ line: lineNum, preview: line, score });
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, 5);
    }

    private similarity(a: string, b: string): number {
        const s1 = a.trim().toLowerCase();
        const s2 = b.trim().toLowerCase();
        if (s1 === s2) return 1;

        const longer = s1.length > s2.length ? s1 : s2;
        const shorter = s1.length > s2.length ? s2 : s1;
        if (longer.length === 0) return 1;

        const editDistance = this.levenshtein(longer, shorter);
        return (longer.length - editDistance) / longer.length;
    }

    private levenshtein(a: string, b: string): number {
        const matrix: number[][] = [];
        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }
        return matrix[b.length][a.length];
    }

    private checkOverlappingRanges(
        lines: string[],
        validEdits: Array<{ edit: Edit; matchResult: { matchedRange: { start: number; end: number }; editIndex: number } }>,
    ): Array<{ editIndex: number; overlappedLines: [number, number] }> {
        const overlaps: Array<{ editIndex: number; overlappedLines: [number, number] }> = [];
        const modified = new Array(lines.length + 1).fill(false);

        for (const { matchResult } of validEdits) {
            const { start, end } = matchResult.matchedRange;
            let overlapFound = false;

            for (let line = start; line <= end; line++) {
                if (modified[line]) {
                    if (!overlapFound) {
                        overlapFound = true;
                    }
                }
            }

            if (overlapFound) {
                overlaps.push({
                    editIndex: matchResult.editIndex,
                    overlappedLines: [start, end],
                });
            } else {
                for (let line = start; line <= end; line++) {
                    modified[line] = true;
                }
            }
        }

        return overlaps;
    }

    private applyEdit(
        lines: string[],
        mode: EditMode,
        content: string[] | undefined,
        startLine: number,
        endLine: number,
    ): { lines: string[]; newRange: [number, number] } {
        switch (mode) {
            case "replace": {
                const beforeLines = lines.slice(0, startLine - 1);
                const afterLines = lines.slice(endLine);
                const newLines = content || [];
                const newContent = [...beforeLines, ...newLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [startLine, startLine + newLines.length - 1],
                };
            }

            case "delete": {
                const beforeLines = lines.slice(0, startLine - 1);
                const afterLines = lines.slice(endLine);
                const newContent = [...beforeLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [startLine, startLine - 1],
                };
            }

            case "insert_before": {
                const insertLines = content || [];
                const beforeLines = lines.slice(0, startLine - 1);
                const afterLines = lines.slice(startLine - 1);
                const newContent = [...beforeLines, ...insertLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [startLine, startLine + insertLines.length - 1],
                };
            }

            case "insert_after": {
                const insertLines = content || [];
                const beforeLines = lines.slice(0, endLine);
                const afterLines = lines.slice(endLine);
                const newContent = [...beforeLines, ...insertLines, ...afterLines];
                return {
                    lines: newContent,
                    newRange: [endLine + 1, endLine + insertLines.length],
                };
            }

            default:
                return { lines, newRange: [startLine, endLine] };
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

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data) {
            const { applied, errors, file_state, workspace_update } = result.data as {
                applied: EditResult[];
                errors: EditError[];
                file_state: { total_lines: number };
                workspace_update?: {
                    loaded_ranges: Array<{ start: number; end: number }>;
                    total_lines_in_workspace: number;
                };
            };

            const lines: string[] = [];

            if (errors.length === 0) {
                lines.push(`\x1b[32m\x1b[1m✓\x1b[0m Applied ${applied.length} edit(s), ${file_state.total_lines} total lines`);
            } else {
                lines.push(`\x1b[33m\x1b[1m⚠\x1b[0m Applied ${applied.length} edit(s), ${errors.length} error(s)`);
            }

            if (workspace_update) {
                const rangeStr = workspace_update.loaded_ranges
                    .map((r) => `${r.start}-${r.end}`)
                    .join(", ");
                lines.push(`\x1b[36mWorkspace:\x1b[0m ${workspace_update.total_lines_in_workspace} lines loaded (${rangeStr})`);
            }

            return lines.join("\n");
        }
        return undefined;
    }
}
