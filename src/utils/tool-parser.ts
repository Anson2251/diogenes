/**
 * Utility functions for parsing and formatting tool calls
 */

import { z } from "zod";

import { ToolCall, ToolResult } from "../types";

// Tool result data schemas using Zod for runtime validation
const fileLoadDataSchema = z.object({
    loaded_range: z.array(z.tuple([z.number(), z.number()])).optional(),
    total_lines: z.number(),
});

const fileEditDataSchema = z.object({
    applied: z.array(
        z.object({
            mode: z.string(),
            matchedRange: z.tuple([z.number(), z.number()]),
            newRange: z.tuple([z.number(), z.number()]),
        }),
    ),
    errors: z.array(
        z.object({
            index: z.number(),
            message: z.string(),
        }),
    ),
    file_state: z
        .object({
            total_lines: z.number(),
        })
        .optional(),
});

const fileCreateDataSchema = z.object({
    total_lines: z.number(),
});

const dirListDataSchema = z.object({
    count: z.number(),
    files: z.number(),
    dirs: z.number(),
});

const taskNotepadDataSchema = z.object({
    total_lines: z.number(),
});

const stringRecordSchema = z.record(z.string(), z.unknown());

const shellExecDataSchema = z.object({
    exit_code: z.number(),
    stdout: z.string().optional(),
    stderr: z.string().optional(),
});

type FileLoadData = z.infer<typeof fileLoadDataSchema>;
type FileEditData = z.infer<typeof fileEditDataSchema>;
type FileCreateData = z.infer<typeof fileCreateDataSchema>;
type DirListData = z.infer<typeof dirListDataSchema>;
type TaskNotepadData = z.infer<typeof taskNotepadDataSchema>;
type ShellExecData = z.infer<typeof shellExecDataSchema>;

/**
 * Type guards using Zod for validation
 */
function isFileLoadData(val: unknown): val is FileLoadData {
    return fileLoadDataSchema.safeParse(val).success;
}

function isFileEditData(val: unknown): val is FileEditData {
    return fileEditDataSchema.safeParse(val).success;
}

function isFileCreateData(val: unknown): val is FileCreateData {
    return fileCreateDataSchema.safeParse(val).success;
}

function isDirListData(val: unknown): val is DirListData {
    return dirListDataSchema.safeParse(val).success;
}

function isTaskNotepadData(val: unknown): val is TaskNotepadData {
    return taskNotepadDataSchema.safeParse(val).success;
}

function isShellExecData(val: unknown): val is ShellExecData {
    return shellExecDataSchema.safeParse(val).success;
}

// Valid tool names set
const VALID_TOOL_NAMES = new Set([
    "dir.list",
    "dir.unload",
    "file.load",
    "file.unload",
    "file.edit",
    "file.peek",
    "file.create",
    "file.overwrite",
    "todo.set",
    "todo.update",
    "task.ask",
    "task.choose",
    "task.notepad",
    "shell.exec",
    "snapshot.create",
    "task.end",
]);

// Check if tool name is valid
function isValidToolName(name: string): boolean {
    return VALID_TOOL_NAMES.has(name);
}

// ToolCall schema for parsing validation with tool name check
const toolCallSchema = z.object({
    tool: z.string().refine(isValidToolName, {
        params: {
            validTools: Array.from(VALID_TOOL_NAMES).slice(0, 5).join(", "),
        },
        message: "Unknown tool: '{{value}}'. Valid tools: {{validTools}}...",
    }),
    params: z.record(z.string(), z.unknown()),
});

function isToolCall(val: unknown): val is ToolCall {
    return toolCallSchema.safeParse(val).success;
}

function validateToolCall(toolCall: unknown): { valid: boolean; error?: string } {
    const result = toolCallSchema.safeParse(toolCall);
    if (result.success) {
        return { valid: true };
    }

    const issue = result.error.issues[0];
    return {
        valid: false,
        error: issue?.message ?? "Invalid tool call format",
    };
}

export interface PartialParseResult {
    completeToolCalls: ToolCall[];
    hasIncompleteToolCall: boolean;
    isInToolCallBlock: boolean;
}

