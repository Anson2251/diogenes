/**
 * ToolCallManager - Unified interface for handling tool calls
 *
 * Encapsulates the complexity of different tool call sources:
 * 1. Native API mode: Tool calls from API response (OpenAI/DeepSeek/Claude)
 * 2. Text mode: Tool calls parsed from assistant message content
 *
 * Diogenes core only deals with the unified ToolCall format: { tool, params }
 */

import { z } from "zod";

import type { ToolCall, ToolResult } from "../types";
import { parseToolCalls, tryParsePartialToolCalls, formatToolResults, formatParseError, type ToolResultFormatter } from "./tool-parser";

// Zod schema for tool call params validation
const ToolCallParamsSchema = z.record(z.string(), z.unknown());

/**
 * Native API tool call format (from OpenAI/DeepSeek/Claude API)
 */
export interface NativeToolCall {
    id: string;
    type: "function";
    function: {
        name: string;
        arguments: string; // JSON string
    };
}

/**
 * Tool call source type
 */
export type ToolCallSource = "native" | "text";

/**
 * Unified tool call result
 */
export interface ToolCallResult {
    success: boolean;
    toolCalls: ToolCall[];
    source: ToolCallSource;
    error?: {
        code: string;
        message: string;
        suggestion?: string;
    };
}

/**
 * LLM response containing potential tool calls
 */
export interface LLMResponse {
    content: string;
    toolCalls?: NativeToolCall[];
    reasoning?: string;
}

/**
 * ToolCallManager configuration
 */
export interface ToolCallManagerConfig {
    /**
     * Prefer native API tool calls when available
     * @default true
     */
    preferNative?: boolean;

    /**
     * Enable fallback to text parsing if native returns no tool calls
     * @default true
     */
    enableTextFallback?: boolean;

    /**
     * Validate tool names against known tools
     * @default true
     */
    validateToolNames?: boolean;

    /**
     * Whether the model supports interleaved thinking (reasoning between tool calls).
     * When enabled, reasoning content is preserved and passed back to the model.
     * @default false
     */
    supportsInterleavedThinking?: boolean;
}

/**
 * ToolCallManager - Main entry point for tool call handling
 *
 * Usage:
 * ```typescript
 * const manager = new ToolCallManager();
 *
 * // From native API response
 * const result = manager.processResponse({
 *     content: "I'll help you with that",
 *     toolCalls: apiResponse.tool_calls
 * });
 *
 * // Or from text (legacy mode)
 * const result = manager.processResponse({
 *     content: "```tool-call\n[{...}]\n```"
 * });
 * ```
 */
export class ToolCallManager {
    private config: Required<ToolCallManagerConfig>;

    constructor(config: ToolCallManagerConfig = {}) {
        this.config = {
            preferNative: config.preferNative ?? true,
            enableTextFallback: config.enableTextFallback ?? true,
            validateToolNames: config.validateToolNames ?? true,
            supportsInterleavedThinking: config.supportsInterleavedThinking ?? false,
        };
    }

    /**
     * Process LLM response and extract tool calls
     * Automatically detects source type and converts to unified format
     */
    processResponse(response: LLMResponse): ToolCallResult {
        // Try native API tool calls first if available and preferred
        if (this.config.preferNative && response.toolCalls && response.toolCalls.length > 0) {
            const toolCalls = this.convertNativeToolCalls(response.toolCalls);
            return {
                success: true,
                toolCalls,
                source: "native",
            };
        }

        // Fallback to text parsing
        if (this.config.enableTextFallback && response.content) {
            const parseResult = parseToolCalls(response.content);

            if (parseResult.success && parseResult.toolCalls) {
                return {
                    success: true,
                    toolCalls: parseResult.toolCalls,
                    source: "text",
                };
            }

            // No tool calls found in text - this is OK (assistant may just be chatting)
            if (!parseResult.error) {
                return {
                    success: true,
                    toolCalls: [],
                    source: "text",
                };
            }

            // Parse error
            return {
                success: false,
                toolCalls: [],
                source: "text",
                error: parseResult.error,
            };
        }

        // No tool calls found
        return {
            success: true,
            toolCalls: [],
            source: response.toolCalls ? "native" : "text",
        };
    }

    /**
     * Try to parse partial tool calls from streaming content
     * Useful for real-time UI updates during streaming
     */
    tryParsePartial(content: string): {
        completeToolCalls: ToolCall[];
        hasIncomplete: boolean;
        isInToolCallBlock: boolean;
    } {
        const result = tryParsePartialToolCalls(content);
        return {
            completeToolCalls: result.completeToolCalls,
            hasIncomplete: result.hasIncompleteToolCall,
            isInToolCallBlock: result.isInToolCallBlock,
        };
    }

    /**
     * Convert native API tool calls to Diogenes format
     */
    private convertNativeToolCalls(nativeToolCalls: NativeToolCall[]): ToolCall[] {
        return nativeToolCalls.map((tc) => {
            let params: Record<string, unknown> = {};
            try {
                const parsed: unknown = JSON.parse(tc.function.arguments);
                const result = ToolCallParamsSchema.safeParse(parsed);
                if (result.success) {
                    params = result.data;
                }
            } catch {
                // Keep default empty params
            }

            return {
                tool: tc.function.name,
                params,
            };
        });
    }

    /**
     * Format tool results for LLM context
     */
    formatResults(toolCalls: ToolCall[], results: ToolResult[], formatter?: ToolResultFormatter): string {
        return formatToolResults(toolCalls, results, formatter);
    }

    /**
     * Format parse error for LLM feedback
     */
    formatError(error: NonNullable<ToolCallResult["error"]>): string {
        return formatParseError(error);
    }

    /**
     * Check if response has tool calls (before processing)
     */
    hasToolCalls(response: LLMResponse): boolean {
        if (response.toolCalls && response.toolCalls.length > 0) {
            return true;
        }
        if (response.content) {
            const partial = this.tryParsePartial(response.content);
            return partial.completeToolCalls.length > 0 || partial.isInToolCallBlock;
        }
        return false;
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<ToolCallManagerConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): Required<ToolCallManagerConfig> {
        return { ...this.config };
    }
}

/**
 * Create a ToolResponse message for the conversation
 */
export function createToolResponseMessage(
    toolCallId: string,
    content: string
): { role: "tool"; tool_call_id: string; content: string } {
    return {
        role: "tool",
        tool_call_id: toolCallId,
        content,
    };
}

/**
 * Create an assistant message with tool calls for the conversation
 */
export function createAssistantMessageWithToolCalls(
    content: string,
    toolCalls: NativeToolCall[]
): { role: "assistant"; content: string; tool_calls: NativeToolCall[] } {
    return {
        role: "assistant",
        content,
        tool_calls: toolCalls,
    };
}
