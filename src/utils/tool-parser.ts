/**
 * Utility functions for parsing and formatting tool calls
 */

import { ToolCall, ToolResult } from "../types";

// Valid tool names for validation
const VALID_TOOL_NAMES = new Set([
  "dir.list",
  "dir.unload",
  "file.load",
  "file.unload",
  "file.edit",
  "file.create",
  "file.overwrite",
  "file.append",
  "todo.set",
  "todo.update",
  "todo.append",
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

/**
 * Parse tool calls from LLM response.
 * Returns a result object with success status instead of throwing.
 */
export function parseToolCalls(text: string): ParseResult {
  const toolCallRegex = /```tool-call\s*([\s\S]*?)```/g;
  const matches = [...text.matchAll(toolCallRegex)];
  
  if (matches.length === 0) {
    return { success: true, toolCalls: [] };
  }

  const allToolCalls: ToolCall[] = [];
  const errors: string[] = [];

  for (const match of matches) {
    const jsonContent = match[1].trim();

    try {
      const parsed = JSON.parse(jsonContent);
      
      if (!Array.isArray(parsed)) {
        errors.push(`Tool calls must be an array, got: ${typeof parsed}`);
        continue;
      }

      for (const toolCall of parsed) {
        const validation = validateToolCall(toolCall);
        if (validation.valid) {
          allToolCalls.push(toolCall);
        } else {
          errors.push(validation.error!);
        }
      }
    } catch (error) {
      errors.push(`JSON parse error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0 && allToolCalls.length === 0) {
    return {
      success: false,
      error: {
        code: "PARSE_ERROR",
        message: errors.join("; "),
        suggestion: "Ensure tool-call block contains valid JSON array with 'tool' and 'params' fields",
      },
    };
  }

  return { success: true, toolCalls: allToolCalls };
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
export function formatToolResults(toolCalls: ToolCall[], results: ToolResult[]): string {
    const parts: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const result = results[i];
        
        if (result.data?._skipped) {
            continue;
        }
        
        const formatted = formatSingleToolResult(toolCall, result);
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
                lines.push(`Updated: ${toolCall.params.index} → ${toolCall.params.state}`);
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
                lines.push(`Exit code: ${data.exitCode}`);
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