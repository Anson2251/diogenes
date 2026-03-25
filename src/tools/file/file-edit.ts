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
import {
    rstrip,
    compareLines,
    containsOrContained,
    clampLineNumber,
    formatDisplayWindow,
} from "../../utils/str";

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
5. Keep each file.edit change small and local; around 30 lines is a good target
6. If you need to rewrite most of a file, use file.overwrite instead
7. If you need to create a new file, use file.create instead

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

❌ WRONG: Reusing a line that appears multiple times without context
✅ RIGHT: When the same text appears more than once, you MUST provide "before" and/or "after" context to disambiguate the target location

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
- "replace": Replace content at the anchor. For a single-line edit, provide only "start". For a multi-line range, provide both "start" and "end".
- "delete": Remove content at the anchor. For a single-line deletion, provide only "start". For a multi-line range, provide both "start" and "end".
- "insert_before": Insert new content before the anchor line
- "insert_after": Insert new content after the anchor line

MULTIPLE EDITS:
- Edits are applied bottom-to-top (descending line order)
- Overlapping ranges are rejected
- MERGE nearby edits into one larger edit instead of many small ones
- If one replacement grows beyond about 30 lines, prefer file.overwrite

MULTIPLE MATCHES:
- If the anchor text appears in multiple places, the edit is ambiguous
- In that case, include "before" and/or "after" context copied exactly from the file
- Do not rely on line number alone to disambiguate repeated text

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

            const preApplyResults = this.validateAnchors(filePath, lines, edits);

            const validEdits: Array<{ edit: Edit; matchResult: typeof preApplyResults[0] }> = [];
            const invalidEdits: Array<{ edit: Edit; error: EditError; suggestion?: string }> = [];

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
                        suggestion: result.errorSuggestion,
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
                const suggestionParts: string[] = [
                    "Fix the anchor issues or set atomic: false for partial application.",
                    "To view exact content again, use tool `file.peek`.",
                ];

                for (const invalid of invalidEdits) {
                    if (invalid.suggestion) {
                        suggestionParts.push("");
                        suggestionParts.push(`Edit ${invalid.error.index}:`);
                        suggestionParts.push(invalid.suggestion);
                    }
                }

                return this.error(
                    "ATOMIC_FAILURE",
                    `Atomic edit failed: ${invalidEdits.length} of ${edits.length} edits could not be validated`,
                    {
                        failedEdits: invalidEdits.map((e) => ({
                            index: e.error.index,
                            error: e.error.error,
                            suggestion: e.suggestion,
                        })),
                        appliedCount: 0,
                    },
                    suggestionParts.join("\n"),
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

            // Delegate post-edit file reload and range re-calculation to workspace manager
            const workspaceUpdate = await this.workspace.syncLoadedFileAfterEdit(filePath, applied);

            return this.success({
                success: invalidEdits.length === 0,
                applied,
                errors,
                file_state: {
                    total_lines: modifiedLines.length,
                    modified_regions: applied.map((a) => a.newRange),
                },
                workspace_update: workspaceUpdate,
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
        filePath: string,
        lines: string[],
        edits: Edit[],
    ):
        Array<{
            valid: boolean;
            editIndex: number;
            errorCode?: string;
            errorMessage?: string;
            errorSuggestion?: string;
            candidates?: Array<{ line: number; preview: string }>;
            matchedRange: { start: number; end: number };
            matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
        }> {
        const results: Array<{
            valid: boolean;
            editIndex: number;
            errorCode?: string;
            errorMessage?: string;
            errorSuggestion?: string;
            candidates?: Array<{ line: number; preview: string }>;
            matchedRange: { start: number; end: number };
            matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
        }> = [];

        for (let i = 0; i < edits.length; i++) {
            const edit = edits[i];
            const match = this.findAnchorMatch(filePath, lines, edit);

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
                let errorSuggestion: string;

                if (candidates.length === 0) {
                    errorCode = "NO_MATCH";
                    errorMessage = `Anchor text not found anywhere in file.
Expected: "${edit.anchor.start.text.slice(0, 80)}${edit.anchor.start.text.length > 80 ? '...' : ''}"

TROUBLESHOOTING:
1. Verify whether you copied the EXACT text from the file again (use file.peek to read it)
2. Include "before" and "after" context fields to help locate the line
3. Check if the file has been modified since you last read it`;
                    errorSuggestion = this.formatNoMatchSuggestion(lines, edit.anchor.start);
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
                    errorSuggestion = this.formatSingleCandidateSuggestion(lines, edit.anchor.start, c.line);
                } else {
                    errorCode = "AMBIGUOUS_MATCH";
                    errorMessage = `Found ${candidates.length} possible matches for anchor.
This usually means the line appears multiple times or is not unique enough.

TROUBLESHOOTING:
1. Add "before" and "after" context fields (2 lines each) to disambiguate
2. Use a more unique portion of the line as the "text" field
3. Verify the line number is correct`;
                    errorSuggestion = this.formatAmbiguousSuggestion(lines, edit.anchor.start, candidates.map((c) => c.line));
                }

                results.push({
                    valid: false,
                    editIndex: i,
                    errorCode,
                    errorMessage,
                    errorSuggestion,
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
        filePath: string,
        lines: string[],
        edit: Edit,
    ): { matchedRange: { start: number; end: number }; matchQuality: "exact" | "fuzzy" | "substring" | "line_hint" } | null {
        const isRange = edit.mode === "replace" || edit.mode === "delete";
        const loose = this.isLooseWhitespace(filePath);

        if (isRange && edit.anchor.end) {
            let foundAmbiguousMatch = false;

            for (const quality of ["exact", "fuzzy", "substring", "line_hint"] as const) {
                const candidates = this.searchForAnchor(
                    lines,
                    edit.anchor.start,
                    edit.anchor.end,
                    quality,
                    loose,
                );

                if (quality === "line_hint") {
                    if (foundAmbiguousMatch) {
                        return null;
                    }
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
                    foundAmbiguousMatch = true;
                }
            }
        } else {
            let foundAmbiguousMatch = false;

            for (const quality of ["exact", "fuzzy", "substring", "line_hint"] as const) {
                const candidates = this.searchForSingleAnchor(
                    lines,
                    edit.anchor.start,
                    quality,
                    loose,
                );

                if (quality === "line_hint") {
                    if (foundAmbiguousMatch) {
                        return null;
                    }
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
                    foundAmbiguousMatch = true;
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
        const expectedOffset = endAnchor.line - startAnchor.line;

        if (quality === "line_hint") {
            const searchStart = Math.max(1, startAnchor.line - 10);
            const searchEnd = Math.min(lines.length, startAnchor.line + 10);

            for (let line = searchStart; line <= searchEnd; line++) {
                if (
                    this.matchStartAnchor(lines, startAnchor, line, quality, loose)
                ) {
                    const endLines = this.findMatchingEndLines(
                        lines,
                        endAnchor,
                        line,
                        expectedOffset,
                        quality,
                        loose,
                    );
                    for (const endLine of endLines) {
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

                const endLines = this.findMatchingEndLines(
                    lines,
                    endAnchor,
                    line,
                    expectedOffset,
                    quality,
                    loose,
                );
                for (const endLine of endLines) {
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

    private findMatchingEndLines(
        lines: string[],
        endAnchor: LineAnchor,
        startLine: number,
        expectedOffset: number,
        quality: "exact" | "fuzzy" | "substring" | "line_hint",
        loose: boolean,
    ): number[] {
        const matches: number[] = [];
        const expectedEndLine = startLine + expectedOffset;
        const maxEndLine = this.supportsVirtualEofLine(endAnchor)
            ? lines.length + 1
            : lines.length;

        if (
            expectedEndLine >= startLine &&
            expectedEndLine <= maxEndLine &&
            this.matchEndAnchor(lines, endAnchor, expectedEndLine, quality, loose)
        ) {
            matches.push(expectedEndLine);
            return matches;
        }

        // Fallback: search end anchor forward from start line.
        // This makes range matching robust when provided line hints drift.
        for (let endLine = startLine; endLine <= maxEndLine; endLine++) {
            if (endLine === expectedEndLine) continue;
            if (this.matchEndAnchor(lines, endAnchor, endLine, quality, loose)) {
                matches.push(endLine);
            }
        }

        return matches;
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
        if (line === undefined) return false;

        const beforeCount = Math.max(2, anchor.before?.length || 0);
        const afterCount = Math.max(2, anchor.after?.length || 0);

        const before: string[] = [];
        for (let i = beforeCount; i >= 1; i--) {
            const idx = lineNum - i;
            before.push(idx >= 1 ? lines[idx - 1] ?? "" : "");
        }

        const after: string[] = [];
        for (let i = 1; i <= afterCount; i++) {
            const idx = lineNum + i;
            after.push(idx <= lines.length ? lines[idx - 1] ?? "" : "");
        }

        if (quality === "exact") {
            return (
                line === anchor.text &&
                this.compareContext(before, anchor.before, loose, "before") &&
                this.compareContext(after, anchor.after, loose, "after")
            );
        } else if (quality === "fuzzy") {
            return (
                compareLines(line, anchor.text, loose) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        } else if (quality === "substring") {
            // Substring matching for end anchor
            return (
                containsOrContained(line, anchor.text, 15) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        } else {
            // line_hint still requires context to agree when context is provided
            return (
                compareLines(line, anchor.text, loose) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        }
    }

    private matchEndAnchor(
        lines: string[],
        anchor: LineAnchor,
        lineNum: number,
        quality: string,
        loose: boolean,
    ): boolean {
        const line = this.getAnchorLine(lines, lineNum, anchor);
        if (line === undefined) return false;

        const beforeCount = Math.max(2, anchor.before?.length || 0);
        const afterCount = Math.max(2, anchor.after?.length || 0);

        const before: string[] = [];
        for (let i = beforeCount; i >= 1; i--) {
            const idx = lineNum - i;
            before.push(idx >= 1 ? lines[idx - 1] ?? "" : "");
        }

        const after: string[] = [];
        for (let i = 1; i <= afterCount; i++) {
            const idx = lineNum + i;
            after.push(idx <= lines.length ? lines[idx - 1] ?? "" : "");
        }

        if (quality === "exact") {
            return (
                line === anchor.text &&
                this.compareContext(before, anchor.before, loose, "before") &&
                this.compareContext(after, anchor.after, loose, "after")
            );
        } else if (quality === "fuzzy") {
            return (
                compareLines(line, anchor.text, loose) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        } else if (quality === "substring") {
            // Substring matching: check if anchor text is contained in line or vice versa
            // This helps when LLMs provide partial/truncated text
            return (
                containsOrContained(line, anchor.text, 15) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        } else {
            // line_hint still requires context to agree when context is provided
            return (
                compareLines(line, anchor.text, loose) &&
                this.compareContextFuzzy(before, anchor.before, loose, "before") &&
                this.compareContextFuzzy(after, anchor.after, loose, "after")
            );
        }
    }

    private supportsVirtualEofLine(anchor: LineAnchor): boolean {
        return anchor.text === "";
    }

    private getAnchorLine(
        lines: string[],
        lineNum: number,
        anchor: LineAnchor,
    ): string | undefined {
        if (lineNum >= 1 && lineNum <= lines.length) {
            return lines[lineNum - 1];
        }

        if (lineNum === lines.length + 1 && this.supportsVirtualEofLine(anchor)) {
            return "";
        }

        return undefined;
    }

    private compareContext(
        actual: string[],
        expected: string[] | undefined,
        loose: boolean,
        direction: "before" | "after",
    ): boolean {
        // If no expected context, match succeeds
        if (!expected || expected.length === 0) {
            return true;
        }

        const actualContext = this.selectContextLines(actual, expected.length, direction);

        return expected.every((line, index) => compareLines(actualContext[index], line, loose));
    }

    private compareContextFuzzy(
        actual: string[],
        expected: string[] | undefined,
        loose: boolean,
        direction: "before" | "after",
    ): boolean {
        // If no expected context, match succeeds
        if (!expected || expected.length === 0) {
            return true;
        }

        const actualContext = this.selectContextLines(actual, expected.length, direction);

        return expected.every((line, index) => compareLines(actualContext[index], line, loose));
    }

    private selectContextLines(
        actual: string[],
        expectedLength: number,
        direction: "before" | "after",
    ): string[] {
        if (expectedLength <= 0) {
            return [];
        }

        if (direction === "before") {
            return actual.slice(Math.max(0, actual.length - expectedLength));
        }

        return actual.slice(0, expectedLength);
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

    private formatNoMatchSuggestion(lines: string[], anchor: LineAnchor): string {
        const hintLine = clampLineNumber(anchor.line, lines.length);
        const parts: string[] = [
            `Anchor hint window around line ${hintLine} (±5):`,
            formatDisplayWindow(lines, hintLine, 5).join("\n"),
        ];

        if (anchor.before?.length || anchor.after?.length) {
            parts.push("");
            parts.push("Expected anchor context:");
            for (const line of anchor.before || []) {
                parts.push(`before | ${line}`);
            }
            parts.push(`anchor | ${anchor.text}`);
            for (const line of anchor.after || []) {
                parts.push(`after  | ${line}`);
            }
        }

        return parts.join("\n");
    }

    private formatSingleCandidateSuggestion(lines: string[], anchor: LineAnchor, candidateLine: number): string {
        const clampedHintLine = clampLineNumber(anchor.line, lines.length);
        const mismatchDetails = this.formatAnchorMismatchDetails(lines, anchor, candidateLine);
        const parts: string[] = [
            `Closest match window around line ${candidateLine} (±5):`,
            formatDisplayWindow(lines, candidateLine, 5).join("\n"),
        ];

        if (mismatchDetails.length > 0) {
            parts.push("");
            parts.push("Mismatch details:");
            parts.push(...mismatchDetails);
        }

        if (candidateLine !== clampedHintLine) {
            parts.push("");
            parts.push(`Anchor hint window around line ${clampedHintLine} (±5):`);
            parts.push(formatDisplayWindow(lines, clampedHintLine, 5).join("\n"));
        }

        return parts.join("\n");
    }

    private formatAmbiguousSuggestion(lines: string[], anchor: LineAnchor, candidateLines: number[]): string {
        const parts: string[] = [
            `Found ${candidateLines.length} possible matches. Each match with ±5 lines:`,
        ];

        for (let i = 0; i < candidateLines.length; i++) {
            const line = candidateLines[i];
            parts.push("");
            parts.push(`Match ${i + 1} at line ${line}:`);
            parts.push(formatDisplayWindow(lines, line, 5).join("\n"));
        }

        parts.push("");
        parts.push(`Anchor hint window around line ${clampLineNumber(anchor.line, lines.length)} (±5):`);
        parts.push(formatDisplayWindow(lines, anchor.line, 5).join("\n"));

        return parts.join("\n");
    }

    private formatAnchorMismatchDetails(
        lines: string[],
        anchor: LineAnchor,
        candidateLine: number,
    ): string[] {
        const details: string[] = [];

        const actualAnchorLine = lines[candidateLine - 1] ?? "";
        if (actualAnchorLine !== anchor.text) {
            details.push(`anchor expected: ${anchor.text}`);
            details.push(`anchor actual:   ${actualAnchorLine}`);
        }

        const expectedBefore = anchor.before || [];
        const actualBefore: string[] = [];
        for (let i = expectedBefore.length; i >= 1; i--) {
            const idx = candidateLine - i;
            actualBefore.push(idx >= 1 ? lines[idx - 1] ?? "" : "");
        }
        for (let i = 0; i < expectedBefore.length; i++) {
            const expected = expectedBefore[i] ?? "";
            const actual = actualBefore[i] ?? "";
            if (expected !== actual) {
                details.push(`before[${i}] expected: ${expected}`);
                details.push(`before[${i}] actual:   ${actual}`);
            }
        }

        const expectedAfter = anchor.after || [];
        const actualAfter: string[] = [];
        for (let i = 1; i <= expectedAfter.length; i++) {
            const idx = candidateLine + i;
            actualAfter.push(idx <= lines.length ? lines[idx - 1] ?? "" : "");
        }
        for (let i = 0; i < expectedAfter.length; i++) {
            const expected = expectedAfter[i] ?? "";
            const actual = actualAfter[i] ?? "";
            if (expected !== actual) {
                details.push(`after[${i}] expected: ${expected}`);
                details.push(`after[${i}] actual:   ${actual}`);
            }
        }

        return details;
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

    private isLooseWhitespace(filePath: string): boolean {
        const ext = path.extname(filePath);
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
