import * as fs from "fs";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { executeTask } from "../../src/index";
import { OpenAIClient } from "../../src/llm/openai-client";
import { Logger, LogLevel } from "../../src/utils/logger";

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

describe("executeTask e2e", () => {
    const testDir = path.join(__dirname, "test-e2e-workspace");

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should create a file through the full task loop and finish on the next iteration", async () => {
        fs.mkdirSync(testDir, { recursive: true });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content: `\`\`\`tool-call
[{"tool":"file.create","params":{"path":"notes/todo.txt","content":{"$heredoc":"EOF"}}}]
<<<EOF
line one
line two
EOF
\`\`\``,
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content: `\`\`\`tool-call
[{"tool":"task.end","params":{"reason":"created the requested file","summary":"Created notes/todo.txt"}}]
\`\`\``,
                reasoning: "",
            });

        const result = await executeTask(
            "Create notes/todo.txt with two lines",
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: { workspaceRoot: testDir },
            },
            {
                maxIterations: 3,
                logger: new SilentLogger(),
            },
        );

        expect(result.success).toBe(true);
        expect(result.result).toBe("Created notes/todo.txt");
        expect(fs.readFileSync(path.join(testDir, "notes", "todo.txt"), "utf-8")).toBe(
            "line one\nline two",
        );
    });
});
