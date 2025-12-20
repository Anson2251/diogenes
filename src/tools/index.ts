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

            // Stop on first error (unless we implement continue_on_error later)
            if (!result.success) {
                break;
            }
        }

        return results;
    }
}

// Default tool definitions from RFC
export const DEFAULT_TOOL_DEFINITIONS: ToolDefinition[] = [
    {
        namespace: "shell",
        name: "exec",
        description: "Execute a shell command",
        params: {
            command: { type: "string", description: "Command to execute" },
            cwd: {
                type: "string",
                optional: true,
                description: "Working directory",
            },
            timeout: {
                type: "number",
                optional: true,
                description: "Timeout in seconds (default: 30)",
            },
        },
        returns: {
            stdout: "Command stdout",
            stderr: "Command stderr",
            exit_code: "Command exit code",
        },
    },
    {
        namespace: "dir",
        name: "list",
        description: "List directory contents and load into workspace",
        params: {
            path: { type: "string", description: "Directory path" },
        },
        returns: {},
    },
    {
        namespace: "dir",
        name: "unload",
        description: "Remove directory from workspace",
        params: {
            path: { type: "string", description: "Directory path" },
        },
        returns: {
            success: "Whether operation succeeded",
        },
    },
    {
        namespace: "file",
        name: "load",
        description: "Load file content into workspace",
        params: {
            path: { type: "string", description: "File path" },
            start: {
                type: "number",
                optional: true,
                description: "Start line (1-indexed)",
            },
            end: {
                type: "number",
                optional: true,
                description: "End line (inclusive)",
            },
        },
        returns: {
            total_lines: "Total lines in file",
            loaded_range: "Array of [start, end] lines loaded",
        },
    },
    {
        namespace: "file",
        name: "unload",
        description: "Remove file from workspace",
        params: {
            path: { type: "string", description: "File path" },
        },
        returns: {
            success: "Whether operation succeeded",
        },
    },
    {
        namespace: "file",
        name: "edit",
        description: "Apply structured edits to a file",
        params: {
            path: { type: "string", description: "File path" },
            options: {
                type: "object",
                optional: true,
                description: "Edit options",
            },
            edits: {
                type: "array<Edit>",
                description: "List of edit operations",
            },
        },
        returns: {
            success: "Whether all edits succeeded",
            applied: "Array of applied edit results",
            errors: "Array of edit errors",
            file_state: "File state after edits",
        },
    },
    {
        namespace: "file",
        name: "create",
        description: "Create a new file with content",
        params: {
            path: { type: "string", description: "File path" },
            content: { type: "string", description: "File content" },
        },
        returns: {
            success: "Whether operation succeeded",
            total_lines: "Total lines in created file",
        },
    },
    {
        namespace: "file",
        name: "overwrite",
        description: "Overwrite entire file content",
        params: {
            path: { type: "string", description: "File path" },
            content: { type: "string", description: "New content" },
        },
        returns: {
            success: "Whether operation succeeded",
            total_lines: "Total lines in file after overwrite",
        },
    },
    {
        namespace: "file",
        name: "append",
        description: "Append content to end of file",
        params: {
            path: { type: "string", description: "File path" },
            content: { type: "string", description: "Content to append" },
        },
        returns: {
            success: "Whether operation succeeded",
            total_lines: "Total lines in file after append",
        },
    },
    {
        namespace: "search",
        name: "files",
        description: "Search for pattern across files",
        params: {
            pattern: {
                type: "string",
                description: "Search pattern (regex supported)",
            },
            path: {
                type: "string",
                optional: true,
                description: "Directory to search (default: workspace root)",
            },
            include: {
                type: "string",
                optional: true,
                description: "File glob pattern to include",
            },
            exclude: {
                type: "string",
                optional: true,
                description: "File glob pattern to exclude",
            },
            max_results: {
                type: "number",
                optional: true,
                description: "Maximum results (default: 50)",
            },
        },
        returns: {
            matches: "Array of search matches",
            truncated: "Whether results were truncated",
        },
    },
    {
        namespace: "search",
        name: "symbols",
        description: "Search for symbol definitions (planning, not implemented yet)",
        params: {
            name: { type: "string", description: "Symbol name pattern" },
            kind: {
                type: "string",
                optional: true,
                description: '"function" | "class" | "variable" | "all"',
            },
            path: {
                type: "string",
                optional: true,
                description: "Directory to search",
            },
        },
        returns: {
            symbols: "Array of symbol definitions",
        },
    },
    {
        namespace: "todo",
        name: "set",
        description: "Overwrite entire todo list",
        params: {
            items: {
                type: "array<object>",
                description: "Array of todo items with text and state",
            },
        },
        returns: {
            success: "Whether operation succeeded",
        },
    },
    {
        namespace: "todo",
        name: "update",
        description: "Update state of a todo item",
        params: {
            text: {
                type: "string",
                description: "Item text (must match exactly)",
            },
            state: {
                type: "string",
                description: '"done" | "active" | "pending"',
            },
        },
        returns: {
            success: "Whether operation succeeded",
        },
    },
    {
        namespace: "todo",
        name: "append",
        description: "Add new items to todo list",
        params: {
            items: {
                type: "array<string>",
                description: "New item descriptions",
            },
        },
        returns: {
            success: "Whether operation succeeded",
            total_items: "Total items in todo list after append",
        },
    },
    {
        namespace: "task",
        name: "end",
        description: "End the current task",
        params: {
            reason: {
                type: "string",
                description: "Brief summary on why the task is over",
            },
            summary: {
                type: "string",
                description: "What agent done in this task",
            },
        },
        returns: {
            success: "Whether task ended successfully",
        },
    },
    {
        namespace: "mcp",
        name: "call",
        description: "Call an MCP-protocol tool",
        params: {
            server: { type: "string", description: "MCP server identifier" },
            method: { type: "string", description: "Method name" },
            params: { type: "object", description: "Method parameters" },
        },
        returns: {
            result: "MCP tool result",
        },
    },
];
