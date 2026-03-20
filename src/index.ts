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
export { FileEditTool } from "./tools/file/file-edit";
export { TodoSetTool } from "./tools/todo/todo-set";
export { TodoUpdateTool } from "./tools/todo/todo-update";
export { TaskEndTool } from "./tools/task/task-end";
export { ShellExecTool } from "./tools/shell/shell-exec";

// LLM Client
export { OpenAIClient } from "./llm/openai-client";

// Types
export * from "./types";
import type { DiogenesConfig } from "./types";
import { DiogenesContextManager } from "./context";
import { formatToolResults, parseToolCalls } from "./utils/tool-parser";
import { DirListTool } from "./tools/dir/dir-list";
import { DirUnloadTool } from "./tools/dir/dir-unload";
import { FileLoadTool } from "./tools/file/file-load";
import { FileUnloadTool } from "./tools/file/file-unload";
import { FileEditTool } from "./tools/file/file-edit";
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
    contextManager.registerTool(new FileEditTool(workspace));
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

// Re-export utility functions
export { parseToolCalls, formatToolResults } from "./utils/tool-parser";

// ==================== High-Level Task Execution Interface ====================

/**
 * Options for task execution
 */
export interface TaskExecutionOptions {
    maxIterations?: number;
    onIterationStart?: (iteration: number) => void;
    onIterationComplete?: (iteration: number, response: string) => void;
    onToolCall?: (toolCalls: any[]) => void;
    onToolResult?: (toolName: string, result: any) => void;
    onError?: (error: Error) => void;
}

/**
 * Execute a task with LLM until completion
 *
 * This is a high-level interface that:
 * 1. Sets up the task in the system prompt
 * 2. Runs LLM cycles until task.end is called or max iterations reached
 * 3. Returns the final result
 */
export async function executeTask(
    taskDescription: string,
    config?: DiogenesConfig,
    options: TaskExecutionOptions = {},
): Promise<{
    success: boolean;
    result?: string;
    error?: string;
    iterations: number;
    taskEnded: boolean;
}> {
    const maxIterations = options.maxIterations || 20;
    const diogenes = createDiogenes(config);

    // Check if LLM client is available
    if (!diogenes.hasLLMClient()) {
        throw new Error(
            "LLM client not configured. Please provide API key in config.llm.apiKey",
        );
    }

    // Set the task in the system prompt
    diogenes.setTask(taskDescription);

    let iterations = 0;
    let taskEnded = false;
    let finalResult: string | undefined;

    const messageList: { role: "system" | "user" | "assistant"; content: string }[] = [];

    try {
        while (iterations < maxIterations && !taskEnded) {
            iterations++;

            if (options.onIterationStart) {
                options.onIterationStart(iterations);
            }

            // Run LLM to get response
            const prompt = diogenes.buildPrompt();
            const messages = [
                {
                    role: "system" as const,
                    content: prompt,
                },
                ...messageList
            ]

            // Call LLM API directly (not using runLLMCycle since we want to handle tool execution)
            const llmClient = diogenes.getLLMClient();
            if (!llmClient) {
                throw new Error("LLM client not available");
            }

            const response = await llmClient.createChatCompletion(messages, {
                temperature: diogenes.getLLMConfig().temperature,
                max_tokens: diogenes.getLLMConfig().maxTokens,
            });

            messageList.push({
                role: "assistant",
                content: response,
            });

            if (options.onIterationComplete) {
                options.onIterationComplete(iterations, response);
            }

            // Check if task.end was called by parsing tool calls
            const toolCalls = parseToolCalls(response);

            if (options.onToolCall && toolCalls.length > 0) {
                options.onToolCall(toolCalls);
            }

            // Execute tool calls if any
            if (toolCalls.length > 0) {
                const results = await diogenes.executeToolCalls(toolCalls);

                // Call onToolResult callback for each tool result
                if (options.onToolResult) {
                    for (let i = 0; i < toolCalls.length; i++) {
                        options.onToolResult(toolCalls[i].tool, results[i]);
                    }
                }

                // Check if any tool call is task.end
                for (let i = 0; i < toolCalls.length; i++) {
                    const toolCall = toolCalls[i];
                    if (toolCall.tool === "task.end") {
                        taskEnded = true;
                        finalResult = `Task completed: ${toolCall.params?.reason || "No reason provided"}`;
                        break;
                    }
                }

                messageList.push({
                    role: "system",
                    content: formatToolResults(toolCalls, results)
                });
            }

            // If task ended, break the loop
            if (taskEnded) {
                break;
            }

            // Safety check: if no tool calls were made, we might be stuck
            if (toolCalls.length === 0 && iterations > 3) {
                console.warn(
                    `No tool calls made in iteration ${iterations}. Task might be stuck.`,
                );
            }
        }

        if (!taskEnded && iterations >= maxIterations) {
            return {
                success: false,
                error: `Task did not complete within ${maxIterations} iterations`,
                iterations,
                taskEnded: false,
            };
        }

        return {
            success: true,
            result: finalResult,
            iterations,
            taskEnded: true,
        };
    } catch (error) {
        if (options.onError) {
            options.onError(error as Error);
        }

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            iterations,
            taskEnded: false,
        };
    }
}

/**
 * Simple synchronous task execution with callback for progress
 */
export function executeTaskSimple(
    taskDescription: string,
    config?: DiogenesConfig,
    onProgress?: (message: string) => void,
): Promise<{
    success: boolean;
    result?: string;
    error?: string;
}> {
    return executeTask(taskDescription, config, {
        maxIterations: 10,
        onIterationComplete: (iteration, response) => {
            if (onProgress) {
                onProgress(
                    `Iteration ${iteration}: ${response.substring(0, 100)}...`,
                );
            }
        },
        onToolCall: (toolCalls) => {
            if (onProgress) {
                onProgress(`Executing ${toolCalls.length} tool call(s)...`);
            }
        },
        onToolResult: () => {
            // Not used in simple mode
        },
        onError: (error) => {
            if (onProgress) {
                onProgress(`Error: ${error.message}`);
            }
        },
    });
}
