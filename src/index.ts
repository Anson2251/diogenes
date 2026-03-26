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
export { SnapshotCreateTool } from "./tools/snapshot/snapshot-create";

// LLM Client
export { OpenAIClient } from "./llm/openai-client";
export type { StreamChunk, StreamChunkType } from "./llm/openai-client";
export { ACPServer } from "./acp/server";
export { startACPServer } from "./acp/stdio-transport";
export { runTaskLoop } from "./runtime/task-runner";
export type {
    ConversationMessage,
    TaskRunEvent,
    TaskRunOptions,
    TaskRunResult,
    TaskStopReason,
} from "./runtime/task-runner";

// Types
export * from "./types";
import type { DiogenesConfig } from "./types";
import { DiogenesContextManager } from "./context";
import { Logger, ConsoleLogger, ToolResultData } from "./utils/logger";
import { runTaskLoop, type ConversationMessage, type TaskRunEvent, type TaskRunResult } from "./runtime/task-runner";
export { createDiogenes } from "./create-diogenes";
import { createDiogenes } from "./create-diogenes";

// Re-export utility functions
export { parseToolCalls, formatToolResults } from "./utils/tool-parser";
export {
    ResticClient,
    ResticCommandError,
    ResticParseError,
} from "./utils/restic";
export type {
    ResticClientOptions,
    ResticCommandOptions,
    ResticBackupOptions,
    ResticBackupResult,
    ResticListSnapshotsOptions,
    ResticRestoreOptions,
    ResticSnapshot,
    ResticCommandResult,
} from "./utils/restic";
export {
    SessionSnapshotManager,
    getDefaultSnapshotStorageRoot,
} from "./snapshot/manager";
export { SnapshotManifestStore } from "./snapshot/manifest-store";
export {
    PlaceholderStateSerializer,
} from "./snapshot/state-serializer";
export type {
    SnapshotManager,
    SnapshotManagerOptions,
} from "./snapshot/manager";
export type {
    SnapshotCreateInput,
    SnapshotCreateResult,
    SnapshotSummary,
    SnapshotTrigger,
    SessionSnapshotEntry,
    SessionSnapshotManifest,
    PersistedDiogenesStatePlaceholder,
} from "./snapshot/types";

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
    diogenes?: DiogenesContextManager;
    messageHistory?: ConversationMessage[];
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
    messageHistory: ConversationMessage[];
}> {
    const logger = options.logger || new ConsoleLogger();
    const diogenes = options.diogenes || createDiogenes(config);
    const startTime = Date.now();

    const result = await runTaskLoop(diogenes, taskDescription, {
        maxIterations: options.maxIterations || 20,
        messageHistory: options.messageHistory,
        onEvent: (event) => handleLoggerEvent(diogenes, logger, startTime, event),
    });

    return {
        success: result.success,
        result: result.result,
        error: result.error,
        iterations: result.iterations,
        taskEnded: result.taskEnded,
        messageHistory: result.messageHistory,
    };
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

function handleLoggerEvent(
    diogenes: DiogenesContextManager,
    logger: Logger,
    startTime: number,
    event: TaskRunEvent,
): void {
    switch (event.type) {
        case "run.started":
            logger.taskStarted(event.taskDescription);
            break;
        case "run.iteration.started":
            logger.iterationStart(event.iteration);
            break;
        case "llm.stream.started":
            logger.streamStart();
            break;
        case "llm.stream.delta":
            logger.streamChunk(event.chunk);
            break;
        case "llm.stream.completed":
            logger.streamEnd();
            break;
        case "tool.calls.parsed":
            if (event.toolCalls.length > 0) {
                logger.toolCalls(event.toolCalls);
            }
            break;
        case "tool.execution.completed": {
            if (event.result.data?._skipped) {
                break;
            }

            const tool = diogenes.getTool(event.toolCall.tool);
            if (tool) {
                const formattedOutput = tool.formatResult(event.result);
                if (formattedOutput !== undefined) {
                    (event.result as ToolResultData).formattedOutput = formattedOutput;
                }
            }

            logger.toolResult(event.toolCall.tool, event.result);
            break;
        }
        case "parse.error":
            logger.warn(`Tool call parse error: ${event.message}`);
            break;
        case "run.completed":
            logger.taskCompleted(formatTaskCompletionData(event.result), Date.now() - startTime);
            break;
        case "run.failed":
            logger.taskCompleted(
                {
                    success: false,
                    error: event.error,
                    iterations: event.iterations,
                    taskEnded: false,
                },
                Date.now() - startTime,
            );
            break;
        case "run.cancelled":
            logger.taskCompleted(
                {
                    success: false,
                    error: "Request cancelled",
                    iterations: event.iterations,
                    taskEnded: false,
                },
                Date.now() - startTime,
            );
            break;
        default:
            break;
    }
}

function formatTaskCompletionData(result: TaskRunResult) {
    return {
        success: result.success,
        result: result.result,
        error: result.error,
        iterations: result.iterations,
        taskEnded: result.taskEnded,
    };
}
