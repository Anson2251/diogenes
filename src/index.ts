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
export { FilePeekTool } from "./tools/file/file-peek";
export { FileCreateTool } from "./tools/file/file-create";
export { FileOverwriteTool } from "./tools/file/file-overwrite";
export { TodoSetTool } from "./tools/todo/todo-set";
export { TodoUpdateTool } from "./tools/todo/todo-update";
export { TaskAskTool } from "./tools/task/task-ask";
export { TaskChooseTool } from "./tools/task/task-choose";
export { TaskNotepadTool } from "./tools/task/task-notepad";
export { TaskEndTool } from "./tools/task/task-end";
export { ShellExecTool } from "./tools/shell/shell-exec";

// LLM Client
export { OpenAIClient } from "./llm/openai-client";
export type { StreamChunk, StreamChunkType } from "./llm/openai-client";

// Types
export * from "./types";
import type { DiogenesConfig } from "./types";
import { DiogenesContextManager } from "./context";
import { formatToolResults, parseToolCalls, formatParseError } from "./utils/tool-parser";
import { DirListTool } from "./tools/dir/dir-list";
import { DirUnloadTool } from "./tools/dir/dir-unload";
import { FileLoadTool } from "./tools/file/file-load";
import { FileUnloadTool } from "./tools/file/file-unload";
import { FileEditTool } from "./tools/file/file-edit";
import { FilePeekTool } from "./tools/file/file-peek";
import { FileCreateTool } from "./tools/file/file-create";
import { FileOverwriteTool } from "./tools/file/file-overwrite";
import { TodoSetTool } from "./tools/todo/todo-set";
import { TodoUpdateTool } from "./tools/todo/todo-update";
import { TaskAskTool } from "./tools/task/task-ask";
import { TaskChooseTool } from "./tools/task/task-choose";
import { TaskNotepadTool } from "./tools/task/task-notepad";
import { TaskEndTool } from "./tools/task/task-end";
import { ShellExecTool } from "./tools/shell/shell-exec";
import { Logger, ConsoleLogger, LogLevel, ToolResultData } from "./utils/logger";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

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
    contextManager.registerTool(new FilePeekTool(workspace));
    contextManager.registerTool(new FileCreateTool(workspace));
    contextManager.registerTool(new FileOverwriteTool(workspace));
    contextManager.registerTool(new TodoSetTool(workspace));
    contextManager.registerTool(new TodoUpdateTool(workspace));
    contextManager.registerTool(new TaskNotepadTool(workspace));
    if (configObj.security.interaction?.enabled ?? true) {
        contextManager.registerTool(new TaskAskTool(createTerminalAskHandler()));
        contextManager.registerTool(new TaskChooseTool(createTerminalChooseHandler()));
    }
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

function createTerminalAskHandler() {
    return async (question: string): Promise<string> => {
        if (!input.isTTY || !output.isTTY) {
            throw new Error("Interactive terminal is not available");
        }

        const rl = createInterface({ input, output });
        try {
            return await rl.question(`\n[task.ask] ${question}\n> `);
        } finally {
            rl.close();
        }
    };
}

