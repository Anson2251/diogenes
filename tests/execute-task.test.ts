import { afterEach, describe, expect, it, vi } from "vitest";

import { createDiogenes, executeTask } from "../src/index";
import { OpenAIClient } from "../src/llm/openai-client";
import { Logger, LogLevel } from "../src/utils/logger";

class SilentLogger implements Logger {
    private level = LogLevel.SILENT;

    setLogLevel(level: LogLevel): void {
        this.level = level;
    }

    getLogLevel(): LogLevel {
        return this.level;
    }

    debug(): void {}
    info(): void {}
    warn(): void {}
    error(): void {}
    iterationStart(): void {}
    iterationComplete(): void {}
    toolCalls(): void {}
    toolResult(): void {}
    taskStarted(): void {}
    taskCompleted(): void {}
    taskError(): void {}
    interactiveMessage(): void {}
    interactivePrompt(): void {}
    streamStart(): void {}
    streamChunk(): void {}
    streamEnd(): void {}
}

describe("executeTask", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("should throw when no llm client is configured", async () => {
        await expect(
            executeTask(
                "missing llm",
                {
                    security: { workspaceRoot: process.cwd() },
                },
                {
                    logger: new SilentLogger(),
                },
            ),
        ).rejects.toThrow("LLM client not configured");
    });

    it("should execute a tool call and then complete on a later iteration", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["first note"]}}]\n```',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"completed after writing a note"}}]\n```',
                reasoning: "",
            });

        const result = await executeTask(
            "test task",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: process.cwd() },
            },
            {
                maxIterations: 3,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(true);
        expect(result.taskEnded).toBe(true);
        expect(result.result).toBe("completed after writing a note");
        expect(streamSpy).toHaveBeenCalledTimes(2);

        const secondCallMessages = streamSpy.mock.calls[1]?.[0];
        expect(secondCallMessages.at(-1)?.content).toContain("task.notepad");
        expect(secondCallMessages.at(-1)?.content).toContain("Total notepad lines: 1");
    });

    it("should insert a NEW TASK user message when continuing after completion", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"first task complete"}}]\n```',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"second task complete"}}]\n```',
                reasoning: "",
            });

        const diogenes = createDiogenes({
            llm: { apiKey: "test-key", model: "gpt-4" },
            security: { workspaceRoot: process.cwd() },
        });

        const firstResult = await executeTask("first task", undefined, {
            maxIterations: 1,
            logger: new SilentLogger(),
            diogenes,
        });

        const secondResult = await executeTask("second task", undefined, {
            maxIterations: 1,
            logger: new SilentLogger(),
            diogenes,
            messageHistory: firstResult.messageHistory,
        });

        expect(firstResult.result).toBe("first task complete");
        expect(secondResult.result).toBe("second task complete");
        expect(streamSpy).toHaveBeenCalledTimes(2);

        const secondCallMessages = streamSpy.mock.calls[1]?.[0] ?? [];
        expect(
            secondCallMessages.some((message) =>
                message.content.includes("========= TASK\nfirst task\n========="),
            ),
        ).toBe(true);
        expect(secondCallMessages.at(-1)?.content).toContain("========= NEW TASK");
        expect(secondCallMessages.at(-1)?.content).toContain("second task");
    });

    it("does not end the task when task.end validation fails", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done"}}]\n```',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"completed on retry"}}]\n```',
                reasoning: "",
            });

        const result = await executeTask(
            "test task",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: process.cwd() },
            },
            {
                maxIterations: 2,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(true);
        expect(result.taskEnded).toBe(true);
        expect(result.result).toBe("completed on retry");
        expect(streamSpy).toHaveBeenCalledTimes(2);
    });

    it("should retry after a tool-call parse error", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"broken"}}]\n',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content:
                    '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"completed after parse retry"}}]\n```',
                reasoning: "",
            });

        const result = await executeTask(
            "test parse recovery",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: process.cwd() },
            },
            {
                maxIterations: 2,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe("completed after parse retry");
        expect(streamSpy).toHaveBeenCalledTimes(2);

        const retryMessage = streamSpy.mock.calls[1]?.[0].at(-1)?.content ?? "";
        expect(retryMessage).toContain("[PARSE ERROR]");
        expect(retryMessage).toContain("Unclosed tool-call block");
    });

    it("should stop after max iterations when no tool calls are produced", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValue({
                content: "I will think more about this.",
                reasoning: "",
            });

        const result = await executeTask(
            "test no progress",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: process.cwd() },
            },
            {
                maxIterations: 2,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(false);
        expect(result.taskEnded).toBe(false);
        expect(result.error).toContain("did not complete within 2 iterations");
        expect(streamSpy).toHaveBeenCalledTimes(2);

        const secondCallMessages = streamSpy.mock.calls[1]?.[0];
        expect(secondCallMessages.at(-1)?.content).toContain("No tool calls received");
    });

    it("should surface llm client stream errors as task errors", async () => {
        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockRejectedValue(
            new Error("upstream timeout"),
        );

        const result = await executeTask(
            "test llm failure",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: process.cwd() },
            },
            {
                maxIterations: 1,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(false);
        expect(result.taskEnded).toBe(false);
        expect(result.error).toBe("upstream timeout");
    });
});
