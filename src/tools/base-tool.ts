/**
 * Base tool interface and abstract class
 */

import { TRON } from "@tron-format/tron";
import { z } from "zod";

import { ToolCall, ToolDefinition, ToolResult } from "../types";

export interface ToolOutputFormatter {
    /**
     * Format the tool result for display/logging.
     * Return undefined to use default formatting.
     */
    formatResult(result: ToolResult): string | undefined;
    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string;
}

export abstract class BaseTool<TParams extends z.ZodType> implements ToolOutputFormatter {
    protected definition: ToolDefinition;
    protected abstract schema: TParams;

    constructor(definition: ToolDefinition) {
        this.definition = definition;
    }

    getDefinition(): ToolDefinition {
        return this.definition;
    }

    /**
     * Format the tool result for display/logging.
     * Override this method to customize output for specific tools.
     * Return undefined to use the default formatter.
     *
     * @example
     * ```typescript
     * formatResult(result: ToolResult): string | undefined {
     *     if (result.success && result.data?.count !== undefined) {
     *         return `Found ${result.data.count} items`;
     *     }
     *     return undefined; // Use default formatting
     * }
     * ```
     */
    formatResult(_result: ToolResult): string | undefined {
        return undefined; // Use default formatting
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success) {
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                TRON.stringify(result.data ?? { success: true }),
            ].join("\n");
        }

        return [
            `[FAIL] ${toolCall.tool}`,
            "---",
            TRON.stringify(result.error ?? { message: `${toolCall.tool} failed` }),
        ].join("\n");
    }

    /**
     * Execute the tool with automatic parameter validation.
     * This method validates params against the schema and calls run() if valid.
     */
    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.schema.safeParse(params);
        if (!validation.success) {
            return this.error("INVALID_PARAMS", "Validation failed", {
                issues: validation.error.issues,
            });
        }
        return this.run(validation.data);
    }

    /**
     * Abstract method that must be implemented by all tool classes.
     * This is the actual implementation of the tool's functionality.
     */
    abstract run(params: z.infer<TParams>): ToolResult | Promise<ToolResult>;

    success(data: Record<string, unknown>): ToolResult {
        return {
            success: true,
            data,
        };
    }

    error(
        code: string,
        message: string,
        details?: Record<string, unknown>,
        suggestion?: string,
    ): ToolResult {
        return {
            success: false,
            error: {
                code,
                message,
                details,
                suggestion,
            },
        };
    }
}
