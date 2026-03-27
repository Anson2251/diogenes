import * as path from "path";
import { createDiogenes } from "../create-diogenes";
import type { TodoItem, ToolResult } from "../types";
import type { DiogenesConfig } from "../types";
import { runTaskLoop, type ConversationMessage, type TaskRunEvent, type TaskRunResult } from "../runtime/task-runner";
import type { SnapshotManager } from "../snapshot/manager";
import type { SnapshotStateProvider } from "../snapshot/state-serializer";
import { SnapshotCreateTool } from "../tools/snapshot/snapshot-create";
import type { PromptBlock } from "./types";
import type { AvailableCommand } from "./types";

export interface ACPNotificationSink {
    (method: string, params: any): void;
}

export type SessionLifecycleState =
    | "active"
    | "running"
    | "disposing"
    | "disposed";

export interface SessionMetadata {
    sessionId: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    state: SessionLifecycleState;
    hasActiveRun: boolean;
}

interface SessionOwnedResource {
    dispose(): Promise<void> | void;
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
) {
    const content: any[] = createToolResultContent(
        formattedText ?? formatToolResultFallback(toolName, result, params),
    );

    const diffData = result.success ? result.data?._diff : undefined;
    if (
        (toolName === "file.edit" || toolName === "file.create" || toolName === "file.overwrite")
        && diffData
        && typeof diffData.path === "string"
        && typeof diffData.newText === "string"
        && (
            toolName === "file.create"
            || (Array.isArray(diffData.hunks) && diffData.hunks.length > 0)
        )
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
        default:
            return "pending";
    }
}

function mapTodoPriority(state: TodoItem["state"]): "high" | "medium" | "low" {
    switch (state) {
        case "active":
            return "high";
        case "done":
            return "low";
        default:
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
        for (let prefixLength = maxPrefixLength; prefixLength > reservedSuffixLength; prefixLength--) {
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
                parts.push(
                    `[Embedded Resource] ${block.resource.uri}\n${block.resource.text}`,
                );
            } else {
                parts.push(`[Embedded Resource] ${block.resource.uri}`);
            }
        }
    }

    return parts.join("\n\n").trim();
}