function isInToolCallBlock(text: string): { inBlock: boolean; blockContent: string | null } {
    const lines = text.split("\n");
    let inBlock = false;
    let heredocDelimiter: string | null = null;
    const blockLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (!inBlock) {
            if (trimmed === "```tool-call" || trimmed === "```tool") {
                inBlock = true;
                heredocDelimiter = null;
            }
        } else {
            if (heredocDelimiter === null) {
                const heredocMatch = trimmed.match(/^<<<(\w+)$/);
                if (heredocMatch) {
                    heredocDelimiter = heredocMatch[1];
                } else if (trimmed === "```") {
                    return { inBlock: false, blockContent: blockLines.join("\n") };
                } else {
                    blockLines.push(lines[i]);
                }
            } else {
                if (trimmed === heredocDelimiter) {
                    heredocDelimiter = null;
                }
                blockLines.push(lines[i]);
            }
        }
    }

    return { inBlock, blockContent: inBlock ? blockLines.join("\n") : null };
}

function extractCompleteJsonObjects(jsonArrayText: string): {
    objects: unknown[];
    hasIncomplete: boolean;
} {
    const trimmed = jsonArrayText.trim();
    if (!trimmed.startsWith("[")) {
        return { objects: [], hasIncomplete: false };
    }

    const objects: unknown[] = [];
    let depth = 0;
    let currentStart = -1;
    let inString = false;
    let escapeNext = false;

    for (let i = 0; i < trimmed.length; i++) {
        const char = trimmed[i];

        if (escapeNext) {
            escapeNext = false;
            continue;
        }

        if (char === "\\") {
            escapeNext = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) {
            continue;
        }

        if (char === "{" || char === "[") {
            if (depth === 1 && char === "{") {
                currentStart = i;
            }
            depth++;
        } else if (char === "}" || char === "]") {
            depth--;
            if (depth === 1 && char === "}" && currentStart !== -1) {
                const objText = trimmed.slice(currentStart, i + 1);
                try {
                    const parsed = JSON.parse(objText);
                    objects.push(parsed);
                } catch {
                    // Skip invalid JSON
                }
                currentStart = -1;
            }
        }
    }

    const hasIncomplete = depth > 0 || (trimmed.length > 1 && !trimmed.endsWith("]"));
    return { objects, hasIncomplete };
}

export function tryParsePartialToolCalls(text: string): PartialParseResult {
    const { inBlock, blockContent } = isInToolCallBlock(text);

    if (!inBlock || !blockContent) {
        return {
            completeToolCalls: [],
            hasIncompleteToolCall: false,
            isInToolCallBlock: false,
        };
    }

    try {
        const { objects, hasIncomplete } = extractCompleteJsonObjects(blockContent);
        const completeToolCalls: ToolCall[] = [];

        for (const obj of objects) {
            if (isToolCall(obj)) {
                completeToolCalls.push(obj);
            }
        }

        return {
            completeToolCalls,
            hasIncompleteToolCall: hasIncomplete,
            isInToolCallBlock: true,
        };
    } catch {
        return {
            completeToolCalls: [],
            hasIncompleteToolCall: true,
            isInToolCallBlock: true,
        };
    }
}

export type ToolResultFormatter = (toolCall: ToolCall, result: ToolResult) => string;

export interface ParseResult {
    success: boolean;
    toolCalls?: ToolCall[];
    error?: {
        code: string;
        message: string;
        rawContent?: string;
        suggestion?: string;
    };
}

export interface PartialParseResult {
    completeToolCalls: ToolCall[];
    hasIncompleteToolCall: boolean;
    isInToolCallBlock: boolean;
}

class HeredocParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "HeredocParseError";
    }
}

