import * as path from "path";

import type { SnapshotManager } from "../snapshot/manager";
import type { SnapshotStateProvider, SnapshotStateRestorer } from "../snapshot/state-serializer";
import type { PersistedACPUpdate, PersistedDiogenesState } from "../snapshot/types";
import type { TodoItem, ToolCall, ToolResult } from "../types";
import type { DiogenesConfig } from "../types";
import type { PromptBlock } from "./types";
import type {
    AvailableCommand,
    SessionConfigOption,
    SessionConfigSelectOption,
    SessionLifecycleState,
    SessionMetadata,
    StoredSessionMetadata,
} from "./types";

import { createDiogenes } from "../create-diogenes";
import {
    runTaskLoop,
    type ConversationMessage,
    type TaskRunEvent,
    type TaskRunResult,
} from "../runtime/task-runner";
import { SnapshotCreateTool } from "../tools/snapshot/snapshot-create";
import { getProviderApiKeyEnvVarName } from "../utils/api-key-manager";
import { ensureDefaultModelsConfigSync } from "../utils/config-bootstrap";
import { loadModelsConfig, resolveModel } from "../utils/models-config";
import { collectSetupDiagnostics } from "../utils/setup-diagnostics";

import {
    createBaseSlashCommandRegistry,
    createSnapshotSlashCommands,
    type MarkdownSection,
    type ParsedSlashCommand,
    type SlashCommandContext,
} from "./slash-commands";

export interface ACPNotificationSink {
    (method: string, params: any): void;
}

interface SessionOwnedResource {
    dispose(): Promise<void> | void;
}

export interface SessionPersistence {
    writeMetadata(metadata: StoredSessionMetadata): Promise<void>;
    writeState(sessionId: string, state: PersistedDiogenesState): Promise<void>;
}

interface RestorePersistedStateOptions {
    persist?: boolean;
    emitPlanUpdate?: boolean;
    preserveTimestamps?: boolean;
}

interface EmitSessionUpdateOptions {
    record?: boolean;
    notify?: boolean;
}

class SessionResourceRegistry {
    private readonly resources: SessionOwnedResource[] = [];

    register(resource: SessionOwnedResource): void {
        this.resources.push(resource);
    }

    async disposeAll(): Promise<void> {
        const errors: Error[] = [];

        for (let i = this.resources.length - 1; i >= 0; i--) {
            const resource = this.resources[i];

            try {
                await resource.dispose();
            } catch (error) {
                errors.push(error instanceof Error ? error : new Error(String(error)));
            }
        }

        this.resources.length = 0;

        if (errors.length > 0) {
            throw new AggregateError(errors, "Failed to dispose one or more session resources");
        }
    }
}

const TOOL_CALL_BLOCK_MARKERS = ["```tool-call", "```tool"] as const;

function createTextContent(text: string) {
    return {
        type: "text",
        text,
    };
}

function createToolResultContent(text: string) {
    return [
        {
            type: "content",
            content: createTextContent(text),
        },
    ];
}

function createACPToolResultContent(
    toolName: string,
    params: Record<string, any> | undefined,
    result: ToolResult,
    formattedText?: string,
): Array<Record<string, unknown>> {
    const content: Array<Record<string, unknown>> = createToolResultContent(
        formattedText ?? formatToolResultFallback(toolName, result, params),
    ) as Array<Record<string, unknown>>;

    const rawDiffData: unknown = result.success ? result.data?._diff : undefined;
    const diffData:
        | { path: string; oldText?: string; newText: string; hunks?: unknown[] }
        | undefined =
        rawDiffData && typeof rawDiffData === "object" && "path" in rawDiffData
            ? (() => {
                  const rawDiffObj = rawDiffData as Record<string, unknown>;
                  return {
                      path: String(rawDiffObj.path),
                      oldText:
                          typeof rawDiffObj.oldText === "string" ? rawDiffObj.oldText : undefined,
                      newText: String(rawDiffObj.newText),
                      hunks: Array.isArray(rawDiffObj.hunks) ? rawDiffObj.hunks : undefined,
                  };
              })()
            : undefined;
    if (
        (toolName === "file.edit" || toolName === "file.create" || toolName === "file.overwrite") &&
        diffData &&
        typeof diffData.path === "string" &&
        typeof diffData.newText === "string" &&
        (toolName === "file.create" || (Array.isArray(diffData.hunks) && diffData.hunks.length > 0))
    ) {
        content.push({
            type: "diff",
            path: path.normalize(diffData.path),
            oldText: diffData.oldText ?? null,
            newText: diffData.newText,
        });
    }

    return content;
}

function mapTodoStatus(state: TodoItem["state"]): "pending" | "in_progress" | "completed" {
    switch (state) {
        case "active":
            return "in_progress";
        case "done":
            return "completed";
        case "pending":
            return "pending";
    }
}

function mapTodoPriority(state: TodoItem["state"]): "high" | "medium" | "low" {
    switch (state) {
        case "active":
            return "high";
        case "done":
            return "low";
        case "pending":
            return "medium";
    }
}