function createTerminalChooseHandler() {
    return async (question: string, options: string[]): Promise<string> => {
        if (!input.isTTY || !output.isTTY) {
            throw new Error("Interactive terminal is not available");
        }

        const rl = createInterface({ input, output });
        try {
            const promptLines = [
                `\n[task.choose] ${question}`,
                ...options.map((option, index) => `  ${index + 1}. ${option}`),
                "> ",
            ];

            const answer = await rl.question(promptLines.join("\n"));
            const trimmed = answer.trim();
            const index = Number.parseInt(trimmed, 10);

            if (!Number.isNaN(index) && index >= 1 && index <= options.length) {
                return options[index - 1];
            }

            const directMatch = options.find((option) => option === trimmed);
            if (directMatch) {
                return directMatch;
            }

            throw new Error("Selection must be an option number or exact option text");
        } finally {
            rl.close();
        }
    };
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

            // console.log(`\n${contextOnly}`)

            // Build messages array:
            // 1. System prompt as system message (first message only)
            // 2. Context + task as user message (first iteration only)
            // 3. Previous conversation history
            const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
                {
                    role: "system" as const,
                    content: `${systemPrompt}\n${contextOnly}`,
                },
            ];

            messages.push({
                role: "user" as const,
                content: `========= TASK\n${taskDescription}\n=========`,
            });

            // Add previous conversation history
            messages.push(...messageList);

            // Call LLM API directly (not using runLLMCycle since we want to handle tool execution)
            const llmClient = diogenes.getLLMClient();
            if (!llmClient) {
                throw new Error("LLM client not available");
            }

            // Start streaming
            logger.streamStart();

            const result = await llmClient.createChatCompletionStream(
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
                content: result.content,
            });

            const parseResult = parseToolCalls(result.content);

            if (!parseResult.success) {
                logger.warn(`Tool call parse error: ${parseResult.error?.message}`);
                messageList.push({
                    role: "user",
                    content: formatParseError(parseResult.error),
                });
                continue;
            }

            const toolCalls = parseResult.toolCalls!;

            if (toolCalls.length > 0) {
                logger.toolCalls(toolCalls);
            }

            if (toolCalls.length > 0) {
                const results = await diogenes.executeToolCalls(toolCalls);

                let contextWarningData: { warning: string; skippedTools?: string[] } | null = null;

                for (let i = 0; i < results.length; i++) {
                    const toolCall = toolCalls[i];
                    const result = results[i];

                    if (result.data?._contextWarning) {
                        contextWarningData = {
                            warning: result.data._contextWarning,
                            skippedTools: toolCalls.slice(i + 1).map(t => t.tool),
                        };
                    }

                    if (result.data?._skipped) {
                        continue;
                    }

                    const tool = diogenes.getTool(toolCall.tool);
                    if (tool) {
                        const formattedOutput = tool.formatResult(result);
                        if (formattedOutput !== undefined) {
                            (result as ToolResultData).formattedOutput = formattedOutput;
                        }
                    }

                    logger.toolResult(toolCall.tool, result);
                }

                for (let i = 0; i < toolCalls.length; i++) {
                    const toolCall = toolCalls[i];
                    const result = results[i];
                    if (toolCall.tool === "task.end" && result?.success) {
                        taskEnded = true;
                        finalResult =
                            typeof result.data?.summary === "string" && result.data.summary.length > 0
                                ? result.data.summary
                                : result.data?.reason || toolCall.params?.reason || "No reason provided";
                        break;
                    }
                }

                let resultContent = formatToolResults(toolCalls, results);

                if (contextWarningData) {
                    resultContent += `\n\n[CONTEXT WARNING]\n${contextWarningData.warning}\n`;
                    if (contextWarningData.skippedTools && contextWarningData.skippedTools.length > 0) {
                        resultContent += `Skipped tools: ${contextWarningData.skippedTools.join(", ")}\n`;
                    }
                    resultContent += `\nYour context is nearly full. To continue:\n`;
                    resultContent += `1. Unload files you no longer need: \`file.unload\` or \`dir.unload\`\n`;
                    resultContent += `2. Then retry the skipped operations\n`;
                    resultContent += `3. Or use \`task.end\` if the task is complete`;
                }

                messageList.push({
                    role: "user",
                    content: resultContent
                });
            }

            if (taskEnded) {
                break;
            }

            if (toolCalls.length === 0) {
                const feedback = iterations > 3
                    ? `[SYSTEM]\nNo tool calls received for ${iterations} iterations.\n\nIf you believe the task is complete, use task.end:\n\`\`\`tool-call\n[{"tool": "task.end", "params": {"reason": "brief summary of why task is done", "summary": "what was accomplished"}}]\n\`\`\`\n\nIf the task is not complete, continue with your next tool call.`
                    : `[SYSTEM]\nNo tool calls received. Please either:\n1. Continue with tool calls to make progress\n2. Use task.end if you believe the task is complete`;

                messageList.push({
                    role: "user",
                    content: feedback,
                });
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
