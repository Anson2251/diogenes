import * as path from "path";
import { createDiogenes } from "../create-diogenes";
import type { ToolResult } from "../types";
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

function createToolCallTitle(toolName: string, params: Record<string, any> | undefined): string {
    const targetPath = typeof params?.path === "string" ? params.path : undefined;

    switch (toolName) {
        case "dir.list":
            return `Listing directory${targetPath ? ` ${targetPath}` : ""}`;
        case "dir.unload":
            return `Unloading directory${targetPath ? ` ${targetPath}` : ""}`;
        case "file.load":
            return `Loading file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.peek":
            return `Peeking file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.edit":
            return `Editing file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.create":
            return `Creating file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.overwrite":
            return `Overwriting file${targetPath ? ` ${targetPath}` : ""}`;
        case "file.unload":
            return `Unloading file${targetPath ? ` ${targetPath}` : ""}`;
        case "todo.set":
            return "Updating todo list";
        case "todo.update":
            return `Updating todo item${typeof params?.text === "string" ? ` ${params.text}` : ""}`;
        case "task.ask":
            return "Requesting user input";
        case "task.choose":
            return "Requesting user choice";
        case "task.notepad":
            return "Updating notepad";
        case "task.end":
            return "Finishing task";
        case "shell.exec":
            return `Executing command${typeof params?.command === "string" ? `: ${params.command}` : ""}`;
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

function formatToolResultFallback(toolName: string, result: ToolResult): string {
    if (result.success) {
        if (toolName === "task.end" && typeof result.data?.summary === "string" && result.data.summary.length > 0) {
            return result.data.summary;
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
                        formatToolResultFallback(event.toolCall.tool, event.result),
                    ),
                    rawOutput: event.result,
                },
            });
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
                            content: createTextContent(`Context warning: ${event.warning}`),
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
