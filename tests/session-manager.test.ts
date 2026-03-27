import * as fs from "fs";
import * as os from "os";
import * as path from "path";
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

    it("updates session title and description when task.end includes metadata", async () => {
        const notifications: any[] = [];
        const session = new ACPSession(
            "session-test",
            process.cwd(),
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            5,
            (method, params) => notifications.push({ method, params }),
        );

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockResolvedValue({
            content: '```tool-call\n[{"tool":"task.end","params":{"title":"Implement restore flow","description":"Adds session restore support and rehydrates snapshot state.","reason":"done","summary":"done"}}]\n```',
            reasoning: "",
        });

        await session.prompt([{ type: "text", text: "finish" }]);

        expect(session.getMetadata()).toEqual(expect.objectContaining({
            title: "Implement restore flow",
            description: "Adds session restore support and rehydrates snapshot state.",
        }));
        expect(notifications.some((item) => item.params?.update?.sessionUpdate === "session_info_update")).toBe(true);
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

    it("closeSession removes the live session from the manager without deleting persisted state", async () => {
        const manager = new SessionManager({ llm: { apiKey: "test-key", model: "gpt-4" } }, 5, () => {});
        const session = await manager.createSession(process.cwd());

        expect(manager.getSession(session.sessionId)).toBeDefined();
        await expect(manager.closeSession(session.sessionId)).resolves.toBe(true);
        expect(manager.getSession(session.sessionId)).toBeUndefined();

        const metadata = await (manager as any).sessionStore.readMetadata(session.sessionId);
        expect(metadata).not.toBeNull();
    });

    it("deleteSession removes persisted session state", async () => {
        const manager = new SessionManager({ llm: { apiKey: "test-key", model: "gpt-4" } }, 5, () => {});
        const session = await manager.createSession(process.cwd());

        await expect(manager.deleteSession(session.sessionId)).resolves.toBe(true);
        expect(manager.getSession(session.sessionId)).toBeUndefined();
        const metadata = await (manager as any).sessionStore.readMetadata(session.sessionId);
        expect(metadata).toBeNull();
    });

    it("cleans up persisted session artifacts if snapshot initialization fails", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-manager-failure-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;

        try {
            const manager = new SessionManager({
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: {
                    snapshot: {
                        enabled: true,
                        includeDiogenesState: true,
                        autoBeforePrompt: true,
                        storageRoot: path.join(root, "bad-storage"),
                        resticBinary: path.join(root, "missing-restic"),
                        resticBinaryArgs: [],
                        timeoutMs: 100,
                    },
                },
            }, 5, () => {});

            await expect(manager.createSession(process.cwd())).rejects.toThrow();
            const sessionsDir = path.join(root, "Library", "Application Support", "diogenes", "sessions");
            expect(fs.existsSync(sessionsDir) ? fs.readdirSync(sessionsDir) : []).toEqual([]);
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("disposeAllSessions cleans every session", async () => {
        const manager = new SessionManager({ llm: { apiKey: "test-key", model: "gpt-4" } }, 5, () => {});

        await manager.createSession(process.cwd());
        await manager.createSession(process.cwd());

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

    it("lists and closes live sessions through ACP management methods", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-manager-acp-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;

        try {
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

        const listResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/list",
            params: {},
        });
        const getResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 4,
            method: "_diogenes/session/get",
            params: { sessionId },
        });
        const disposeResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 5,
            method: "_diogenes/session/dispose",
            params: { sessionId },
        });

        expect(listResponse && "result" in listResponse ? listResponse.result.sessions : []).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    sessionId,
                    cwd: process.cwd(),
                    _meta: expect.objectContaining({
                        diogenes: expect.objectContaining({
                            snapshotEnabled: false,
                            liveSession: true,
                        }),
                    }),
                }),
            ]),
        );
        expect(getResponse && "result" in getResponse ? getResponse.result : null).toEqual(
            expect.objectContaining({
                session: expect.objectContaining({
                    sessionId,
                    cwd: process.cwd(),
                    _meta: expect.objectContaining({
                        diogenes: expect.objectContaining({
                            liveSession: true,
                            snapshotEnabled: false,
                            availableCommands: [],
                        }),
                    }),
                }),
            }),
        );
        expect(disposeResponse && "result" in disposeResponse ? disposeResponse.result : null).toEqual({
            disposed: true,
            sessionId,
        });
        expect(fs.existsSync(path.join(root, "Library", "Application Support", "diogenes", "sessions", sessionId, "metadata.json"))).toBe(true);
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("deletes persisted sessions through ACP management methods", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-manager-acp-delete-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;

        try {
            const server = new ACPServer({
                config: { llm: { apiKey: "test-key", model: "gpt-4" } },
            });

            await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
            const sessionNew = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } });
            const sessionId = sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            const response = await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "_diogenes/session/delete",
                params: { sessionId },
            });

            expect(response && "result" in response ? response.result : null).toEqual({ deleted: true, sessionId });
            expect(fs.existsSync(path.join(root, "Library", "Application Support", "diogenes", "sessions", sessionId))).toBe(false);
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
