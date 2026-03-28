/**
 * Tool registry and execution system
 */

import { z } from "zod";

import { ToolCall, ToolResult, ToolDefinition } from "../types";
import { BaseTool } from "./base-tool";

export class ToolRegistry {
    private tools: Map<string, BaseTool<z.ZodType>> = new Map();

    register(tool: BaseTool<z.ZodType>): void {
        const def = tool.getDefinition();
        const fullName = `${def.namespace}.${def.name}`;
        this.tools.set(fullName, tool);
    }

    getTool(name: string): BaseTool<z.ZodType> | undefined {
        return this.tools.get(name);
    }

    getToolDefinition(name: string): ToolDefinition | undefined {
        const tool = this.tools.get(name);
        return tool?.getDefinition();
    }

    getAllDefinitions(): ToolDefinition[] {
        return Array.from(this.tools.values()).map((tool) => tool.getDefinition());
    }

    async executeToolCall(toolCall: ToolCall): Promise<ToolResult> {
        const tool = this.tools.get(toolCall.tool);
        if (!tool) {
            return {
                success: false,
                error: {
                    code: "UNKNOWN_TOOL",
                    message: `Tool '${toolCall.tool}' not found`,
                    suggestion: "Check available tools with getToolDefinitions()",
                },
            };
        }

        try {
            // execute() now handles validation internally using the schema
            return await tool.execute(toolCall.params);
        } catch (error) {
            return {
                success: false,
                error: {
                    code: "EXECUTION_ERROR",
                    message: `Error executing tool '${toolCall.tool}': ${error instanceof Error ? error.message : String(error)}`,
                    details: {
                        error: error instanceof Error ? error.stack : String(error),
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