function createToolCallTitle(toolName: string, params: Record<string, any> | undefined): string {
    const targetPath = typeof params?.path === "string" ? params.path : undefined;

    switch (toolName) {
        case "dir.list":
            return `Surveying directory${targetPath ? ` ${targetPath}` : ""}`;
        case "dir.unload":
            return `Packing away directory${targetPath ? ` ${targetPath}` : ""}`;
        case "file.load":
            return `Reading file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.peek":
            return `Glancing at file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.edit":
            return `Editing file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.create":
            return `Creating file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.overwrite":
            return `Rewriting file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.unload":
            return `Packing away file${targetPath ? ` ${targetPath}` : ""}`;
        case "todo.set":
            return "Sketching the plan";
        case "todo.update":
            return `Advancing plan item${typeof params?.text === "string" ? ` ${params.text}` : ""}`;
        case "task.ask":
            return "Asking the user";
        case "task.choose":
            return "Offering a choice";
        case "task.notepad":
            return "Saving working notes";
        case "task.end":
            return "Calling the task done";
        case "shell.exec":
            return `Running command${typeof params?.command === "string" ? `: ${params.command}` : ""}`;
        case "snapshot.create":
            return "Creating snapshot";
        default:
            return toolName;
    }
}

function getVisibleAssistantText(content: string): string {
    let cutoff = content.length;

    for (const marker of TOOL_CALL_BLOCK_MARKERS) {
        const index = content.indexOf(marker);
        if (index !== -1) {
            cutoff = Math.min(cutoff, index);
        }
    }

    let visibleText = content.slice(0, cutoff);
    if (cutoff !== content.length) {
        return visibleText;
    }

    let reservedSuffixLength = 0;
    for (const marker of TOOL_CALL_BLOCK_MARKERS) {
        const maxPrefixLength = Math.min(marker.length - 1, visibleText.length);
        for (
            let prefixLength = maxPrefixLength;
            prefixLength > reservedSuffixLength;
            prefixLength--
        ) {
            if (visibleText.endsWith(marker.slice(0, prefixLength))) {
                reservedSuffixLength = prefixLength;
                break;
            }
        }
    }

    if (reservedSuffixLength > 0) {
        visibleText = visibleText.slice(0, -reservedSuffixLength);
    }

    return visibleText;
}

function promptBlocksToText(prompt: PromptBlock[]): string {
    const parts: string[] = [];

    for (const block of prompt) {
        if (block.type === "text") {
            parts.push(block.text);
            continue;
        }

        if (block.type === "resource_link") {
            const label = block.title || block.name;
            parts.push(
                [
                    `[Resource] ${label}`,
                    `URI: ${block.uri}`,
                    block.description ? `Description: ${block.description}` : undefined,
                    block.mimeType ? `MIME: ${block.mimeType}` : undefined,
                ]
                    .filter(Boolean)
                    .join("\n"),
            );
            continue;
        }

        if (block.type === "resource") {
            if (typeof block.resource.text === "string") {
                parts.push(`[Embedded Resource] ${block.resource.uri}\n${block.resource.text}`);
            } else {
                parts.push(`[Embedded Resource] ${block.resource.uri}`);
            }
        }
    }

    return parts.join("\n\n").trim();
}

function createACPToolCallUpdate(
    toolCallId: string,
    toolCall: ToolCall,
    status: "pending" | "completed" | "failed" | "in_progress",
    locations: Array<{ path: string }> | undefined,
) {
    return {
        sessionUpdate: "tool_call",
        toolCallId,
        title: createToolCallTitle(toolCall.tool, toolCall.params),
        kind: mapToolKind(toolCall.tool),
        status,
        rawInput: toolCall.params,
        locations,
    };
}

function createACPToolCallResultUpdate(
    toolCallId: string,
    status: "completed" | "failed" | "in_progress",
    content?: any,
    rawOutput?: ToolResult,
) {
    const result: Record<string, unknown> = {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status,
    };
    if (content) {
        result.content = content;
    }
    if (rawOutput) {
        result.rawOutput = rawOutput;
    }
    return result;
}

function parsePersistedACPUpdate(value: unknown): PersistedACPUpdate {
    if (typeof value !== "object" || value === null) {
        return {};
    }
    // Build the result without type assertions
    const result: Record<string, unknown> = {};
    const keys = Object.keys(value);
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && "value" in descriptor) {
            result[key] = descriptor.value;
        }
    }
    return result;
}

function cloneACPUpdate(update: PersistedACPUpdate): PersistedACPUpdate {
    return parsePersistedACPUpdate(JSON.parse(JSON.stringify(update)));
}

function mapToolKind(toolName: string): string {
    if (
        toolName.startsWith("file.load") ||
        toolName.startsWith("file.peek") ||
        toolName.startsWith("dir.list")
    ) {
        return "read";
    }
    if (
        toolName.startsWith("file.edit") ||
        toolName.startsWith("file.create") ||
        toolName.startsWith("file.overwrite")
    ) {
        return "edit";
    }
    if (toolName.startsWith("todo.") || toolName.startsWith("task.notepad")) {
        return "think";
    }
    if (toolName.startsWith("snapshot.")) {
        return "other";
    }
    if (toolName.startsWith("file.unload") || toolName.startsWith("dir.unload")) {
        return "other";
    }
    if (toolName.startsWith("shell.exec")) {
        return "execute";
    }
    return "other";
}

function extractLocations(
    params: Record<string, any> | undefined,
): Array<{ path: string }> | undefined {
    const filePath = typeof params?.path === "string" ? params.path : undefined;
    if (!filePath) {
        return undefined;
    }
    return [{ path: filePath }];
}

function formatFileEditResult(pathName: string, result: ToolResult): string | null {
    if (!result.success || !result.data) {
        return null;
    }

    const resultData = result.data;
    const matchLine = typeof resultData.match_line === "number" ? resultData.match_line : undefined;
    const matchCount = typeof resultData.match_count === "number" ? resultData.match_count : undefined;

    let totalLines: number | undefined;
    const fileStateInput: unknown = resultData.file_state;
    if (typeof fileStateInput === "object" && fileStateInput !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(fileStateInput, "total_lines");
        if (descriptor && typeof descriptor.value === "number") {
            totalLines = descriptor.value;
        }
    }

    const lines: string[] = [];
    const parts = [`Updated ${pathName}`];
    if (typeof matchLine === "number") {
        parts.push(`replaced at line ${matchLine}`);
    }
    if (typeof matchCount === "number" && matchCount > 1) {
        parts.push(`${matchCount - 1} other match${matchCount - 1 === 1 ? "" : "es"}`);
    }
    if (typeof totalLines === "number") {
        parts.push(`${totalLines} total lines`);
    }
    lines.push(parts.join(", "));

    return lines.join("\n");
}

function formatToolResultFallback(
    toolName: string,
    result: ToolResult,
    params?: Record<string, any>,
): string {
    if (result.success) {
        if (
            toolName === "task.end" &&
            typeof result.data?.summary === "string" &&
            result.data.summary.length > 0
        ) {
            return result.data.summary;
        }

        if (toolName === "dir.list") {
            const count = typeof result.data?.count === "number" ? result.data.count : 0;
            const files = typeof result.data?.files === "number" ? result.data.files : 0;
            const dirs = typeof result.data?.dirs === "number" ? result.data.dirs : 0;
            return `Found ${count} entries (${files} files, ${dirs} directories)`;
        }

        if (toolName === "file.load") {
            const ranges = Array.isArray(result.data?.loaded_range)
                ? result.data.loaded_range
                      .filter(
                          (range): range is [number, number] =>
                              Array.isArray(range) &&
                              range.length >= 2 &&
                              typeof range[0] === "number" &&
                              typeof range[1] === "number",
                      )
                      .map((range) => `${range[0]}-${range[1]}`)
                      .join(", ")
                : "requested range";
            const totalLines =
                typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            return `Loaded lines ${ranges} (${totalLines} total lines in file)`;
        }

        if (toolName === "file.peek") {
            const filePath = typeof params?.path === "string" ? params.path : "unknown file";
            const peekData: Record<string, unknown> =
                typeof result.data === "object" && result.data !== null
                    ? (result.data as Record<string, unknown>)
                    : {};
            const rawPreviewRange = peekData?.preview_range;
            const previewRange: [number, number] =
                Array.isArray(rawPreviewRange) &&
                rawPreviewRange.length >= 2 &&
                typeof rawPreviewRange[0] === "number" &&
                typeof rawPreviewRange[1] === "number"
                    ? [rawPreviewRange[0], rawPreviewRange[1]]
                    : [1, 1];
            const totalLines = typeof peekData?.total_lines === "number" ? peekData.total_lines : 0;
            const lines = Array.isArray(peekData?.lines)
                ? (peekData.lines as unknown[]).filter(
                      (line): line is string => typeof line === "string",
                  )
                : [];
            const note = typeof peekData?._note === "string" ? peekData._note : "";

            return [
                `Peeked ${filePath}`,
                `Lines ${previewRange[0]}-${previewRange[1]} of ${totalLines}`,
                "",
                "```",
                ...lines,
                "```",
                "",
                note,
            ]
                .filter(
                    (line, index, all) =>
                        line.length > 0 || (index > 0 && all[index - 1].length > 0),
                )
                .join("\n");
        }

        if (toolName === "file.edit") {
            const pathName = typeof params?.path === "string" ? params.path : "file";
            const summary = formatFileEditResult(pathName, result);
            if (summary) {
                return summary;
            }
        }

        if (toolName === "file.unload") {
            const targetPath =
                typeof result.data?.path === "string"
                    ? result.data.path
                    : typeof params?.path === "string"
                      ? params.path
                      : "file";
            return `Removed ${targetPath} from workspace context`;
        }

        if (toolName === "dir.unload") {
            const targetPath =
                typeof result.data?.path === "string"
                    ? result.data.path
                    : typeof params?.path === "string"
                      ? params.path
                      : "directory";
            return `Removed ${targetPath} from workspace context`;
        }

        if (toolName === "file.create") {
            const totalLines =
                typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            return `Created file (${totalLines} line${totalLines === 1 ? "" : "s"})`;
        }

        if (toolName === "file.overwrite") {
            const totalLines =
                typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            return `Rewrote file (${totalLines} line${totalLines === 1 ? "" : "s"})`;
        }

        if (toolName === "todo.set") {
            const items = Array.isArray(result.data?.items) ? result.data.items.length : 0;
            return `Updated plan with ${items} item${items === 1 ? "" : "s"}`;
        }

        if (toolName === "todo.update") {
            const text = typeof result.data?.text === "string" ? result.data.text : "plan item";
            const state = typeof result.data?.state === "string" ? result.data.state : "updated";
            return `Marked "${text}" as ${state}`;
        }

        if (toolName === "task.notepad") {
            const mode = typeof result.data?.mode === "string" ? result.data.mode : "append";
            const totalLines =
                typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            const noteLines = Array.isArray(result.data?.lines)
                ? result.data.lines.filter((line): line is string => typeof line === "string")
                : [];

            switch (mode) {
                case "clear":
                    return "Cleared working notes";
                case "replace":
                    return [
                        `Replaced working notes (${totalLines} line${totalLines === 1 ? "" : "s"} total)`,
                        noteLines.length > 0 ? "" : undefined,
                        ...noteLines,
                    ]
                        .filter((line): line is string => typeof line === "string")
                        .join("\n");
                default:
                    return [
                        `Updated working notes (${totalLines} line${totalLines === 1 ? "" : "s"} total)`,
                        noteLines.length > 0 ? "" : undefined,
                        ...noteLines,
                    ]
                        .filter((line): line is string => typeof line === "string")
                        .join("\n");
            }
        }

        if (toolName === "shell.exec") {
            const exitCode: number | undefined =
                typeof result.data?.exit_code === "number" ? result.data.exit_code : undefined;
            const stdout = typeof result.data?.stdout === "string" ? result.data.stdout.trim() : "";
            const stderr = typeof result.data?.stderr === "string" ? result.data.stderr.trim() : "";
            const parts = [`Command finished with exit code ${exitCode}`];

            if (stdout.length > 0) {
                parts.push(`stdout: ${stdout}`);
            }
            if (stderr.length > 0) {
                parts.push(`stderr: ${stderr}`);
            }

            return parts.join("\n");
        }

        if (toolName === "snapshot.create") {
            const snapshotId =
                typeof result.data?.snapshot_id === "string" ? result.data.snapshot_id : "snapshot";
            const label = typeof result.data?.label === "string" ? result.data.label : undefined;
            return label
                ? `Created snapshot ${snapshotId} (${label})`
                : `Created snapshot ${snapshotId}`;
        }

        if (result.data && Object.keys(result.data).length > 0) {
            return JSON.stringify(result.data, null, 2);
        }

        return `${toolName} completed successfully`;
    }

    const message = result.error?.message || `${toolName} failed`;
    if (toolName === "file.edit") {
        const target = typeof params?.path === "string" ? params.path : "the target file";
        const parts = [`Could not apply edits to ${target}`, message];

        if (typeof result.error?.suggestion === "string" && result.error.suggestion.length > 0) {
            parts.push("", result.error.suggestion);
        }

        return parts.join("\n");
    }

    const code = result.error?.code ? `[${result.error.code}] ` : "";
    const details = result.error?.details
        ? `\n${JSON.stringify(result.error.details, null, 2)}`
        : "";
    return `${code}${message}${details}`;
}