function mapToolKind(toolName: string): string {
    if (toolName.startsWith("file.load") || toolName.startsWith("file.peek") || toolName.startsWith("dir.list")) {
        return "read";
    }
    if (toolName.startsWith("file.edit") || toolName.startsWith("file.create") || toolName.startsWith("file.overwrite")) {
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

function extractLocations(params: Record<string, any> | undefined): Array<{ path: string }> | undefined {
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

    const applied = Array.isArray(result.data.applied) ? result.data.applied : [];
    const errors = Array.isArray(result.data.errors) ? result.data.errors : [];
    const totalLines = typeof result.data.file_state?.total_lines === "number"
        ? result.data.file_state.total_lines
        : undefined;

    const lines: string[] = [];
    const summary = [`Updated ${pathName}: ${applied.length} edit${applied.length === 1 ? "" : "s"} applied`];
    if (errors.length > 0) {
        summary.push(`${errors.length} failed`);
    }
    if (typeof totalLines === "number") {
        summary.push(`${totalLines} total lines`);
    }
    lines.push(summary.join(", "));

    for (const edit of applied.slice(0, 3)) {
        lines.push(
            `${edit.mode} lines ${edit.matchedRange[0]}-${edit.matchedRange[1]} -> ${edit.newRange[0]}-${edit.newRange[1]}`,
        );
    }
    if (applied.length > 3) {
        lines.push(`${applied.length - 3} more edit${applied.length - 3 === 1 ? "" : "s"} applied`);
    }

    for (const error of errors.slice(0, 2)) {
        lines.push(`Edit ${error.index} failed: ${error.message}`);
    }
    if (errors.length > 2) {
        lines.push(`${errors.length - 2} more edit failures`);
    }

    return lines.join("\n");
}

function formatToolResultFallback(
    toolName: string,
    result: ToolResult,
    params?: Record<string, any>,
): string {
    if (result.success) {
        if (toolName === "task.end" && typeof result.data?.summary === "string" && result.data.summary.length > 0) {
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
                ? result.data.loaded_range.map((range) => `${range[0]}-${range[1]}`).join(", ")
                : "requested range";
            const totalLines = typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            return `Loaded lines ${ranges} (${totalLines} total lines in file)`;
        }

        if (toolName === "file.peek") {
            const filePath = typeof params?.path === "string" ? params.path : "unknown file";
            const previewRange = Array.isArray(result.data?.preview_range)
                ? result.data.preview_range as [number, number]
                : [1, 1];
            const totalLines = typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            const lines = Array.isArray(result.data?.lines)
                ? result.data.lines.filter((line): line is string => typeof line === "string")
                : [];
            const note = typeof result.data?._note === "string" ? result.data._note : "";

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
                .filter((line, index, all) => line.length > 0 || (index > 0 && all[index - 1].length > 0))
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
            const targetPath = typeof result.data?.path === "string"
                ? result.data.path
                : typeof params?.path === "string"
                    ? params.path
                    : "file";
            return `Removed ${targetPath} from workspace context`;
        }

        if (toolName === "dir.unload") {
            const targetPath = typeof result.data?.path === "string"
                ? result.data.path
                : typeof params?.path === "string"
                    ? params.path
                    : "directory";
            return `Removed ${targetPath} from workspace context`;
        }

        if (toolName === "file.create") {
            const totalLines = typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
            return `Created file (${totalLines} line${totalLines === 1 ? "" : "s"})`;
        }

        if (toolName === "file.overwrite") {
            const totalLines = typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
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
            const totalLines = typeof result.data?.total_lines === "number" ? result.data.total_lines : 0;
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
            const exitCode = result.data?.exit_code;
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
            const snapshotId = typeof result.data?.snapshot_id === "string" ? result.data.snapshot_id : "snapshot";
            const label = typeof result.data?.label === "string" ? result.data.label : undefined;
            return label ? `Created snapshot ${snapshotId} (${label})` : `Created snapshot ${snapshotId}`;
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
    const details = result.error?.details ? `\n${JSON.stringify(result.error.details, null, 2)}` : "";
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

export class ACPSession implements SnapshotStateProvider {
    readonly sessionId: string;
    readonly cwd: string;
    readonly createdAt: string;

    private readonly notify: ACPNotificationSink;
    private readonly diogenes: ReturnType<typeof createDiogenes>;
    private readonly maxIterations: number | undefined;
    private readonly resources = new SessionResourceRegistry();
    private messageHistory: ConversationMessage[] = [];
    private currentMessageHistory: ConversationMessage[] = [];
    private lifecycleState: SessionLifecycleState = "active";
    private promptTurn = 0;
    private snapshotManager: SnapshotManager | null = null;
    private updatedAt: string;
    private disposePromise: Promise<void> | null = null;
    private activeRun: {
        id: string;
        cancelled: boolean;
        streamedContent: string;
        emittedContentLength: number;
        nextToolCallSequence: number;
        toolCallIds: Map<string, string>;
    } | null = null;
    private activePromptPromise: Promise<TaskRunResult> | null = null;

    constructor(
        sessionId: string,
        cwd: string,
        config: DiogenesConfig,
        maxIterations: number | undefined,
        notify: ACPNotificationSink,
    ) {
        this.sessionId = sessionId;
        this.cwd = path.resolve(cwd);
        this.createdAt = new Date().toISOString();
        this.updatedAt = this.createdAt;
        this.maxIterations = maxIterations;
        this.notify = notify;
        this.diogenes = createDiogenes({
            ...config,
            security: {
                ...(config.security || {}),
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
        const source = this.currentMessageHistory.length > 0 ? this.currentMessageHistory : this.messageHistory;
        return source.map((message) => ({ ...message }));
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
            state: this.lifecycleState,
            hasActiveRun: this.activeRun !== null,
        };
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
            dispose: () => snapshotManager.cleanup(),
        });
    }

    getAvailableCommands(): AvailableCommand[] {
        if (!this.snapshotManager) {
            return [];
        }

        return [
            {
                name: "snapshot",
                description: "Create a defensive session snapshot",
                input: {
                    hint: "optional label for the snapshot",
                },
            },
        ];
    }

    emitAvailableCommandsUpdate(): void {
        const availableCommands = this.getAvailableCommands();
        if (availableCommands.length === 0) {
            return;
        }

        this.notify("session/update", {
            sessionId: this.sessionId,
            update: {
                sessionUpdate: "available_commands_update",
                availableCommands,
            },
        });
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

        this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));

        if (this.snapshotManager && this.snapshotManager.isAutoBeforePromptEnabled()) {
            await this.snapshotManager.createSnapshot({
                trigger: "before_prompt",
                turn,
            });
        }

        const slashCommandResult = await this.tryHandleSlashCommand(prompt, turn);
        if (slashCommandResult) {
            return slashCommandResult;
        }

        const promptText = promptBlocksToText(prompt);
        const runId = `${this.sessionId}:run:${Date.now()}`;
        this.activeRun = {
            id: runId,
            cancelled: false,
            streamedContent: "",
            emittedContentLength: 0,
            nextToolCallSequence: 0,
            toolCallIds: new Map(),
        };
        this.lifecycleState = "running";
        this.updatedAt = new Date().toISOString();

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
            shouldCancel: () => this.activeRun?.cancelled === true,
            onEvent: (event) => this.handleEvent(event),
            onMessageHistoryUpdate: (messageHistory) => {
                this.currentMessageHistory = messageHistory;
            },
        });
        this.messageHistory = result.messageHistory;
        this.currentMessageHistory = result.messageHistory.map((message) => ({ ...message }));
        this.updatedAt = new Date().toISOString();
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

    private async tryHandleSlashCommand(prompt: PromptBlock[], turn: number): Promise<TaskRunResult | null> {
        if (prompt.length !== 1 || prompt[0]?.type !== "text") {
            return null;
        }

        const text = prompt[0].text.trim();
        if (!text.startsWith("/")) {
            return null;
        }

        if (text === "/snapshot" || text.startsWith("/snapshot ")) {
            return this.handleSnapshotSlashCommand(text, turn);
        }

        return null;
    }

    private async handleSnapshotSlashCommand(commandText: string, turn: number): Promise<TaskRunResult> {
        if (!this.snapshotManager) {
            throw new Error("Session snapshots are not enabled");
        }

        this.lifecycleState = "running";
        this.updatedAt = new Date().toISOString();

        try {
            const label = commandText.slice("/snapshot".length).trim() || undefined;
            const historyBeforeCommand = this.messageHistory.map((message) => ({ ...message }));
            const userMessage: ConversationMessage = {
                role: "user",
                content: `========= ${historyBeforeCommand.length > 0 ? "NEW TASK" : "TASK"}\n${commandText}\n=========`,
            };
            this.currentMessageHistory = [...historyBeforeCommand, userMessage];

            const result = await this.snapshotManager.createSnapshot({
                trigger: "system_manual",
                turn,
                label,
                reason: "Created via ACP slash command",
            });
            const summary = label
                ? `Created snapshot ${result.snapshotId} with label "${label}".`
                : `Created snapshot ${result.snapshotId}.`;
            const assistantMessage: ConversationMessage = {
                role: "assistant",
                content: summary,
            };
            this.messageHistory = [...historyBeforeCommand, userMessage, assistantMessage];
            this.currentMessageHistory = this.messageHistory.map((message) => ({ ...message }));

            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "agent_message_chunk",
                    content: createTextContent(summary),
                },
            });

            return {
                success: true,
                result: summary,
                iterations: 0,
                taskEnded: true,
                stopReason: "end_turn",
                messageHistory: this.messageHistory.map((message) => ({ ...message })),
            };
        } finally {
            if (this.lifecycleState === "running") {
                this.lifecycleState = "active";
            }
            this.updatedAt = new Date().toISOString();
        }
    }

    private extractLocations(params: Record<string, any> | undefined): Array<{ path: string }> | undefined {
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

    private getToolCallKey(iteration: number, index: number): string {
        return `${iteration}:${index}`;
    }

    private registerToolCallId(iteration: number, index: number): string {
        if (!this.activeRun) {
            return `${this.sessionId}:toolcall:missing-run`;
        }

        const key = this.getToolCallKey(iteration, index);
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

    private emitTodoPlanUpdate(): void {
        const items = this.diogenes.getWorkspaceManager().getTodoWorkspace().items;

        this.notify("session/update", {
            sessionId: this.sessionId,
            update: {
                sessionUpdate: "plan",
                entries: items.map((item) => ({
                    content: item.text,
                    priority: mapTodoPriority(item.state),
                    status: mapTodoStatus(item.state),
                })),
            },
        });
    }

    private handleEvent(event: TaskRunEvent): void {
        if (event.type === "llm.stream.delta") {
            if (event.chunk.type === "content" && this.activeRun) {
                this.activeRun.streamedContent += event.chunk.content;
                const visibleText = getVisibleAssistantText(this.activeRun.streamedContent);
                const nextChunk = visibleText.slice(this.activeRun.emittedContentLength);

                if (nextChunk.length === 0) {
                    return;
                }

                this.activeRun.emittedContentLength = visibleText.length;
                this.notify("session/update", {
                    sessionId: this.sessionId,
                    update: {
                        sessionUpdate: "agent_message_chunk",
                        content: createTextContent(nextChunk),
                    },
                });
                return;
            }

            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "agent_message_chunk",
                    content: createTextContent(event.chunk.content),
                },
            });
            return;
        }

        if (event.type === "tool.calls.parsed") {
            event.toolCalls.forEach((toolCall, index) => {
                this.notify("session/update", {
                    sessionId: this.sessionId,
                    update: {
                        sessionUpdate: "tool_call",
                        toolCallId: this.registerToolCallId(event.iteration, index),
                        title: createToolCallTitle(toolCall.tool, toolCall.params),
                        kind: mapToolKind(toolCall.tool),
                        status: "pending",
                        rawInput: toolCall.params,
                        locations: this.extractLocations(toolCall.params),
                    },
                });
            });
            return;
        }

        if (event.type === "tool.execution.started") {
            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: this.getToolCallId(event.iteration, event.index),
                    status: "in_progress",
                },
            });
            return;
        }

        if (event.type === "tool.execution.completed") {
            const tool = this.diogenes.getTool(event.toolCall.tool);
            const formattedACPText = event.toolCall.tool === "file.edit" && !event.result.success
                ? tool?.formatResultForLLM(event.toolCall, event.result)
                : undefined;

            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: this.getToolCallId(event.iteration, event.index),
                    status: event.result.success ? "completed" : "failed",
                    content: createACPToolResultContent(
                        event.toolCall.tool,
                        event.toolCall.params,
                        event.result,
                        formattedACPText,
                    ),
                    rawOutput: event.result,
                },
            });

            if (
                event.result.success
                && (event.toolCall.tool === "todo.set" || event.toolCall.tool === "todo.update")
            ) {
                this.emitTodoPlanUpdate();
            }

            return;
        }

        if (event.type === "context.warning") {
            for (const index of event.skippedIndexes) {
                const skippedResult = createSkippedToolResult(event.warning);
                this.notify("session/update", {
                    sessionId: this.sessionId,
                    update: {
                        sessionUpdate: "tool_call_update",
                        toolCallId: this.getToolCallId(event.iteration, index),
                        status: "failed",
                        content: createToolResultContent(
                            formatToolResultFallback("tool", skippedResult),
                        ),
                        rawOutput: skippedResult,
                    },
                });
            }

            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "plan",
                    entries: [
                        {
                            content: `Context warning: ${event.warning}`,
                            priority: "high",
                            status: "in_progress",
                        },
                    ],
                },
            });
            return;
        }

        if (event.type === "run.completed") {
            if (typeof event.result.result !== "string" || event.result.result.length === 0) {
                return;
            }

            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "agent_message_chunk",
                    content: createTextContent(event.result.result),
                },
            });
        }
    }
}
