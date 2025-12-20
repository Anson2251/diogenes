/**
 * Utility functions for parsing and formatting tool calls
 */

import { ToolCall, ToolResult } from "../types";

/**
 * Parse tool calls from LLM response
 */
export function parseToolCalls(text: string): ToolCall[] {
    // Look for the last code block labeled tool-call
    const toolCallRegex = /```tool-call\s*([\s\S]*?)```/g;
    const matches = [...text.matchAll(toolCallRegex)];

    if (matches.length === 0) {
        return [];
    }

    const lastMatch = matches[matches.length - 1];
    const jsonContent = lastMatch[1].trim();

    try {
        const toolCalls = JSON.parse(jsonContent);
        if (!Array.isArray(toolCalls)) {
            throw new Error("Tool calls must be an array");
        }
        return toolCalls;
    } catch (error) {
        throw new Error(
            `Failed to parse tool calls: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
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