function createSkippedToolResult(warning: string): ToolResult {
    return {
        success: false,
        error: {
            code: "SKIPPED",
            message: warning,
        },
    };
}

export class ACPSession implements SnapshotStateProvider, SnapshotStateRestorer {
    readonly sessionId: string;
    readonly cwd: string;
    readonly createdAt: string;

    private readonly notify: ACPNotificationSink;
    private readonly diogenes: ReturnType<typeof createDiogenes>;
    private readonly maxIterations: number | undefined;
    private readonly resources = new SessionResourceRegistry();
    private readonly slashCommands = createBaseSlashCommandRegistry();
    private acpReplayLog: PersistedACPUpdate[] = [];
    private messageHistory: ConversationMessage[] = [];
    private currentMessageHistory: ConversationMessage[] = [];
    private lifecycleState: SessionLifecycleState = "active";
    private promptTurn = 0;
    private snapshotManager: SnapshotManager | null = null;
    private title: string | null = null;
    private description: string | null = null;
    private updatedAt: string;
    private disposePromise: Promise<void> | null = null;
    private metadataWriteChain: Promise<void> = Promise.resolve();
    private activeRun: {
        id: string;
        cancelled: boolean;
        streamedContent: string;
        emittedContentLength: number;
        nextToolCallSequence: number;
        toolCallIds: Map<string, string>;
        pendingToolCallKeys: Map<string, string>;
    } | null = null;
    private activePromptPromise: Promise<TaskRunResult> | null = null;

    constructor(
        sessionId: string,
        cwd: string,
        private readonly config: DiogenesConfig,
        maxIterations: number | undefined,
        notify: ACPNotificationSink,
        private readonly persistence?: SessionPersistence,
        options?: {
            createdAt?: string;
            updatedAt?: string;
            title?: string | null;
            description?: string | null;
        },
    ) {
        this.sessionId = sessionId;
        this.cwd = path.resolve(cwd);
        this.createdAt = options?.createdAt ?? new Date().toISOString();
        this.updatedAt = options?.updatedAt ?? this.createdAt;
        this.maxIterations = maxIterations;
        this.notify = notify;
        this.title = options?.title ?? null;
        this.description = options?.description ?? null;
        this.diogenes = createDiogenes({
            ...this.config,
            security: {
                ...(this.config.security || {}),
                workspaceRoot: this.cwd,
                interaction: { enabled: false },
            },
        });
    }

    getUpdatedAt(): string {
        return this.updatedAt;
    }

    getCreatedAt(): string {
        return this.createdAt;
    }

    getWorkspaceManager() {
        return this.diogenes.getWorkspaceManager();
    }

    getMessageHistory(): ConversationMessage[] {
        const source =
            this.currentMessageHistory.length > 0
                ? this.currentMessageHistory
                : this.messageHistory;
        return source.map((message) => ({ ...message }));
    }

    getACPReplayLog(): PersistedACPUpdate[] {
        return this.acpReplayLog.map((update) => cloneACPUpdate(update));
    }