export function parseToolCalls(text: string): ParseResult {
    const { blocks, errors: blockErrors } = extractToolCallBlocks(text);

    if (blocks.length === 0 && blockErrors.length === 0) {
        return { success: true, toolCalls: [] };
    }

    const allToolCalls: ToolCall[] = [];
    const errors: string[] = [...blockErrors];
    let hasFatalParseError = blockErrors.length > 0;

    for (const block of blocks) {
        try {
            const { jsonContent, heredocs } = extractHeredocs(block);
            const parsed: unknown = JSON.parse(jsonContent);

            if (!Array.isArray(parsed)) {
                errors.push(`Tool calls must be an array, got: ${typeof parsed}`);
                continue;
            }

            for (const toolCall of parsed) {
                const validation = validateToolCall(toolCall);
                if (validation.valid && isToolCall(toolCall)) {
                    const resolvedToolCall = resolveHeredocs(toolCall, heredocs);
                    allToolCalls.push(resolvedToolCall);
                } else {
                    errors.push(validation.error!);
                }
            }
            validateUnusedHeredocs(parsed, heredocs);
        } catch (error) {
            if (error instanceof HeredocParseError) {
                hasFatalParseError = true;
                errors.push(`Heredoc parse error: ${error.message}`);
            } else {
                errors.push(
                    `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    if (hasFatalParseError || (errors.length > 0 && allToolCalls.length === 0)) {
        return {
            success: false,
            error: {
                code: "PARSE_ERROR",
                message: errors.join("; "),
                suggestion:
                    "Ensure tool-call block contains valid JSON array with 'tool' and 'params' fields, and try to write smaller tool-call blocks. Heredoc can be used to simplify large editing blocks",
            },
        };
    }

    return { success: true, toolCalls: allToolCalls };
}

function extractToolCallBlocks(text: string): { blocks: string[]; errors: string[] } {
    const blocks: string[] = [];
    const errors: string[] = [];
    const lines = text.split("\n");

    let inBlock = false;
    let blockStartIndex = -1;
    let heredocDelimiter: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();

        if (!inBlock) {
            if (trimmed === "```tool-call" || trimmed === "```tool") {
                inBlock = true;
                blockStartIndex = i + 1;
                heredocDelimiter = null;
            }
        } else {
            // Track heredoc state
            if (heredocDelimiter === null) {
                // Check if we're starting a heredoc
                const heredocMatch = trimmed.match(/^<<<(\w+)$/);
                if (heredocMatch) {
                    heredocDelimiter = heredocMatch[1];
                } else if (trimmed === "```") {
                    // End of block (only if not in heredoc)
                    const blockLines = lines.slice(blockStartIndex, i);
                    blocks.push(blockLines.join("\n"));
                    inBlock = false;
                    heredocDelimiter = null;
                }
            } else {
                // We're inside a heredoc - look for the closing delimiter
                if (trimmed === heredocDelimiter) {
                    heredocDelimiter = null;
                }
                // Don't treat ``` as end of block while in heredoc
            }
        }
    }

    if (inBlock) {
        if (heredocDelimiter) {
            errors.push(`Unclosed heredoc '${heredocDelimiter}' inside tool-call block`);
        } else {
            errors.push("Unclosed tool-call block: missing closing ```");
        }
    }

    return { blocks, errors };
}

interface HeredocContent {
    delimiter: string;
    lines: string[];
}

function extractHeredocs(blockContent: string): {
    jsonContent: string;
    heredocs: Map<string, HeredocContent>;
} {
    const heredocs = new Map<string, HeredocContent>();
    const lines = blockContent.split("\n");
    const jsonLines: string[] = [];

    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();
        const heredocMatch = trimmed.match(/^<<<(\w+)$/);

        if (heredocMatch) {
            const delimiter = heredocMatch[1];
            if (heredocs.has(delimiter)) {
                throw new HeredocParseError(
                    `Duplicate heredoc delimiter '${delimiter}' in one tool-call block`,
                );
            }
            const heredocLines: string[] = [];
            i++;
            let closed = false;

            while (i < lines.length) {
                if (lines[i].trim() === delimiter) {
                    heredocs.set(delimiter, { delimiter, lines: heredocLines });
                    i++;
                    closed = true;
                    break;
                }
                heredocLines.push(lines[i]);
                i++;
            }

            if (!closed) {
                throw new HeredocParseError(`Heredoc '${delimiter}' is not closed`);
            }
        } else {
            jsonLines.push(line);
            i++;
        }
    }

    return { jsonContent: jsonLines.join("\n").trim(), heredocs };
}

/**
 * Check if value is a plain object
 */
function isPlainObject(val: unknown): val is Record<string, unknown> {
    return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Resolve heredoc markers in tool call params with actual content.
 */
function resolveHeredocs(toolCall: ToolCall, heredocs: Map<string, HeredocContent>): ToolCall {
    const resolvedParams = resolveHeredocsInObject(toolCall.params, heredocs);
    if (!isPlainObject(resolvedParams)) {
        return { tool: toolCall.tool, params: {} };
    }
    return {
        tool: toolCall.tool,
        params: resolvedParams,
    };
}

function resolveHeredocsInObject(obj: unknown, heredocs: Map<string, HeredocContent>): unknown {
    if (obj === null || typeof obj !== "object") {
        return obj;
    }

    if (Array.isArray(obj)) {
        return obj.map((item) => resolveHeredocsInObject(item, heredocs));
    }

    const parseResult = stringRecordSchema.safeParse(obj);
    if (!parseResult.success) {
        return obj;
    }
    const record = parseResult.data;

    if (typeof record["$heredoc"] === "string") {
        const delimiter = record["$heredoc"];
        const heredoc = heredocs.get(delimiter);
        if (heredoc) {
            return heredoc.lines;
        }
        throw new HeredocParseError(
            `Heredoc '${delimiter}' not found. Make sure the heredoc is defined in the same tool-call block.`,
        );
    }

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
        result[key] = resolveHeredocsInObject(value, heredocs);
    }
    return result;
}

