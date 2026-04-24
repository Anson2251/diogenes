import type { DiogenesContextManager } from "../context";
import type { StreamChunk } from "../llm/anthropic-client";
import type { ToolCall, ToolResult } from "../types";

import { formatParseError } from "../utils/tool-parser";

export interface ConversationMessage {
    role: "user" | "assistant" | "tool";
    content: string;
}

export type TaskStopReason = "end_turn" | "cancelled" | "max_turn_requests" | "failed";

export interface TaskRunResult {
    success: boolean;
    result?: string;
    error?: string;
    iterations: number;
    taskEnded: boolean;
    stopReason: TaskStopReason;
    messageHistory: ConversationMessage[];
}

export type TaskRunEvent =
    | { type: "run.started"; taskDescription: string }
    | { type: "run.iteration.started"; iteration: number }
    | { type: "llm.stream.started"; iteration: number }
    | { type: "llm.stream.delta"; iteration: number; chunk: StreamChunk }
    | { type: "llm.stream.completed"; iteration: number; response: string; reasoning: string }
    | { type: "tool.calls.parsed"; iteration: number; toolCalls: ToolCall[] }
    | { type: "tool.execution.started"; iteration: number; index: number; toolCall: ToolCall }
    | {
          type: "tool.execution.completed";
          iteration: number;
          index: number;
          toolCall: ToolCall;
          result: ToolResult;
      }
    | { type: "parse.error"; iteration: number; message: string }
    | {
          type: "context.warning";
          iteration: number;
          warning: string;
          skippedTools: string[];
          skippedIndexes: number[];
      }
    | { type: "run.completed"; result: TaskRunResult }
    | { type: "run.failed"; error: string; iterations: number }
    | { type: "run.cancelled"; iterations: number };

export interface TaskRunOptions {
    maxIterations?: number;
    messageHistory?: ConversationMessage[];
    onEvent?: (event: TaskRunEvent) => void;
    shouldCancel?: () => boolean;
    onMessageHistoryUpdate?: (messageHistory: ConversationMessage[]) => void;
}

function createTaskMessage(taskDescription: string, isFollowUpTask: boolean): ConversationMessage {
    const title = isFollowUpTask ? "NEW TASK" : "TASK";
    return {
        role: "user",
        content: `========= ${title}\n${taskDescription}\n=========`,
    };
}

function emit(options: TaskRunOptions, event: TaskRunEvent): void {
    options.onEvent?.(event);
}

function emitMessageHistory(options: TaskRunOptions, messageHistory: ConversationMessage[]): void {
    options.onMessageHistoryUpdate?.(messageHistory.map((message) => ({ ...message })));
}

function cancelledResult(iterations: number, messageHistory: ConversationMessage[]): TaskRunResult {
    return {
        success: false,
        error: "Request cancelled",
        iterations,
        taskEnded: false,
        stopReason: "cancelled",
        messageHistory,
    };
}

function isCancellationError(error: unknown): boolean {
    return error instanceof Error && error.message === "Request cancelled";
}

