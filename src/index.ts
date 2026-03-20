/**
 * Main entry point for Diogenes framework
 */

export { DiogenesContextManager } from "./context";
export { WorkspaceManager } from "./context/workspace";
export { PromptBuilder } from "./context/prompt-builder";
export { ToolRegistry } from "./tools";
export { BaseTool, ToolOutputFormatter } from "./tools/base-tool";

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
import { Logger, ConsoleLogger, LogLevel, ToolResultData } from "./utils/logger";

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

// ==================== Logger ====================
export {
    Logger,
    LogLevel,
    TUILogger,
    ConsoleLogger,
    NullLogger,
    ToolCallData,
    ToolResultData,
    TaskCompletionData,
} from "./utils/logger";

// ==================== High-Level Task Execution Interface ====================

/**
 * Options for task execution
 */
export interface TaskExecutionOptions {
    maxIterations?: number;
    /**
     * Logger instance for output. Defaults to ConsoleLogger if not provided.
     * Use NullLogger for silent operation.
     */
    logger?: Logger;
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
    const logger = options.logger || new ConsoleLogger();
    const diogenes = createDiogenes(config);

    // Check if LLM client is available
    if (!diogenes.hasLLMClient()) {
        throw new Error(
            "LLM client not configured. Please provide API key in config.llm.apiKey",
        );
    }

    let iterations = 0;
    let taskEnded = false;
    let finalResult: string | undefined;

    const messageList: { role: "system" | "user" | "assistant"; content: string }[] = [];

    const startTime = Date.now();

    try {
        logger.taskStarted(taskDescription);

        // Get system prompt once (it doesn't change)
        const systemPrompt = diogenes.getSystemPrompt();

        while (iterations < maxIterations && !taskEnded) {
            iterations++;

            logger.iterationStart(iterations);

            // Build context sections (without system prompt)
            const contextOnly = diogenes.buildContextOnly();

            // Build messages array:
            // 1. System prompt as system message (first message only)
            // 2. Context + task as user message (first iteration only)
            // 3. Previous conversation history
            const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
                {
                    role: "system" as const,
                    content: systemPrompt,
                },
            ];

            if (iterations === 1) {
                // First iteration: include task description
                messages.push({
                    role: "user" as const,
                    content: `${contextOnly}\n\n========= TASK\n${taskDescription}\n=========`,
                });
            } else {
                // Subsequent iterations: just context, task is in history
                messages.push({
                    role: "user" as const,
                    content: contextOnly,
                });
            }

            // Add previous conversation history
            messages.push(...messageList);

            // Call LLM API directly (not using runLLMCycle since we want to handle tool execution)
            const llmClient = diogenes.getLLMClient();
            if (!llmClient) {
                throw new Error("LLM client not available");
            }

            // Start streaming
            logger.streamStart();

            const response = await llmClient.createChatCompletionStream(
                messages,
                (chunk) => logger.streamChunk(chunk),
                {
                    temperature: diogenes.getLLMConfig().temperature,
                    max_tokens: diogenes.getLLMConfig().maxTokens,
                },
            );

            logger.streamEnd();

            messageList.push({
                role: "assistant",
                content: response,
            });

            // Check if task.end was called by parsing tool calls
            const toolCalls = parseToolCalls(response);

            if (toolCalls.length > 0) {
                logger.toolCalls(toolCalls);
            }

            // Execute tool calls if any
            if (toolCalls.length > 0) {
                const results = await diogenes.executeToolCalls(toolCalls);

                // Log each tool result
                for (let i = 0; i < toolCalls.length; i++) {
                    const toolCall = toolCalls[i];
                    const result = results[i];
                    
                    // Get custom formatter from tool if available
                    const tool = diogenes.getTool(toolCall.tool);
                    if (tool) {
                        const formattedOutput = tool.formatResult(result);
                        if (formattedOutput !== undefined) {
                            // Add formatted output to result for logger to use
                            (result as ToolResultData).formattedOutput = formattedOutput;
                        }
                    }
                    
                    logger.toolResult(toolCall.tool, result);
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
                    role: "user",
                    content: formatToolResults(toolCalls, results)
                });
            }

            // If task ended, break the loop
            if (taskEnded) {
                break;
            }

            // Safety check: if no tool calls were made, we might be stuck
            if (toolCalls.length === 0 && iterations > 3) {
                logger.warn(
                    `No tool calls made in iteration ${iterations}. Task might be stuck.`,
                );
            }
        }

        if (!taskEnded && iterations >= maxIterations) {
            const result = {
                success: false,
                error: `Task did not complete within ${maxIterations} iterations`,
                iterations,
                taskEnded: false,
            };
            logger.taskCompleted(result, Date.now() - startTime);
            return result;
        }

        const result = {
            success: true,
            result: finalResult,
            iterations,
            taskEnded: true,
        };
        logger.taskCompleted(result, Date.now() - startTime);
        return result;
    } catch (error) {
        logger.taskError(error as Error);

        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            iterations,
            taskEnded: false,
        };
    }
}

/**
 * Simple synchronous task execution with minimal logging
 */
export function executeTaskSimple(
    taskDescription: string,
    config?: DiogenesConfig,
    logger?: Logger,
): Promise<{
    success: boolean;
    result?: string;
    error?: string;
}> {
    return executeTask(taskDescription, config, {
        maxIterations: 10,
        logger: logger,
    });
}
