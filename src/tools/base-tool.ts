/**
 * Base tool interface and abstract class
 */

import { z } from "zod";
import { ToolDefinition, ToolResult } from "../types";

export abstract class BaseTool {
    protected definition: ToolDefinition;
    protected schema: z.ZodType;

    constructor(definition: ToolDefinition) {
        this.definition = definition;
        this.schema = this.buildSchema(definition);
    }

    getDefinition(): ToolDefinition {
        return this.definition;
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

    protected success(data: Record<string, unknown>): ToolResult {
        return {
            success: true,
            data,
        };
    }

    protected error(
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
