/**
 * Utility functions for parsing and formatting tool calls
 */

import { ToolCall, ToolResult } from "../types";

export type ToolResultFormatter = (toolCall: ToolCall, result: ToolResult) => string;

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
  "task.end",
]);

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
      const parsed = JSON.parse(jsonContent);

      if (!Array.isArray(parsed)) {
        errors.push(`Tool calls must be an array, got: ${typeof parsed}`);
        continue;
      }

      for (const toolCall of parsed) {
        const validation = validateToolCall(toolCall);
        if (validation.valid) {
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
        errors.push(`JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  if (hasFatalParseError || (errors.length > 0 && allToolCalls.length === 0)) {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: errors.join("; "),
        suggestion: "Ensure tool-call block contains valid JSON array with 'tool' and 'params' fields, and try to write smaller tool-call blocks. Heredoc can be used to simplify large editing blocks",
      },
    };
  }

  return { success: true, toolCalls: allToolCalls };
}

function extractToolCallBlocks(text: string): { blocks: string[]; errors: string[] } {
  const blocks: string[] = [];
  const errors: string[] = [];
  const lines = text.split('\n');

  let inBlock = false;
  let blockStartIndex = -1;
  let heredocDelimiter: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (!inBlock) {
      if (trimmed === '```tool-call' || trimmed === '```tool') {
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
        } else if (trimmed === '```') {
          // End of block (only if not in heredoc)
          const blockLines = lines.slice(blockStartIndex, i);
          blocks.push(blockLines.join('\n'));
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

function extractHeredocs(blockContent: string): { jsonContent: string; heredocs: Map<string, HeredocContent> } {
  const heredocs = new Map<string, HeredocContent>();
  const lines = blockContent.split('\n');
  const jsonLines: string[] = [];

  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    const heredocMatch = trimmed.match(/^<<<(\w+)$/);

    if (heredocMatch) {
      const delimiter = heredocMatch[1];
      if (heredocs.has(delimiter)) {
        throw new HeredocParseError(`Duplicate heredoc delimiter '${delimiter}' in one tool-call block`);
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

  return { jsonContent: jsonLines.join('\n').trim(), heredocs };
}

/**
 * Resolve heredoc markers in tool call params with actual content.
 */
function resolveHeredocs(toolCall: ToolCall, heredocs: Map<string, HeredocContent>): ToolCall {
  return {
    tool: toolCall.tool,
    params: resolveHeredocsInObject(toolCall.params, heredocs) as Record<string, unknown>,
  };
}

function resolveHeredocsInObject(obj: unknown, heredocs: Map<string, HeredocContent>): unknown {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => resolveHeredocsInObject(item, heredocs));
  }

  const record = obj as Record<string, unknown>;

  if (typeof record['$heredoc'] === 'string') {
    const delimiter = record['$heredoc'];
    const heredoc = heredocs.get(delimiter);
    if (heredoc) {
      return heredoc.lines;
    }
    throw new HeredocParseError(`Heredoc '${delimiter}' not found. Make sure the heredoc is defined in the same tool-call block.`);
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

  const record = obj as Record<string, unknown>;
  if (typeof record["$heredoc"] === "string") {
    referenced.add(record["$heredoc"]);
    return;
  }

  for (const value of Object.values(record)) {
    collectReferencedHeredocs(value, referenced);
  }
}

function validateUnusedHeredocs(parsedToolCalls: unknown, heredocs: Map<string, HeredocContent>): void {
  const referenced = new Set<string>();
  collectReferencedHeredocs(parsedToolCalls, referenced);

  const unused = Array.from(heredocs.keys()).filter((d) => !referenced.has(d));
  if (unused.length > 0) {
    throw new HeredocParseError(`Heredoc delimiter(s) defined but not referenced: ${unused.join(", ")}`);
  }
}

function validateToolCall(toolCall: unknown): { valid: boolean; error?: string } {
  if (!toolCall || typeof toolCall !== "object") {
    return { valid: false, error: "Tool call must be an object" };
  }

  const tc = toolCall as Record<string, unknown>;

  if (!tc.tool || typeof tc.tool !== "string") {
    return { valid: false, error: "Tool call missing required 'tool' field (string)" };
  }

  if (!VALID_TOOL_NAMES.has(tc.tool)) {
    const validNames = Array.from(VALID_TOOL_NAMES).slice(0, 5).join(", ");
    return {
      valid: false,
      error: `Unknown tool: '${tc.tool}'. Valid tools: ${validNames}...`
    };
  }

  if (!tc.params || typeof tc.params !== "object") {
    return { valid: false, error: `Tool '${tc.tool}' missing required 'params' field (object)` };
  }

  return { valid: true };
}

/**
 * Format parse error for LLM feedback
 */
export function formatParseError(error: ParseResult['error']): string {
  if (!error) return "";

  const lines = [
    "[PARSE ERROR]",
    "---",
    `Code: ${error.code}`,
    `Message: ${error.message}`,
  ];

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
                const data = result.data!;
                lines.push(`Loaded: ${toolCall.params.path}`);
                lines.push(`Lines: ${data.loaded_range?.map((r: number[]) => `${r[0]}-${r[1]}`).join(", ") || "full file"}`);
                lines.push(`Total: ${data.total_lines} lines`);
                lines.push("File is now in workspace. View it in FILE WORKSPACE section.");
                break;
            }
            case "file.edit": {
                const data = result.data!;
                lines.push(`Edited: ${toolCall.params.path}`);
                if (data.applied?.length > 0) {
                    lines.push(`Applied ${data.applied.length} edit(s):`);
                    for (const edit of data.applied) {
                        lines.push(`  - ${edit.mode} at lines ${edit.matchedRange[0]}-${edit.matchedRange[1]} → ${edit.newRange[0]}-${edit.newRange[1]}`);
                    }
                }
                if (data.errors?.length > 0) {
                    lines.push(`Failed ${data.errors.length} edit(s):`);
                    for (const err of data.errors) {
                        lines.push(`  - Edit ${err.index}: ${err.message}`);
                    }
                }
                lines.push(`File now has ${data.file_state?.total_lines} lines.`);
                break;
            }
            case "file.create": {
                const data = result.data!;
                lines.push(`Created: ${toolCall.params.path}`);
                lines.push(`File now has ${data.total_lines} lines.`);
                break;
            }
            case "file.overwrite": {
                const data = result.data!;
                lines.push(`Overwrote: ${toolCall.params.path}`);
                lines.push(`File now has ${data.total_lines} lines.`);
                break;
            }
            case "file.unload": {
                lines.push(`Unloaded: ${toolCall.params.path}`);
                lines.push("File removed from workspace context.");
                break;
            }
            case "dir.list": {
                const data = result.data!;
                lines.push(`Listed: ${toolCall.params.path}`);
                lines.push(`Found ${data.count} entries (${data.files} files, ${data.dirs} directories)`);
                lines.push("Directory listing is in DIRECTORY WORKSPACE section.");
                break;
            }
            case "dir.unload": {
                lines.push(`Unloaded: ${toolCall.params.path}`);
                lines.push("Directory removed from workspace context.");
                break;
            }
            case "todo.set": {
                lines.push(`Set ${toolCall.params.items?.length || 0} todo items`);
                lines.push("View todo list in TODO section.");
                break;
            }
            case "todo.update": {
                lines.push(`Updated: ${toolCall.params.text} → ${toolCall.params.state}`);
                break;
            }
            case "task.ask": {
                lines.push(`Asked user: ${toolCall.params.question}`);
                lines.push(`Answer: ${result.data?.answer || ""}`);
                break;
            }
            case "task.choose": {
                lines.push(`Asked user to choose: ${toolCall.params.question}`);
                lines.push(`Selection: ${result.data?.selection || ""}`);
                break;
            }
            case "task.notepad": {
                lines.push(`Notepad updated with mode: ${toolCall.params.mode || "append"}`);
                lines.push(`Total notepad lines: ${result.data?.total_lines || 0}`);
                break;
            }
            case "task.end": {
                lines.push("Task completed.");
                lines.push(`Result: ${toolCall.params.reason || "No reason provided"}`);
                break;
            }
            case "shell.exec": {
                const data = result.data!;
                lines.push(`Executed: ${toolCall.params.command}`);
                lines.push(`Exit code: ${data.exit_code}`);
                if (data.stdout) {
                    lines.push(`stdout:\n${truncate(data.stdout, 500)}`);
                }
                if (data.stderr) {
                    lines.push(`stderr:\n${truncate(data.stderr, 500)}`);
                }
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
    return text.slice(0, maxLength) + `\n... (${text.length - maxLength} more characters truncated)`;
}
