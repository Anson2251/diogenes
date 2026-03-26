import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/acp/session-manager";
import { ACPSession } from "../src/acp/session";
import { OpenAIClient } from "../src/llm/openai-client";
import { ACPServer } from "../src/acp/server";

function createSession(): ACPSession {
    return new ACPSession(
        "session-test",
        process.cwd(),
        {
            llm: { apiKey: "test-key", model: "gpt-4" },
        },
        5,
        () => {},
    );
}

describe("ACP session lifecycle", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("starts active and exposes metadata", () => {
        const session = createSession();

        expect(session.getLifecycleState()).toBe("active");
        expect(session.getMetadata()).toEqual(
            expect.objectContaining({
                sessionId: "session-test",
                cwd: process.cwd(),
                state: "active",
                hasActiveRun: false,
            }),
        );
    });

    it("moves from running back to active across a prompt", async () => {
        let release!: () => void;
        const streamStarted = new Promise<void>((resolve) => {
            release = resolve;
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(async () => {
            await streamStarted;
            return {
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"ok"}}]\n```',
                reasoning: "",
            };
        });

        const session = createSession();
        const promptPromise = session.prompt([{ type: "text", text: "finish" }]);

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(session.getLifecycleState()).toBe("running");
        expect(session.getMetadata().hasActiveRun).toBe(true);

        release();
        const result = await promptPromise;

        expect(result.stopReason).toBe("end_turn");
        expect(session.getLifecycleState()).toBe("active");
        expect(session.getMetadata().hasActiveRun).toBe(false);
    });

    it("disposes idle sessions and clears registered resources", async () => {
        const session = createSession();
        const disposeSpy = vi.fn(async () => {});

        session.registerResource({ dispose: disposeSpy });
        await session.dispose();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(session.getLifecycleState()).toBe("disposed");
        await expect(session.prompt([{ type: "text", text: "again" }])).rejects.toThrow("Session is disposed");
    });

    it("dispose during a running prompt cancels first and then cleans up", async () => {
        let aborted = false;
        const disposeSpy = vi.fn(async () => {});

        vi.spyOn(OpenAIClient.prototype, "abort").mockImplementation(() => {
            aborted = true;
        });
        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(async () => {
            while (!aborted) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            throw new Error("Request cancelled");
        });

        const session = createSession();
        session.registerResource({ dispose: disposeSpy });

        const promptPromise = session.prompt([{ type: "text", text: "long task" }]);
        await new Promise((resolve) => setTimeout(resolve, 0));

        const disposePromise = session.dispose();
        const result = await promptPromise;
        await disposePromise;

        expect(result.stopReason).toBe("cancelled");
        expect(aborted).toBe(true);
        expect(disposeSpy).toHaveBeenCalledTimes(1);
        expect(session.getLifecycleState()).toBe("disposed");
    });

    it("double dispose is safe", async () => {
        const session = createSession();
        const disposeSpy = vi.fn(async () => {});

        session.registerResource({ dispose: disposeSpy });
        await session.dispose();
        await session.dispose();

        expect(disposeSpy).toHaveBeenCalledTimes(1);
    });
});

describe("SessionManager lifecycle", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("disposeSession removes the session from the manager", async () => {
        const manager = new SessionManager({ llm: { apiKey: "test-key", model: "gpt-4" } }, 5, () => {});
        const session = manager.createSession(process.cwd());

        expect(manager.getSession(session.sessionId)).toBeDefined();
        await expect(manager.disposeSession(session.sessionId)).resolves.toBe(true);
        expect(manager.getSession(session.sessionId)).toBeUndefined();
    });

    it("disposeAllSessions cleans every session", async () => {
        const manager = new SessionManager({ llm: { apiKey: "test-key", model: "gpt-4" } }, 5, () => {});

        manager.createSession(process.cwd());
        manager.createSession(process.cwd());

        expect(manager.listSessions()).toHaveLength(2);
        await manager.disposeAllSessions();
        expect(manager.listSessions()).toHaveLength(0);
    });
});

describe("ACPServer disposal", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("disposes all sessions on server dispose", async () => {
        const server = new ACPServer({
            config: { llm: { apiKey: "test-key", model: "gpt-4" } },
        });

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });

        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });

        const sessionId = sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        await server.dispose();

        const response = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "after dispose" }],
            },
        });

        expect(response && "error" in response ? response.error.code : null).toBe(-32001);
    });
});
