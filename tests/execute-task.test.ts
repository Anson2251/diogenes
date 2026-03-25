import { afterEach, describe, expect, it, vi } from "vitest";
import { executeTask } from "../src/index";
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

    it("does not end the task when task.end validation fails", async () => {
        const streamSpy = vi
            .spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done"}}]\n```',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"completed on retry"}}]\n```',
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
});