    getLifecycleState(): SessionLifecycleState {
        return this.lifecycleState;
    }

    getMetadata(): SessionMetadata {
        return {
            sessionId: this.sessionId,
            cwd: this.cwd,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            title: this.title,
            description: this.description,
            state: this.lifecycleState,
            hasActiveRun: this.activeRun !== null,
        };
    }

    getStoredMetadata(): StoredSessionMetadata {
        return {
            ...this.getMetadata(),
            availableCommands: this.getAvailableCommands(),
            snapshotEnabled: this.snapshotManager !== null,
        };
    }

    private getPersistedLLMState(): PersistedDiogenesState["llm"] {
        const llmConfig = this.diogenes.getLLMConfig();
        return {
            provider: llmConfig.provider,
            providerStyle: llmConfig.providerStyle,
            model: llmConfig.model,
            supportsToolRole: llmConfig.supportsToolRole,
            baseURL: llmConfig.baseURL,
            maxTokens: llmConfig.maxTokens,
            temperature: llmConfig.temperature,
        };
    }

    private getResolvedLLMApiKey(providerName?: string): string | undefined {
        if (!providerName) {
            return undefined;
        }

        return process.env[getProviderApiKeyEnvVarName(providerName)];
    }

    getPersistedState(): PersistedDiogenesState {
        const workspace = this.diogenes.getWorkspaceManager();
        const directoryWorkspace = workspace.getDirectoryWorkspace();
        const fileWorkspace = workspace.getFileWorkspace();
        const todoWorkspace = workspace.getTodoWorkspace();
        const notepadWorkspace = workspace.getNotepadWorkspace();

        return {
            version: 1,
            kind: "diogenes_state",
            sessionId: this.sessionId,
            cwd: this.cwd,
            createdAt: this.createdAt,
            updatedAt: this.updatedAt,
            metadata: {
                title: this.title,
                description: this.description,
            },
            llm: this.getPersistedLLMState(),
            acpReplayLog: this.acpReplayLog.map((update) => cloneACPUpdate(update)),
            messageHistory: this.getMessageHistory().map((message) => ({
                role: message.role,
                content: message.content,
            })),
            workspace: {
                loadedDirectories: Object.keys(directoryWorkspace),
                loadedFiles: Object.values(fileWorkspace).map((entry) => ({
                    path: entry.path,
                    ranges: entry.ranges.map((range) => ({
                        start: range.start,
                        end: range.end,
                    })),
                })),
                todo: todoWorkspace.items.map((item) => ({
                    text: item.text,
                    state: item.state,
                })),
                notepad: [...notepadWorkspace.lines],
            },
        };
    }

    getReplayUpdates(): Array<Record<string, unknown>> {
        return this.acpReplayLog.map((update) => cloneACPUpdate(update));
    }

    getHydratedStateMeta(): {
        loadedDirectories: string[];
        loadedFiles: Array<{ path: string; ranges: Array<{ start: number; end: number }> }>;
        notepad: string[];
    } {
        const workspace = this.diogenes.getWorkspaceManager();
        const fileWorkspace = workspace.getFileWorkspace();

        return {
            loadedDirectories: Object.keys(workspace.getDirectoryWorkspace()),
            loadedFiles: Object.values(fileWorkspace).map((entry) => ({
                path: entry.path,
                ranges: entry.ranges.map((range) => ({ start: range.start, end: range.end })),
            })),
            notepad: [...workspace.getNotepadWorkspace().lines],
        };
    }

    getSnapshotMetadata(): { title: string | null; description: string | null } {
        return {
            title: this.title,
            description: this.description,
        };
    }

    async persistClosedState(): Promise<void> {
        if (!this.persistence) {
            return;
        }

        const closedAt = new Date().toISOString();
        const metadata = {
            ...this.getStoredMetadata(),
            updatedAt: closedAt,
            state: "active" as const,
            hasActiveRun: false,
        };
        const state = {
            ...this.getPersistedState(),
            updatedAt: closedAt,
        };

        await this.persistence.writeMetadata(metadata);
        await this.persistence.writeState(this.sessionId, state);
    }