export async function runTaskLoop(
    diogenes: DiogenesContextManager,
    taskDescription: string,
    options: TaskRunOptions = {},
): Promise<TaskRunResult> {
    const maxIterations = options.maxIterations || 20;
    const messageHistory = [...(options.messageHistory || [])];
    messageHistory.push(createTaskMessage(taskDescription, messageHistory.length > 0));
    emitMessageHistory(options, messageHistory);

    if (!diogenes.hasLLMClient()) {
        throw new Error(
            "LLM client not configured. Provide an API key via the selected provider environment variable.",
        );
    }

    let iterations = 0;
    let taskEnded = false;
    let finalResult: string | undefined;

    emit(options, { type: "run.started", taskDescription });

    try {
        const systemPrompt = diogenes.getSystemPrompt();

        while (iterations < maxIterations && !taskEnded) {
            if (options.shouldCancel?.()) {
                emit(options, { type: "run.cancelled", iterations });
                return cancelledResult(iterations, messageHistory);
            }

            iterations++;
            emit(options, { type: "run.iteration.started", iteration: iterations });

            const contextOnly = diogenes.buildContextOnly();
            const messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[] =
                [
                    {
                        role: "system",
                        content: `${systemPrompt}\n${contextOnly}`,
                    },
                    ...messageHistory,
                ];

            const llmClient = diogenes.getLLMClient();
            if (!llmClient) {
                throw new Error("LLM client not available");
            }

            emit(options, { type: "llm.stream.started", iteration: iterations });

            // Check if native tool calling is supported
            const capabilities = llmClient.getCapabilities();
            const useNativeToolCalls = capabilities.supportsNativeToolCalls;
            const tools = useNativeToolCalls ? diogenes.getToolsForNativeCalling() : undefined;

            let streamResult;
            try {
                streamResult = await llmClient.createChatCompletionStream(
                    messages,
                    (chunk) => {
                        emit(options, {
                            type: "llm.stream.delta",
                            iteration: iterations,
                            chunk,
                        });
                    },
                    {
                        temperature: diogenes.getLLMConfig().temperature,
                        max_tokens: diogenes.getLLMConfig().maxTokens,
                    },
                    tools,
                );
            } catch (error) {
                if (options.shouldCancel?.() || isCancellationError(error)) {
                    emit(options, { type: "run.cancelled", iterations });
                    return cancelledResult(iterations, messageHistory);
                }
                throw error;
            }

            emit(options, {
                type: "llm.stream.completed",
                iteration: iterations,
                response: streamResult.content,
                reasoning: streamResult.reasoning || "",
            });

            messageHistory.push({
                role: "assistant",
                content: streamResult.content,
            });
            emitMessageHistory(options, messageHistory);

            const toolCallManager = diogenes.getToolCallManager();

            // Use native tool calls from stream if available, otherwise parse from text
            let toolCalls: Array<{ tool: string; params: Record<string, unknown> }>;
            if (streamResult.toolCalls !== undefined) {
                // Native tool calls from API (may be empty array if no tool calls made)
                // Convert API-safe names back to internal format
                toolCalls = streamResult.toolCalls.map((tc) => ({
                    tool: tc.tool.replace(/_/g, "."),
                    params: tc.params,
                }));
            } else {
                // Fallback to text parsing
                const processResult = toolCallManager.processResponse({
                    content: streamResult.content,
                });

                if (!processResult.success) {
                    const message = processResult.error?.message || "Unknown parse error";
                    emit(options, { type: "parse.error", iteration: iterations, message });
                    messageHistory.push({
                        role: "user",
                        content: formatParseError(processResult.error),
                    });
                    emitMessageHistory(options, messageHistory);
                    continue;
                }

                toolCalls = processResult.toolCalls;
            }
            if (toolCalls.length > 0) {
                emit(options, {
                    type: "tool.calls.parsed",
                    iteration: iterations,
                    toolCalls,
                });

                const results = await diogenes.executeToolCalls(toolCalls, {
                    shouldCancel: options.shouldCancel,
                    onToolStart: (toolCall, index) => {
                        emit(options, {
                            type: "tool.execution.started",
                            iteration: iterations,
                            index,
                            toolCall,
                        });
                    },
                    onToolComplete: (toolCall, result, index) => {
                        emit(options, {
                            type: "tool.execution.completed",
                            iteration: iterations,
                            index,
                            toolCall,
                            result,
                        });
                    },
                });

                if (options.shouldCancel?.()) {
                    emit(options, { type: "run.cancelled", iterations });
                    return cancelledResult(iterations, messageHistory);
                }

                let contextWarningData: {
                    warning: string;
                    skippedTools?: string[];
                    skippedIndexes?: number[];
                } | null = null;

                for (let i = 0; i < results.length; i++) {
                    const toolCall = toolCalls[i];
                    const result = results[i];

                    if (result.data?._contextWarning) {
                        const contextWarningValue: unknown = result.data._contextWarning;
                        const contextWarning: string =
                            typeof contextWarningValue === "string"
                                ? contextWarningValue
                                : String(contextWarningValue);
                        contextWarningData = {
                            warning: contextWarning,
                            skippedTools: toolCalls.slice(i + 1).map((t) => t.tool),
                            skippedIndexes: toolCalls
                                .slice(i + 1)
                                .map((_, offset) => i + 1 + offset),
                        };
                    }

                    if (toolCall.tool === "task.end" && result?.success) {
                        taskEnded = true;
                        const dataSummary: unknown = result.data?.summary;
                        const dataReason: unknown = result.data?.reason;
                        const paramsReason: unknown = toolCall.params?.reason;
                        finalResult =
                            typeof dataSummary === "string" && dataSummary.length > 0
                                ? dataSummary
                                : typeof dataReason === "string"
                                  ? dataReason
                                  : typeof paramsReason === "string"
                                    ? paramsReason
                                    : "No reason provided";
                    }
                }

                let resultContent = toolCallManager.formatResults(
                    toolCalls,
                    results,
                    (toolCall: ToolCall, result: ToolResult): string => {
                        const tool = diogenes.getTool(toolCall.tool);
                        if (tool) {
                            return tool.formatResultForLLM(toolCall, result);
                        }
                        return JSON.stringify(result, null, 2);
                    },
                );

                if (contextWarningData) {
                    emit(options, {
                        type: "context.warning",
                        iteration: iterations,
                        warning: contextWarningData.warning,
                        skippedTools: contextWarningData.skippedTools || [],
                        skippedIndexes: contextWarningData.skippedIndexes || [],
                    });
                    resultContent += `\n\n[CONTEXT WARNING]\n${contextWarningData.warning}\n`;
                    if (
                        contextWarningData.skippedTools &&
                        contextWarningData.skippedTools.length > 0
                    ) {
                        resultContent += `Skipped tools: ${contextWarningData.skippedTools.join(", ")}\n`;
                    }
                    resultContent += `\nYour context is nearly full. To continue:\n`;
                    resultContent += `1. Unload files you no longer need: \`file.unload\` or \`dir.unload\`\n`;
                    resultContent += `2. Then retry the skipped operations\n`;
                    resultContent += `3. Or use \`task.end\` if the task is complete`;
                }

                messageHistory.push({
                    role: diogenes.getLLMConfig().supportsToolRole ? "tool" : "user",
                    content: resultContent,
                });
                emitMessageHistory(options, messageHistory);
            }

            if (taskEnded) {
                break;
            }

            if (toolCalls.length === 0) {
                const feedback =
                    iterations > 3
                        ? `[SYSTEM]\nNo tool calls received for ${iterations} iterations.\n\nIf you believe the task is complete, use task.end:\n\`\`\`tool-call\n[{"tool": "task.end", "params": {"reason": "brief summary of why task is done", "summary": "what was accomplished"}}]\n\`\`\`\n\nIf the task is not complete, continue with your next tool call.`
                        : `[SYSTEM]\nNo tool calls received. Please either:\n1. Continue with tool calls to make progress\n2. Use task.end if you believe the task is complete\n\nDo not provide demo narration. Respond with a valid tool-call block only when action is needed.`;

                messageHistory.push({
                    role: "user",
                    content: feedback,
                });
                emitMessageHistory(options, messageHistory);
            }
        }

        let result: TaskRunResult;
        if (!taskEnded && iterations >= maxIterations) {
            result = {
                success: false,
                error: `Task did not complete within ${maxIterations} iterations`,
                iterations,
                taskEnded: false,
                stopReason: "max_turn_requests",
                messageHistory,
            };
        } else {
            result = {
                success: true,
                result: finalResult,
                iterations,
                taskEnded: true,
                stopReason: "end_turn",
                messageHistory,
            };
        }

        emit(options, { type: "run.completed", result });
        return result;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit(options, { type: "run.failed", error: message, iterations });
        return {
            success: false,
            error: message,
            iterations,
            taskEnded: false,
            stopReason: "failed",
            messageHistory,
        };
    }
}