function collectReferencedHeredocs(obj: unknown, referenced: Set<string>): void {
    if (obj === null || typeof obj !== "object") {
        return;
    }

    if (Array.isArray(obj)) {
        for (const item of obj) {
            collectReferencedHeredocs(item, referenced);
        }
        return;
    }

    const parseResult = stringRecordSchema.safeParse(obj);
    if (!parseResult.success) {
        return;
    }
    const record = parseResult.data;
    if (typeof record["$heredoc"] === "string") {
        referenced.add(record["$heredoc"]);
        return;
    }

    for (const value of Object.values(record)) {
        collectReferencedHeredocs(value, referenced);
    }
}

function validateUnusedHeredocs(
    parsedToolCalls: unknown,
    heredocs: Map<string, HeredocContent>,
): void {
    const referenced = new Set<string>();
    collectReferencedHeredocs(parsedToolCalls, referenced);

    const unused = Array.from(heredocs.keys()).filter((d) => !referenced.has(d));
    if (unused.length > 0) {
        throw new HeredocParseError(
            `Heredoc delimiter(s) defined but not referenced: ${unused.join(", ")}`,
        );
    }
}

/**
 * Format parse error for LLM feedback
 */
export function formatParseError(error: ParseResult["error"]): string {
    if (!error) return "";

    const lines = ["[PARSE ERROR]", "---", `Code: ${error.code}`, `Message: ${error.message}`];

    if (error.suggestion) {
        lines.push(`Suggestion: ${error.suggestion}`);
    }

    lines.push("---");
    lines.push("Please fix the tool-call format and try again.");

    return lines.join("\n");
}

/**
 * Format tool results for LLM context
 * Provides structured, actionable feedback instead of raw JSON
 */
export function formatToolResults(
    toolCalls: ToolCall[],
    results: ToolResult[],
    formatter?: ToolResultFormatter,
): string {
    const parts: string[] = ["===== TOOL RESULTS"];

    for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const result = results[i];

        if (result.data?._skipped) {
            continue;
        }

        const formatted = formatter
            ? formatter(toolCall, result)
            : formatSingleToolResult(toolCall, result);
        parts.push(formatted);

        if (i < toolCalls.length - 1) {
            parts.push("");
        }
    }

    return parts.join("\n");
}

