import * as path from "path";
import { createDiogenes } from "../create-diogenes";
import type { TodoItem, ToolResult } from "../types";
import type { DiogenesConfig } from "../types";
import { runTaskLoop, type ConversationMessage, type TaskRunEvent, type TaskRunResult } from "../runtime/task-runner";
import type { PromptBlock } from "./types";

export interface ACPNotificationSink {
    (method: string, params: any): void;
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

        if (toolName === "file.edit") {
            const pathName = typeof params?.path === "string" ? params.path : "file";
            const summary = formatFileEditResult(pathName, result);
            if (summary) {
                return summary;
            }
        }

        if (toolName === "file.unload") {
            return "Removed file from workspace context";
        }

        if (toolName === "dir.unload") {
            return "Removed directory from workspace context";
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

            switch (mode) {
                case "clear":
                    return "Cleared working notes";
                case "replace":
                    return `Replaced working notes (${totalLines} line${totalLines === 1 ? "" : "s"} total)`;
                default:
                    return `Updated working notes (${totalLines} line${totalLines === 1 ? "" : "s"} total)`;
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

        if (result.data && Object.keys(result.data).length > 0) {
            return JSON.stringify(result.data, null, 2);
        }

        return `${toolName} completed successfully`;
    }

    const message = result.error?.message || `${toolName} failed`;
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

export class ACPSession {
    readonly sessionId: string;
    readonly cwd: string;
    readonly createdAt: string;

    private readonly notify: ACPNotificationSink;
    private readonly diogenes: ReturnType<typeof createDiogenes>;
    private readonly maxIterations: number | undefined;
    private messageHistory: ConversationMessage[] = [];
    private updatedAt: string;
    private activeRun: {
        id: string;
        cancelled: boolean;
        streamedContent: string;
        emittedContentLength: number;
        nextToolCallSequence: number;
        toolCallIds: Map<string, string>;
    } | null = null;

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
        if (this.activeRun) {
            throw new Error("Session already has an active run");
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
        this.updatedAt = new Date().toISOString();

        try {
            const result = await runTaskLoop(this.diogenes, promptText, {
                maxIterations: this.maxIterations ?? Number.POSITIVE_INFINITY,
                messageHistory: this.messageHistory,
                shouldCancel: () => this.activeRun?.cancelled === true,
                onEvent: (event) => this.handleEvent(event),
            });
            this.messageHistory = result.messageHistory;
            this.updatedAt = new Date().toISOString();
            return result;
        } finally {
            this.activeRun = null;
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
            this.notify("session/update", {
                sessionId: this.sessionId,
                update: {
                    sessionUpdate: "tool_call_update",
                    toolCallId: this.getToolCallId(event.iteration, event.index),
                    status: event.result.success ? "completed" : "failed",
                    content: createToolResultContent(
                            formatToolResultFallback(event.toolCall.tool, event.result, event.toolCall.params),
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
