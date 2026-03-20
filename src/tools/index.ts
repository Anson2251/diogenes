/**
 * Tool registry and execution system
 */

import { BaseTool } from "./base-tool";
import { ToolCall, ToolResult, ToolDefinition } from "../types";

export class ToolRegistry {
    private tools: Map<string, BaseTool> = new Map();

    register(tool: BaseTool): void {
        const def = tool.getDefinition();
        const fullName = `${def.namespace}.${def.name}`;
        this.tools.set(fullName, tool);
    }

    getTool(name: string): BaseTool | undefined {
        return this.tools.get(name);
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        return tool?.getDefinition();
    }

    getAllDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) =>
            tool.getDefinition(),
        );
    }

    async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
        const tool = this.tools.get(toolCall.tool);
        if (!tool) {
            return {
                success: false,
                error: {
                    code: "UNKNOWN_TOOL",
                    message: `Tool '${toolCall.tool}' not found`,
                    suggestion:
                        "Check available tools with getToolDefinitions()",
                },
            };
        }

        // Validate parameters
        const validation = tool.validateParams(toolCall.params);
        if (!validation.valid) {
            return {
                success: false,
                error: {
                    code: "INVALID_PARAM",
                    message: `Invalid parameters for tool '${toolCall.tool}'`,
                    details: { errors: validation.errors },
                    suggestion:
                        "Check tool definition for required parameters and types",
                },
            };
        }

        try {
            return await tool.execute(validation.data);
        } catch (error) {
            return {
                success: false,
                error: {
                    code: "EXECUTION_ERROR",
                    message: `Error executing tool '${toolCall.tool}': ${error instanceof Error ? error.message : String(error)}`,
                    details: {
                        error:
                            error instanceof Error
                                ? error.stack
                                : String(error),
                    },
                    suggestion: "Check tool implementation and parameters",
                },
            };
        }
    }

    async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
        const results: ToolResult[] = [];

        for (const toolCall of toolCalls) {
            const result = await this.executeToolCall(toolCall);
            results.push(result);
        }

        return results;
    }
}