function formatSingleToolResult(toolCall: ToolCall, result: ToolResult): string {
    const toolName = toolCall.tool;
    const lines: string[] = [];

    if (result.success) {
        lines.push(`[OK] ${toolName}`);
        lines.push("---");

        switch (toolName) {
            case "file.load": {
                if (isFileLoadData(result.data)) {
                    lines.push(`Loaded: ${String(toolCall.params.path)}`);
                    const rangeStr =
                        result.data.loaded_range?.map((r) => `${r[0]}-${r[1]}`).join(", ") ||
                        "full file";
                    lines.push(`Lines: ${rangeStr}`);
                    lines.push(`Total: ${result.data.total_lines} lines`);
                    lines.push("File is now in workspace. View it in FILE WORKSPACE section.");
                }
                break;
            }
            case "file.edit": {
                if (isFileEditData(result.data)) {
                    lines.push(`Edited: ${String(toolCall.params.path)}`);
                    if (result.data.applied.length > 0) {
                        lines.push(`Applied ${result.data.applied.length} edit(s):`);
                        for (const edit of result.data.applied) {
                            lines.push(
                                `  - ${edit.mode} at lines ${edit.matchedRange[0]}-${edit.matchedRange[1]} → ${edit.newRange[0]}-${edit.newRange[1]}`,
                            );
                        }
                    }
                    if (result.data.errors.length > 0) {
                        lines.push(`Failed ${result.data.errors.length} edit(s):`);
                        for (const err of result.data.errors) {
                            lines.push(`  - Edit ${err.index}: ${err.message}`);
                        }
                    }
                    const totalLines = result.data.file_state?.total_lines;
                    if (totalLines !== undefined) {
                        lines.push(`File now has ${totalLines} lines.`);
                    }
                }
                break;
            }
            case "file.create": {
                if (isFileCreateData(result.data)) {
                    lines.push(`Created: ${String(toolCall.params.path)}`);
                    lines.push(`File now has ${result.data.total_lines} lines.`);
                }
                break;
            }
            case "file.overwrite": {
                if (isFileCreateData(result.data)) {
                    lines.push(`Overwrote: ${String(toolCall.params.path)}`);
                    lines.push(`File now has ${result.data.total_lines} lines.`);
                }
                break;
            }
            case "file.unload": {
                lines.push(`Unloaded: ${String(toolCall.params.path)}`);
                lines.push("File removed from workspace context.");
                break;
            }
            case "dir.list": {
                if (isDirListData(result.data)) {
                    lines.push(`Listed: ${String(toolCall.params.path)}`);
                    lines.push(
                        `Found ${result.data.count} entries (${result.data.files} files, ${result.data.dirs} directories)`,
                    );
                    lines.push("Directory listing is in DIRECTORY WORKSPACE section.");
                }
                break;
            }
            case "dir.unload": {
                lines.push(`Unloaded: ${String(toolCall.params.path)}`);
                lines.push("Directory removed from workspace context.");
                break;
            }
            case "todo.set": {
                const items: unknown = toolCall.params.items;
                const itemCount = Array.isArray(items) ? items.length : 0;
                lines.push(`Set ${itemCount} todo items`);
                lines.push("View todo list in TODO section.");
                break;
            }
            case "todo.update": {
                lines.push(
                    `Updated: ${String(toolCall.params.text)} → ${String(toolCall.params.state)}`,
                );
                break;
            }
            case "task.ask": {
                lines.push(`Asked user: ${String(toolCall.params.question)}`);
                const answer =
                    isPlainObject(result.data) && typeof result.data.answer === "string"
                        ? result.data.answer
                        : "";
                lines.push(`Answer: ${answer}`);
                break;
            }
            case "task.choose": {
                lines.push(`Asked user to choose: ${String(toolCall.params.question)}`);
                const selection =
                    isPlainObject(result.data) && typeof result.data.selection === "string"
                        ? result.data.selection
                        : "";
                lines.push(`Selection: ${selection}`);
                break;
            }
            case "task.notepad": {
                lines.push(
                    `Notepad updated with mode: ${String(toolCall.params.mode || "append")}`,
                );
                if (isTaskNotepadData(result.data)) {
                    lines.push(`Total notepad lines: ${result.data.total_lines}`);
                } else {
                    lines.push("Total notepad lines: 0");
                }
                break;
            }
            case "task.end": {
                lines.push("Task completed.");
                lines.push(`Result: ${String(toolCall.params.reason || "No reason provided")}`);
                break;
            }
            case "shell.exec": {
                if (isShellExecData(result.data)) {
                    lines.push(`Executed: ${String(toolCall.params.command)}`);
                    lines.push(`Exit code: ${result.data.exit_code}`);
                    if (result.data.stdout) {
                        lines.push(`stdout:\n${truncate(result.data.stdout, 500)}`);
                    }
                    if (result.data.stderr) {
                        lines.push(`stderr:\n${truncate(result.data.stderr, 500)}`);
                    }
                }
                break;
            }
            case "snapshot.create": {
                lines.push(`Created snapshot: ${result.data?.snapshot_id || "unknown"}`);
                if (result.data?.label) {
                    lines.push(`Label: ${result.data.label}`);
                }
                lines.push(`Trigger: ${result.data?.trigger || "llm_manual"}`);
                break;
            }
            default: {
                lines.push(JSON.stringify(result.data, null, 2));
            }
        }
    } else {
        lines.push(`[FAIL] ${toolName}`);
        lines.push("---");
        lines.push(`Code: ${result.error?.code}`);
        lines.push(`Message: ${result.error?.message}`);

        if (result.error?.details) {
            lines.push("Details:");
            for (const [key, value] of Object.entries(result.error.details)) {
                lines.push(`  ${key}: ${JSON.stringify(value)}`);
            }
        }

        if (result.error?.suggestion) {
            lines.push(`Suggestion: ${result.error.suggestion}`);
        }

        if (result.error?.candidates) {
            lines.push("Possible matches:");
            for (const c of result.error.candidates) {
                lines.push(`  Line ${c.line}: ${c.preview}`);
            }
        }
    }

    return lines.join("\n");
}

function truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return (
        text.slice(0, maxLength) + `\n... (${text.length - maxLength} more characters truncated)`
    );
}
