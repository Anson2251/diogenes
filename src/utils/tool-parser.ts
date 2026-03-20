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

/**
 * Parse tool calls from LLM response.
 * Collects all tool-call code blocks and merges them into a single array.
 * Validates that tool names are recognized before returning.
 */
export function parseToolCalls(text: string): ToolCall[] {
  // Look for all code blocks labeled tool-call
  const toolCallRegex = /```tool-call\s*([\s\S]*?)```/g;
  const matches = [...text.matchAll(toolCallRegex)];
  if (matches.length === 0) {
    return [];
  }

  const allToolCalls: ToolCall[] = [];

  // Process all matches, not just the last one
  for (const match of matches) {
    const jsonContent = match[1].trim();

    try {
      const toolCalls = JSON.parse(jsonContent);
      if (!Array.isArray(toolCalls)) {
        throw new Error("Tool calls must be an array");
      }

      // Validate each tool call has a valid tool name
      for (const toolCall of toolCalls) {
        if (!toolCall.tool || typeof toolCall.tool !== "string") {
          throw new Error("Tool call missing required 'tool' field");
        }
        if (!VALID_TOOL_NAMES.has(toolCall.tool)) {
          throw new Error(`Unknown tool name: ${toolCall.tool}`);
        }
        if (!toolCall.params || typeof toolCall.params !== "object") {
          throw new Error(`Tool call ${toolCall.tool} missing required 'params' field`);
        }
      }

      allToolCalls.push(...toolCalls);
    } catch (error) {
      throw new Error(
        `Failed to parse tool calls: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return allToolCalls;
}

/**
 * Format tool results for LLM context
 */
export function formatToolResults(toolCalls: ToolCall[], results: ToolResult[]): string {
    const parts: string[] = [];

    for (let i = 0; i < toolCalls.length; i++) {
        const toolCall = toolCalls[i];
        const result = results[i];

        if (result.success) {
            parts.push(`=========TOOL RESULT: ${toolCall.tool}`);
            parts.push(JSON.stringify(result.data, null, 2));
            parts.push("=========");
        } else {
            parts.push(`=========TOOL ERROR: ${toolCall.tool}`);
            parts.push(`Error: ${result.error?.code}`);
            parts.push(`Message: ${result.error?.message}`);
            if (result.error?.details) {
                parts.push(JSON.stringify(result.error.details, null, 2));
            }
            if (result.error?.suggestion) {
                parts.push(`Suggestion: ${result.error.suggestion}`);
            }
            parts.push("=========");
        }

        if (i < toolCalls.length - 1) {
            parts.push(""); // Empty line between results
        }
    }

    return parts.join("\n");
}