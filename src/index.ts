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
export { FileLoadSymbolTool } from "./tools/file/file-load-symbol";
export { FileNodeAtTool } from "./tools/file/file-node-at";
export { FileUnloadTool } from "./tools/file/file-unload";
export { FileEditTool } from "./tools/file/file-edit";
export { FilePeekTool } from "./tools/file/file-peek";
export { FileSymbolsTool } from "./tools/file/file-symbols";
export { FileCreateTool } from "./tools/file/file-create";
export { FileRemoveTool } from "./tools/file/file-remove";
export { FileOverwriteTool } from "./tools/file/file-overwrite";
export { TodoSetTool } from "./tools/todo/todo-set";
export { TodoUpdateTool } from "./tools/todo/todo-update";
export { TaskAskTool } from "./tools/task/task-ask";
export { TaskChooseTool } from "./tools/task/task-choose";
export { TaskNotepadTool } from "./tools/task/task-notepad";
export { TaskEndTool } from "./tools/task/task-end";
export { ShellExecTool } from "./tools/shell/shell-exec";
export { SnapshotCreateTool } from "./tools/snapshot/snapshot-create";
export { AstService, AstServiceError } from "./ast/service";
export { TreeSitterAssetManager } from "./utils/tree-sitter-asset-manager";
export type {
    AstGrammarStatus,
    AstNodeLookupResult,
    AstSymbolMatchResult,
    ParsedAstFile,
} from "./ast/service";
export type {
    AstLanguageId,
} from "./ast/languages";
export type {
    AstLineRange,
    AstNodeSummary,
    AstPosition,
    AstSymbol,
    AstSymbolKind,
} from "./ast/symbols";
export type {
    ManagedGrammarDefinition,
    ManagedGrammarLanguage,
    ManagedGrammarStatus,
    TreeSitterManifest,
} from "./utils/tree-sitter-asset-manager";

// LLM Clients
export { OpenAIClient } from "./llm/openai-client";
export { AnthropicClient } from "./llm/anthropic-client";
export type { StreamChunk, LLMClient } from "./llm/anthropic-client";
export type { StreamChunkType } from "./llm/openai-client";
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
import {
    runTaskLoop,
    type ConversationMessage,
    type TaskRunEvent,
    type TaskRunResult,
} from "./runtime/task-runner";
import { Logger, ConsoleLogger, ToolResultData } from "./utils/logger";
export { createDiogenes } from "./create-diogenes";
import { createDiogenes } from "./create-diogenes";

// Re-export utility functions
export { parseToolCalls, formatToolResults } from "./utils/tool-parser";
export { ResticClient, ResticCommandError, ResticParseError } from "./utils/restic";
export {
    resolveDiogenesAppPaths,
    ensureDiogenesAppDirs,
    ensureDiogenesAppDirsSync,
    findDefaultConfigFileSync,
    getDefaultSessionsStorageRoot as getDefaultSessionsStorageRootFromAppPaths,
    getDefaultTreeSitterStorageRoot,
} from "./utils/app-paths";
export {
    ensureDefaultConfigFileSync,
    getManagedDefaultConfigPathSync,
} from "./utils/config-bootstrap";
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
export { SessionSnapshotManager, getDefaultSessionsStorageRoot } from "./snapshot/manager";
export { SnapshotManifestStore } from "./snapshot/manifest-store";
export { DiogenesStateSerializer } from "./snapshot/state-serializer";
export type { SnapshotManager, SnapshotManagerOptions } from "./snapshot/manager";
export type {
    SnapshotStateProvider,
    SnapshotStateRestorer,
    SnapshotStateSerializer,
} from "./snapshot/state-serializer";
export type {
    SnapshotCreateInput,
    SnapshotCreateResult,
    SnapshotRestoreInput,
    SnapshotSummary,
    SnapshotTrigger,
    SessionSnapshotEntry,
    SessionSnapshotManifest,
    PersistedDiogenesLoadedFile,
    PersistedDiogenesMessage,
    PersistedDiogenesState,
    PersistedDiogenesTodoItem,
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
        onEvent: (event) => {
            handleLoggerEvent(diogenes, logger, startTime, event);
        },
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
export async function executeTaskSimple(
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
            if (
                event.result.data &&
                typeof event.result.data === "object" &&
                "_skipped" in event.result.data &&
                event.result.data._skipped
            ) {
                break;
            }

            const toolResult: ToolResultData = {
                ...event.result,
            };

            const tool = diogenes.getTool(event.toolCall.tool);
            if (tool) {
                const formattedOutput = tool.formatResult(event.result);
                if (formattedOutput !== undefined) {
                    toolResult.formattedOutput = formattedOutput;
                }
            }

            logger.toolResult(event.toolCall.tool, toolResult);
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
        case "tool.execution.started":
            // No-op: Tool execution start is logged when it completes
            break;
        case "context.warning":
            logger.warn(`Context warning: ${event.warning}`);
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