    async restorePersistedState(
        state: PersistedDiogenesState,
        options: RestorePersistedStateOptions = {},
    ): Promise<void> {
        const workspace = this.diogenes.getWorkspaceManager();
        workspace.clearLoadedState();
        workspace.setTodoItems(state.workspace.todo.map((item) => ({ ...item })));
        workspace.setNotepadLines([...state.workspace.notepad]);
        this.title = state.metadata?.title ?? this.title;
        this.description = state.metadata?.description ?? this.description;

        if (state.llm) {
            // Load capabilities from models config (not from persisted state)
            let capabilities: { supportsNativeToolCalls?: boolean; supportsInterleavedThinking?: boolean } = {};
            try {
                const modelsPath = ensureDefaultModelsConfigSync();
                const modelsConfig = loadModelsConfig(modelsPath);
                if (modelsConfig && state.llm.provider && state.llm.model) {
                    const modelRef = `${state.llm.provider}/${state.llm.model}`;
                    const resolved = resolveModel(modelsConfig, modelRef);
                    capabilities = {
                        supportsNativeToolCalls: resolved.supportsNativeToolCalls,
                        supportsInterleavedThinking: resolved.supportsInterleavedThinking,
                    };
                }
            } catch {
                // Ignore errors, use default capabilities
            }

            this.diogenes.setLLMConfig({
                provider: state.llm.provider,
                providerStyle: state.llm.providerStyle,
                model: state.llm.model,
                supportsToolRole: state.llm.supportsToolRole,
                baseURL: state.llm.baseURL,
                maxTokens: state.llm.maxTokens,
                temperature: state.llm.temperature,
                apiKey: this.getResolvedLLMApiKey(state.llm.provider),
                capabilities,
            });
        }

        for (const dirPath of state.workspace.loadedDirectories) {
            await workspace.loadDirectory(dirPath);
        }

        for (const file of state.workspace.loadedFiles) {
            for (const range of file.ranges) {
                await workspace.loadFile(file.path, range.start, range.end);
            }
        }

        this.acpReplayLog = Array.isArray(state.acpReplayLog)
            ? state.acpReplayLog.map((update) => cloneACPUpdate(update))
            : [];
        this.messageHistory = state.messageHistory.map((message) => ({ ...message }));
        this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));
        if (!options.preserveTimestamps) {
            this.updatedAt = new Date().toISOString();
        }
        if (options.persist ?? true) {
            await this.persistMetadata();
        }
        if (options.emitPlanUpdate ?? true) {
            this.emitTodoPlanUpdate();
            this.emitConfigOptionsUpdate();
        }
    }

    registerResource(resource: SessionOwnedResource): void {
        this.ensureUsableForResourceRegistration();
        this.resources.register(resource);
    }

    attachSnapshotManager(snapshotManager: SnapshotManager): void {
        this.snapshotManager = snapshotManager;
        this.diogenes.registerTool(
            new SnapshotCreateTool(
                () => this.snapshotManager,
                () => this.promptTurn,
            ),
        );
        this.registerResource({
            dispose: () => undefined,
        });
        this.slashCommands.registerAll(createSnapshotSlashCommands());
        this.scheduleMetadataPersist();
    }

    async restoreSnapshot(snapshotId: string): Promise<{ safetySnapshotId: string | null }> {
        if (!this.snapshotManager) {
            throw new Error("Session snapshots are not enabled");
        }

        if (this.isBusy()) {
            throw new Error("Cannot restore while session is busy");
        }

        const snapshots = await this.snapshotManager.listSnapshots();
        if (!snapshots.some((snapshot) => snapshot.snapshotId === snapshotId)) {
            throw new Error(`Unknown snapshot: ${snapshotId}`);
        }

        const safetySnapshot = await this.snapshotManager.createSnapshot({
            trigger: "system_manual",
            turn: Math.max(1, this.promptTurn),
            label: `before-restore-${snapshotId}`,
            reason: `Safety snapshot before restoring ${snapshotId}`,
        });

        await this.snapshotManager.restoreSnapshot({ snapshotId });
        this.updatedAt = new Date().toISOString();
        await this.persistMetadata();

        return { safetySnapshotId: safetySnapshot.snapshotId };
    }

    async restoreSnapshotWithNotifications(
        snapshotId: string,
        options: { emitAgentMessage?: boolean } = {},
    ): Promise<{ safetySnapshotId: string | null }> {
        await this.recordSessionUpdateAndPersist({
            sessionUpdate: "snapshot_restore_started",
            snapshotId,
        });

        let restoreResult: { safetySnapshotId: string | null } = { safetySnapshotId: null };

        try {
            restoreResult = await this.restoreSnapshot(snapshotId);
        } catch (error) {
            await this.recordSessionUpdateAndPersist({
                sessionUpdate: "snapshot_restore_failed",
                snapshotId,
                error: error instanceof Error ? error.message : String(error),
            });
            throw error;
        }

        this.emitHydratedStateUpdates();
        await this.persistMetadata();
        await this.recordSessionUpdateAndPersist({
            sessionUpdate: "snapshot_restore_completed",
            snapshotId,
            _meta: {
                diogenes: {
                    safetySnapshotId: restoreResult.safetySnapshotId,
                },
            },
        });

        if (options.emitAgentMessage ?? true) {
            const summary = this.renderMarkdownSections([
                {
                    title: "Restore Completed",
                    bullets: [
                        `**Session ID:** \`${this.sessionId}\``,
                        `**Restored Snapshot:** \`${snapshotId}\``,
                        restoreResult.safetySnapshotId
                            ? `**Safety Snapshot:** \`${restoreResult.safetySnapshotId}\``
                            : "**Safety Snapshot:** (not available)",
                    ],
                },
            ]);
            await this.appendAssistantMessage(summary);
        }

        return restoreResult;
    }

    async listSnapshots(): Promise<import("../snapshot/types").SnapshotSummary[]> {
        if (!this.snapshotManager) {
            return [];
        }

        return this.snapshotManager.listSnapshots();
    }

    getAvailableCommands(): AvailableCommand[] {
        return this.slashCommands.list().map((definition) => definition.command);
    }

    getConfigOptions(): SessionConfigOption[] | null {
        const modelsPath = ensureDefaultModelsConfigSync();
        const modelsConfig = loadModelsConfig(modelsPath);
        if (!modelsConfig) {
            return null;
        }

        // Build available options from config file
        const options: SessionConfigSelectOption[] = [];
        for (const [providerName, provider] of Object.entries(modelsConfig.providers)) {
            for (const [modelName, model] of Object.entries(provider.models)) {
                options.push({
                    value: `${providerName}/${modelName}`,
                    name: model.name,
                    description: model.description ?? null,
                });
            }
        }

        if (options.length === 0) {
            return null;
        }

        // Determine current value: prefer session's llmConfig if it's in available options,
        // otherwise fall back to config file default
        const llmConfig = this.diogenes.getLLMConfig();
        const sessionModelValue =
            llmConfig.provider && llmConfig.model
                ? `${llmConfig.provider}/${llmConfig.model}`
                : null;
        const currentValue =
            sessionModelValue && options.some((opt) => opt.value === sessionModelValue)
                ? sessionModelValue
                : (modelsConfig.default ?? null);

        if (!currentValue) {
            return null;
        }

        return [
            {
                id: "model",
                name: "Model",
                description: "Controls which provider/model the session uses",
                category: "model",
                type: "select",
                currentValue,
                options,
            },
        ];
    }

    async setConfigOption(configId: string, value: string): Promise<void> {
        switch (configId) {
            case "model": {
                const modelsPath = ensureDefaultModelsConfigSync();
                const modelsConfig = loadModelsConfig(modelsPath);
                if (!modelsConfig) {
                    throw new Error("Models configuration is unavailable");
                }

                const resolved = resolveModel(modelsConfig, value);
                this.diogenes.setLLMConfig({
                    provider: resolved.provider,
                    providerStyle: resolved.providerStyle,
                    supportsToolRole: resolved.supportsToolRole,
                    model: resolved.model,
                    baseURL: resolved.baseURL,
                    apiKey: resolved.apiKey,
                    maxTokens: resolved.maxTokens,
                    temperature: resolved.temperature,
                    capabilities: {
                        supportsNativeToolCalls: resolved.supportsNativeToolCalls,
                        supportsInterleavedThinking: resolved.supportsInterleavedThinking,
                    },
                });
                this.updatedAt = new Date().toISOString();
                await this.persistMetadata();
                this.emitConfigOptionsUpdate();
                return;
            }
            default:
                throw new Error(`Unknown config option: ${configId}`);
        }
    }

    emitConfigOptionsUpdate(options: EmitSessionUpdateOptions = {}): void {
        const configOptions = this.getConfigOptions();
        if (!configOptions) {
            return;
        }

        this.emitSessionUpdate(
            {
                sessionUpdate: "config_option_update",
                configOptions,
            },
            options,
        );
    }

    private emitSessionUpdate(
        update: Record<string, unknown>,
        options: EmitSessionUpdateOptions = {},
    ): void {
        if (options.record ?? true) {
            this.acpReplayLog.push(cloneACPUpdate(update));
        }

        if (options.notify ?? true) {
            this.notify("session/update", {
                sessionId: this.sessionId,
                update,
            });
        }
    }

    private async recordSessionUpdateAndPersist(update: Record<string, unknown>): Promise<void> {
        this.emitSessionUpdate(update);
        await this.persistMetadata();
    }

    private recordUserPromptForReplay(promptText: string): void {
        this.emitSessionUpdate(
            {
                sessionUpdate: "user_message_chunk",
                content: createTextContent(promptText),
            },
            { notify: false },
        );
    }

    emitAvailableCommandsUpdate(options: EmitSessionUpdateOptions = {}): void {
        const availableCommands = this.getAvailableCommands();
        if (availableCommands.length === 0) {
            return;
        }

        this.emitSessionUpdate(
            {
                sessionUpdate: "available_commands_update",
                availableCommands,
            },
            options,
        );
    }

    emitHydratedStateUpdates(options: EmitSessionUpdateOptions = {}): void {
        this.emitSessionUpdate(
            {
                sessionUpdate: "session_info_update",
                title: this.title,
                updatedAt: this.updatedAt,
                _meta: {
                    diogenes: {
                        description: this.description,
                        state: this.lifecycleState,
                        hasActiveRun: this.activeRun !== null,
                        hydratedState: this.getHydratedStateMeta(),
                    },
                },
            },
            options,
        );
        this.emitTodoPlanUpdate(options);
        this.emitAvailableCommandsUpdate(options);
    }

    emitClientReadyMessage(mode: "new" | "load"): void {
        const diagnostics = collectSetupDiagnostics(this.config);
        const snapshotLine =
            diagnostics.snapshot.mode === "degraded"
                ? `Snapshots degraded (${diagnostics.snapshot.unavailablePhase || "unknown"}/${diagnostics.snapshot.unavailableKind || "unknown"}). Use /doctor for details.`
                : diagnostics.snapshot.mode === "enabled"
                  ? "Snapshots ready."
                  : "Snapshots disabled.";
        const lines =
            mode === "new"
                ? [
                      "Session ready.",
                      snapshotLine,
                      "Use `/init` for setup help, `/doctor` for diagnostics, or `/session` for current state.",
                  ]
                : [
                      "Session loaded.",
                      snapshotLine,
                      "Use `/session` to inspect restored state, `/doctor` for diagnostics, or `/help` to see local commands.",
                  ];

        this.emitSessionUpdate(
            {
                sessionUpdate: "agent_message_chunk",
                content: createTextContent(lines.join("\n")),
            },
            { record: false },
        );
    }

    isBusy(): boolean {
        return this.activeRun !== null;
    }

    cancel(): void {
        if (!this.activeRun) {
            return;
        }

        this.activeRun.cancelled = true;
        this.diogenes.getLLMClient()?.abort();
    }

    async prompt(prompt: PromptBlock[]): Promise<TaskRunResult> {
        this.ensurePromptAllowed();
        const turn = ++this.promptTurn;
        const parsedSlashCommand = this.parseSlashCommand(prompt);
        const promptText = promptBlocksToText(prompt);

        this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));
        this.recordUserPromptForReplay(promptText);

        if (
            this.snapshotManager &&
            this.snapshotManager.isAutoBeforePromptEnabled() &&
            !this.shouldSkipAutoBeforePromptSnapshot(parsedSlashCommand)
        ) {
            await this.snapshotManager.createSnapshot({
                trigger: "before_prompt",
                turn,
            });
        }

        const slashCommandResult = await this.tryHandleSlashCommand(
            prompt,
            turn,
            parsedSlashCommand,
        );
        if (slashCommandResult) {
            return slashCommandResult;
        }

        const runId = `${this.sessionId}:run:${Date.now()}`;
        this.activeRun = {
            id: runId,
            cancelled: false,
            streamedContent: "",
            emittedContentLength: 0,
            nextToolCallSequence: 0,
            toolCallIds: new Map(),
            pendingToolCallKeys: new Map(),
        };
        this.lifecycleState = "running";
        this.updatedAt = new Date().toISOString();
        await this.persistMetadata();

        const runPromise = this.runPrompt(promptText);
        this.activePromptPromise = runPromise;

        try {
            return await runPromise;
        } finally {
            this.activePromptPromise = null;
            this.activeRun = null;

            if (this.lifecycleState === "running") {
                this.lifecycleState = "active";
            }
            this.updatedAt = new Date().toISOString();
            await this.persistMetadata();
        }
    }

    async dispose(): Promise<void> {
        if (this.lifecycleState === "disposed") {
            return;
        }

        if (this.disposePromise) {
            return this.disposePromise;
        }

        this.disposePromise = this.disposeInternal();

        try {
            await this.disposePromise;
        } finally {
            this.disposePromise = null;
        }
    }

    private async disposeInternal(): Promise<void> {
        if (this.lifecycleState === "disposed") {
            return;
        }

        this.lifecycleState = "disposing";
        this.updatedAt = new Date().toISOString();
        this.cancel();

        try {
            await this.activePromptPromise;
        } catch {
            // Prompt failures do not block resource cleanup during disposal.
        }

        await this.resources.disposeAll();

        this.messageHistory = [];
        this.currentMessageHistory = [];
        this.activeRun = null;
        this.activePromptPromise = null;
        this.lifecycleState = "disposed";
        this.updatedAt = new Date().toISOString();
    }

    private async runPrompt(promptText: string): Promise<TaskRunResult> {
        const result = await runTaskLoop(this.diogenes, promptText, {
            maxIterations: this.maxIterations ?? Number.POSITIVE_INFINITY,
            messageHistory: this.messageHistory,
            shouldCancel: () => Boolean(this.activeRun?.cancelled),
            onEvent: (event) => {
                this.handleEvent(event);
                return undefined;
            },
            onMessageHistoryUpdate: (messageHistory) => {
                this.currentMessageHistory = messageHistory;
            },
        });
        this.messageHistory = result.messageHistory;
        this.currentMessageHistory = result.messageHistory.map((message) => ({ ...message }));
        this.updatedAt = new Date().toISOString();
        await this.persistMetadata();
        return result;
    }

    private ensurePromptAllowed(): void {
        if (this.lifecycleState === "disposing") {
            throw new Error("Session is disposing");
        }

        if (this.lifecycleState === "disposed") {
            throw new Error("Session is disposed");
        }

        if (this.activeRun) {
            throw new Error("Session already has an active run");
        }
    }

    private ensureUsableForResourceRegistration(): void {
        if (this.lifecycleState === "disposing" || this.lifecycleState === "disposed") {
            throw new Error("Cannot register session resources after disposal has started");
        }
    }

    private async tryHandleSlashCommand(
        prompt: PromptBlock[],
        turn: number,
        parsed: ParsedSlashCommand | null = this.parseSlashCommand(prompt),
    ): Promise<TaskRunResult | null> {
        if (!parsed) {
            return null;
        }

        const definition = this.slashCommands.find(parsed.name);
        if (definition) {
            return definition.execute(this.createSlashCommandContext(), parsed, turn);
        }

        return this.handleUnknownSlashCommand(parsed);
    }

    private parseSlashCommand(prompt: PromptBlock[]): ParsedSlashCommand | null {
        const commandBlock = prompt.find(
            (block) => block.type === "text" && block.text.trim().startsWith("/"),
        );
        if (!commandBlock || commandBlock.type !== "text") {
            return null;
        }

        const trimmedText = commandBlock.text.trim();
        if (!trimmedText.startsWith("/")) {
            return null;
        }

        const [firstLine] = trimmedText.split(/\r?\n/, 1);
        const match = firstLine.match(/^\/([^\s]+)(?:\s+(.*))?$/);
        if (!match) {
            return null;
        }

        const promptText = promptBlocksToText(prompt);
        return {
            name: match[1].toLowerCase(),
            argumentsText: (match[2] || "").trim(),
            commandText: firstLine.trim(),
            promptText: promptText || firstLine.trim(),
        };
    }

    private shouldSkipAutoBeforePromptSnapshot(parsed: ParsedSlashCommand | null): boolean {
        if (!parsed) {
            return false;
        }

        const definition = this.slashCommands.find(parsed.name);

        return definition?.skipAutoBeforePromptSnapshot ?? true;
    }

    private async handleUnknownSlashCommand(parsed: ParsedSlashCommand): Promise<TaskRunResult> {
        return this.runLocalSlashCommand(parsed, async (historyBeforeCommand, userMessage) => {
            await Promise.resolve();
            const availableCommands = this.getAvailableCommands().map(
                (command) => `/${command.name}`,
            );
            const summary =
                availableCommands.length > 0
                    ? this.renderMarkdownSections([
                          {
                              title: "Unknown Command",
                              bullets: [
                                  `Command: \`${parsed.commandText}\``,
                                  `Available: ${availableCommands.map((command) => `\`${command}\``).join(", ")}`,
                                  "Use `/help` for details.",
                              ],
                          },
                      ])
                    : this.renderMarkdownSections([
                          {
                              title: "Unknown Command",
                              bullets: [
                                  `Command: \`${parsed.commandText}\``,
                                  "No ACP slash commands are currently available.",
                              ],
                          },
                      ]);

            return this.completeLocalSlashCommand(
                historyBeforeCommand,
                userMessage,
                summary,
                false,
            );
        });
    }

    private createSlashCommandContext(): SlashCommandContext {
        return {
            sessionId: this.sessionId,
            snapshotEnabled: this.snapshotManager !== null,
            getSetupDiagnostics: () => collectSetupDiagnostics(this.config),
            getAvailableCommands: () => this.getAvailableCommands(),
            getMetadata: () => this.getMetadata(),
            getHydratedStateMeta: () => this.getHydratedStateMeta(),
            getTodoItemCount: () =>
                this.diogenes.getWorkspaceManager().getTodoWorkspace().items.length,
            listSnapshots: async () => this.listSnapshots(),
            createSnapshot: async ({ turn, label, reason }) => {
                if (!this.snapshotManager) {
                    throw new Error("Session snapshots are not enabled");
                }
                return this.snapshotManager.createSnapshot({
                    trigger: "system_manual",
                    turn,
                    label,
                    reason,
                });
            },
            restoreSnapshotWithNotifications: async (snapshotId) =>
                this.restoreSnapshotWithNotifications(snapshotId, { emitAgentMessage: false }),
            runLocalCommand: async (parsed, action) => this.runLocalSlashCommand(parsed, action),
            completeLocalCommand: (historyBeforeCommand, userMessage, summary, success) =>
                this.completeLocalSlashCommand(historyBeforeCommand, userMessage, summary, success),
            renderMarkdownSections: (sections) => this.renderMarkdownSections(sections),
        };
    }

    private async runLocalSlashCommand(
        parsed: ParsedSlashCommand,
        action: (
            historyBeforeCommand: ConversationMessage[],
            userMessage: ConversationMessage,
        ) => Promise<TaskRunResult>,
    ): Promise<TaskRunResult> {
        this.lifecycleState = "running";
        this.updatedAt = new Date().toISOString();
        await this.persistMetadata();

        try {
            const { historyBeforeCommand, userMessage } = this.appendLocalSlashUserMessage(
                parsed.promptText,
            );
            return await action(historyBeforeCommand, userMessage);
        } finally {
            if (this.lifecycleState === "running") {
                this.lifecycleState = "active";
            }
            this.updatedAt = new Date().toISOString();
            await this.persistMetadata();
        }
    }

    private appendLocalSlashUserMessage(promptText: string): {
        historyBeforeCommand: ConversationMessage[];
        userMessage: ConversationMessage;
    } {
        const historyBeforeCommand = this.messageHistory.map((message) => ({ ...message }));
        const userMessage: ConversationMessage = {
            role: "user",
            content: `========= ${historyBeforeCommand.length > 0 ? "NEW TASK" : "TASK"}\n${promptText}\n=========`,
        };
        this.currentMessageHistory = [...historyBeforeCommand, userMessage];

        return { historyBeforeCommand, userMessage };
    }

    private completeLocalSlashCommand(
        historyBeforeCommand: ConversationMessage[],
        userMessage: ConversationMessage,
        summary: string,
        success: boolean,
    ): TaskRunResult {
        const assistantMessage: ConversationMessage = {
            role: "assistant",
            content: summary,
        };
        this.messageHistory = [...historyBeforeCommand, userMessage, assistantMessage];
        this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));

        this.emitSessionUpdate({
            sessionUpdate: "agent_message_chunk",
            content: createTextContent(summary),
        });

        return {
            success,
            result: summary,
            iterations: 0,
            taskEnded: true,
            stopReason: "end_turn",
            messageHistory: this.messageHistory.map((message) => ({ ...message })),
        };
    }

    private async appendAssistantMessage(content: string): Promise<void> {
        const assistantMessage: ConversationMessage = {
            role: "assistant",
            content,
        };
        this.messageHistory = [...this.messageHistory, assistantMessage];
        this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));
        this.updatedAt = new Date().toISOString();
        this.emitSessionUpdate({
            sessionUpdate: "agent_message_chunk",
            content: createTextContent(content),
        });
        await this.persistMetadata();
    }

    private renderMarkdownSections(sections: MarkdownSection[]): string {
        const parts: string[] = [];

        for (const [index, section] of sections.entries()) {
            if (index > 0) {
                parts.push("");
            }

            parts.push(`## ${section.title}`);

            if (section.paragraphs) {
                parts.push("");
                parts.push(...section.paragraphs);
            }

            if (section.bullets && section.bullets.length > 0) {
                parts.push("");
                parts.push(...section.bullets.map((bullet) => `- ${bullet}`));
            }
        }

        return parts.join("\n");
    }

    private extractLocations(
        params: Record<string, any> | undefined,
    ): Array<{ path: string }> | undefined {
        const locations = extractLocations(params);
        if (!locations) {
            return undefined;
        }

        return locations.map((location) => ({
            ...location,
            path: path.isAbsolute(location.path)
                ? path.normalize(location.path)
                : path.resolve(this.cwd, location.path),
        }));
    }

    private getToolCallIterationKey(iteration: number, index: number): string {
        return `${iteration}:${index}`;
    }

    private registerToolCallId(iteration: number, index: number): string {
        if (!this.activeRun) {
            return `${this.sessionId}:toolcall:missing-run`;
        }

        const key = this.getToolCallIterationKey(iteration, index);
        const existing = this.activeRun.toolCallIds.get(key);
        if (existing) {
            return existing;
        }

        const toolCallId = `${this.activeRun.id}:toolcall:${++this.activeRun.nextToolCallSequence}`;
        this.activeRun.toolCallIds.set(key, toolCallId);
        return toolCallId;
    }

    private getToolCallId(iteration: number, index: number): string {
        if (!this.activeRun) {
            return `${this.sessionId}:toolcall:missing-run`;
        }

        return this.registerToolCallId(iteration, index);
    }

    private emitTodoPlanUpdate(options: EmitSessionUpdateOptions = {}): void {
        const items = this.diogenes.getWorkspaceManager().getTodoWorkspace().items;

        this.emitSessionUpdate(
            {
                sessionUpdate: "plan",
                entries: items.map((item) => ({
                    content: item.text,
                    priority: mapTodoPriority(item.state),
                    status: mapTodoStatus(item.state),
                })),
            },
            options,
        );
    }

    private emitSessionMetadataUpdate(): void {
        this.emitSessionUpdate({
            sessionUpdate: "session_info_update",
            title: this.title,
            updatedAt: this.updatedAt,
            _meta: {
                diogenes: {
                    description: this.description,
                    state: this.lifecycleState,
                    hasActiveRun: this.activeRun !== null,
                },
            },
        });
    }

    private async persistMetadata(): Promise<void> {
        if (!this.persistence) {
            return;
        }
        if (this.lifecycleState === "disposing" || this.lifecycleState === "disposed") {
            return;
        }

        const metadata = this.getStoredMetadata();
        const state = this.getPersistedState();
        this.metadataWriteChain = this.metadataWriteChain
            .catch(() => undefined)
            .then(async () => {
                try {
                    await this.persistence?.writeMetadata(metadata);
                    await this.persistence?.writeState(this.sessionId, state);
                } catch (error) {
                    if (isNotFoundError(error) && this.lifecycleState === "disposed") {
                        return;
                    }
                    throw error;
                }
            });

        await this.metadataWriteChain;
    }

    private scheduleMetadataPersist(): void {
        void this.persistMetadata().catch(() => undefined);
    }

    private getToolCallContentKey(toolCall: ToolCall): string {
        return JSON.stringify({ tool: toolCall.tool, params: toolCall.params });
    }

    private tryEmitPendingToolCalls(): void {
        if (!this.activeRun) {
            return;
        }

        const toolCallManager = this.diogenes.getToolCallManager();
        const partialResult = toolCallManager.tryParsePartial(this.activeRun.streamedContent);
        if (!partialResult.isInToolCallBlock || partialResult.completeToolCalls.length === 0) {
            return;
        }

        for (const toolCall of partialResult.completeToolCalls) {
            const contentKey = this.getToolCallContentKey(toolCall);
            if (this.activeRun.pendingToolCallKeys.has(contentKey)) {
                continue;
            }

            const sequence = this.activeRun.nextToolCallSequence++;
            const toolCallId = `${this.activeRun.id}:tool:${sequence}`;
            this.activeRun.toolCallIds.set(`pending:${sequence}`, toolCallId);
            this.activeRun.pendingToolCallKeys.set(contentKey, toolCallId);

            this.emitSessionUpdate(
                createACPToolCallUpdate(
                    toolCallId,
                    toolCall,
                    "pending",
                    this.extractLocations(toolCall.params),
                ),
            );
        }
    }

    private handleEvent(event: TaskRunEvent): void {
        if (event.type === "llm.stream.delta") {
            if (this.activeRun) {
                this.activeRun.streamedContent += event.chunk.content;
                const visibleText = getVisibleAssistantText(this.activeRun.streamedContent);
                const nextChunk = visibleText.slice(this.activeRun.emittedContentLength);

                if (nextChunk.length === 0) {
                    this.tryEmitPendingToolCalls();
                    return;
                }

                this.activeRun.emittedContentLength = visibleText.length;
                this.emitSessionUpdate({
                    sessionUpdate: "agent_message_chunk",
                    content: createTextContent(nextChunk),
                });
                this.tryEmitPendingToolCalls();
                return;
            }

            this.emitSessionUpdate({
                sessionUpdate: "agent_message_chunk",
                content: createTextContent(event.chunk.content),
            });
            return;
        }

        if (event.type === "tool.calls.parsed") {
            event.toolCalls.forEach((toolCall, index) => {
                const contentKey = this.getToolCallContentKey(toolCall);
                const existingId = this.activeRun?.pendingToolCallKeys.get(contentKey);

                if (existingId) {
                    const iterationKey = this.getToolCallIterationKey(event.iteration, index);
                    this.activeRun?.toolCallIds.set(iterationKey, existingId);
                } else {
                    this.emitSessionUpdate(
                        createACPToolCallUpdate(
                            this.registerToolCallId(event.iteration, index),
                            toolCall,
                            "pending",
                            this.extractLocations(toolCall.params),
                        ),
                    );
                    const toolCallId = this.getToolCallId(event.iteration, index);
                    this.activeRun?.pendingToolCallKeys.set(contentKey, toolCallId);
                }
            });
            return;
        }

        if (event.type === "tool.execution.started") {
            this.emitSessionUpdate(
                createACPToolCallResultUpdate(
                    this.getToolCallId(event.iteration, event.index),
                    "in_progress",
                ),
            );
            return;
        }

        if (event.type === "tool.execution.completed") {
            const tool = this.diogenes.getTool(event.toolCall.tool);
            const formattedACPText =
                event.toolCall.tool === "file.edit" && !event.result.success
                    ? tool?.formatResultForLLM(event.toolCall, event.result)
                    : undefined;

            this.emitSessionUpdate(
                createACPToolCallResultUpdate(
                    this.getToolCallId(event.iteration, event.index),
                    event.result.success ? "completed" : "failed",
                    createACPToolResultContent(
                        event.toolCall.tool,
                        event.toolCall.params,
                        event.result,
                        formattedACPText,
                    ),
                    event.result,
                ),
            );

            if (
                event.result.success &&
                (event.toolCall.tool === "todo.set" || event.toolCall.tool === "todo.update")
            ) {
                this.emitTodoPlanUpdate();
            }

            if (event.result.success && event.toolCall.tool === "task.end") {
                const title =
                    typeof event.result.data?.title === "string"
                        ? event.result.data.title.trim()
                        : "";
                const description =
                    typeof event.result.data?.description === "string"
                        ? event.result.data.description.trim()
                        : "";
                const reason =
                    typeof event.result.data?.reason === "string"
                        ? event.result.data.reason.trim()
                        : "";
                const summary =
                    typeof event.result.data?.summary === "string"
                        ? event.result.data.summary.trim()
                        : "";

                this.title = title || reason || this.title;
                this.description = description || summary || this.description;
                this.updatedAt = new Date().toISOString();
                this.scheduleMetadataPersist();
                this.emitSessionMetadataUpdate();
            }

            return;
        }

        if (event.type === "context.warning") {
            for (const index of event.skippedIndexes) {
                const skippedResult = createSkippedToolResult(event.warning);
                this.emitSessionUpdate(
                    createACPToolCallResultUpdate(
                        this.getToolCallId(event.iteration, index),
                        "failed",
                        createToolResultContent(formatToolResultFallback("tool", skippedResult)),
                        skippedResult,
                    ),
                );
            }

            this.emitSessionUpdate({
                sessionUpdate: "plan",
                entries: [
                    {
                        content: `Context warning: ${event.warning}`,
                        priority: "high",
                        status: "in_progress",
                    },
                ],
            });
            return;
        }

        if (event.type === "run.completed") {
            if (typeof event.result.result !== "string" || event.result.result.length === 0) {
                return;
            }

            this.emitSessionUpdate({
                sessionUpdate: "agent_message_chunk",
                content: createTextContent(event.result.result),
            });
        }
    }
}

function isNotFoundError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }
    const errorWithCode = error as { code?: unknown };
    return typeof errorWithCode.code === "string" && errorWithCode.code === "ENOENT";
}
