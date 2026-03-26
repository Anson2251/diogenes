/**
 * Base tool interface and abstract class
 */

import { z } from "zod";
import { ToolCall, ToolDefinition, ToolResult } from "../types";
import { TRON } from "@tron-format/tron";

export interface ToolOutputFormatter {
    /**
     * Format the tool result for display/logging.
     * Return undefined to use default formatting.
     */
    formatResult(result: ToolResult): string | undefined;
    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string;
}

export abstract class BaseTool implements ToolOutputFormatter {
    protected definition: ToolDefinition;
    protected schema: z.ZodType;

    constructor(definition: ToolDefinition) {
        this.definition = definition;
        this.schema = this.buildSchema(definition);
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

    abstract execute(params: unknown): Promise<ToolResult>;

    validateParams(params: unknown): {
        valid: boolean;
        errors: string[];
        data?: unknown;
    } {
        try {
            const validated = this.schema.parse(params);
            return {
                valid: true,
                errors: [],
                data: validated,
            };
        } catch (error) {
            if (error instanceof z.ZodError) {
                const errors = error.issues.map(
                    (err) => `${err.path.join(".")}: ${err.message}`,
                );
                return {
                    valid: false,
                    errors,
                };
            }
            return {
                valid: false,
                errors: [
                    `Validation error: ${error instanceof Error ? error.message : String(error)}`,
                ],
            };
        }
    }

    private buildSchema(definition: ToolDefinition): z.ZodType {
        const shape: Record<string, z.ZodType> = {};

        for (const [paramName, paramDef] of Object.entries(definition.params)) {
            let schema: z.ZodType;

            switch (paramDef.type) {
                case "string":
                    schema = z.string();
                    break;
                case "number":
                    schema = z.number();
                    break;
                case "bool":
                    schema = z.boolean();
                    break;
                case "array":
                    schema = z.array(z.any());
                    break;
                case "object":
                    schema = z.object({}).loose(); // Allow any object
                    break;
                default:
                    if (paramDef.type.startsWith("array<")) {
                        // For now, treat all arrays as any[]
                        schema = z.array(z.any());
                    } else {
                        schema = z.any();
                    }
            }

            if (paramDef.optional) {
                shape[paramName] = schema.optional();
            } else {
                shape[paramName] = schema;
            }
        }

        return z.object(shape);
    }

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
