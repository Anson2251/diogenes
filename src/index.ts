/**
 * Main entry point for Diogenes framework
 */

export { DiogenesContextManager } from "./context";
export { WorkspaceManager } from "./context/workspace";
export { PromptBuilder } from "./context/prompt-builder";
export { ToolRegistry } from "./tools";
export { BaseTool } from "./tools/base-tool";

// Tool implementations
export { DirListTool } from "./tools/dir/dir-list";
export { DirUnloadTool } from "./tools/dir/dir-unload";
export { FileLoadTool } from "./tools/file/file-load";
export { FileUnloadTool } from "./tools/file/file-unload";
export { TodoSetTool } from "./tools/todo/todo-set";
export { TodoUpdateTool } from "./tools/todo/todo-update";
export { TaskEndTool } from "./tools/task/task-end";
export { ShellExecTool } from "./tools/shell/shell-exec";

// Types
export * from "./types";
import type { DiogenesConfig, ToolCall, ToolResult } from "./types";
import { DiogenesContextManager } from "./context";
import { DirListTool } from "./tools/dir/dir-list";
import { DirUnloadTool } from "./tools/dir/dir-unload";
import { FileLoadTool } from "./tools/file/file-load";
import { FileUnloadTool } from "./tools/file/file-unload";
import { TodoSetTool } from "./tools/todo/todo-set";
import { TodoUpdateTool } from "./tools/todo/todo-update";
import { TaskEndTool } from "./tools/task/task-end";
import { ShellExecTool } from "./tools/shell/shell-exec";

/**
 * Create a new Diogenes context manager with default tools
 */
export function createDiogenes(config?: DiogenesConfig) {
    const contextManager = new DiogenesContextManager(config);
    const workspace = contextManager.getWorkspaceManager();
    const configObj = contextManager.getConfig();

    // Register default tools
    contextManager.registerTool(new DirListTool(workspace));
    contextManager.registerTool(new DirUnloadTool(workspace));
    contextManager.registerTool(new FileLoadTool(workspace));
    contextManager.registerTool(new FileUnloadTool(workspace));
    contextManager.registerTool(new TodoSetTool(workspace));
    contextManager.registerTool(new TodoUpdateTool(workspace));
    contextManager.registerTool(new TaskEndTool());
    
    // Register shell tool with security config
    contextManager.registerTool(
        new ShellExecTool(
            configObj.security.workspaceRoot || process.cwd(),
            configObj.security.shell || {
                enabled: true,
                timeout: 30,
                blockedCommands: ["rm -rf", "sudo", ":(){:|:&};:"],
            },
        ),
    );

    return contextManager;
}

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
