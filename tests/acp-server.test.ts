import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACPServer } from "../src/acp/server";
import { startACPServer } from "../src/acp/stdio-transport";
import { OpenAIClient } from "../src/llm/openai-client";

function createStreamingResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();

    return new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
            },
        },
    );
}

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 200): Promise<T> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const value = getValue();
        if (value !== undefined) {
            return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error("Timed out waiting for value");
}

describe("ACPServer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("handles initialize and session/new", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
        });

        const initialize = await server.handleMessage({
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

        expect(initialize && "result" in initialize && initialize.result.protocolVersion).toBe(1);
        expect(sessionNew && "result" in sessionNew && sessionNew.result.sessionId).toBeTypeOf("string");
        expect(sessionNew && "result" in sessionNew ? sessionNew.result : null).toEqual({
            sessionId: expect.any(String),
        });
        expect(notifications).toHaveLength(0);
    });

    it("advertises ACP session management capabilities", async () => {
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
        });

        const initialize = await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });

        expect(initialize && "result" in initialize ? initialize.result.agentCapabilities.sessionCapabilities : null).toEqual(
            expect.objectContaining({
                list: {},
                _meta: expect.objectContaining({
                    diogenes: expect.objectContaining({
                        getSession: true,
                        disposeSession: true,
                        deleteSession: true,
                        listSnapshots: true,
                        restoreSnapshot: true,
                    }),
                }),
            }),
        );
    });

    it("returns only sessionId in session/new when snapshot commands are enabled", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-session-new-commands-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;
        process.env.FAKE_RESTIC_LOG = path.join(root, "restic.log");

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                    security: {
                        snapshot: {
                            enabled: true,
                            includeDiogenesState: false,
                            autoBeforePrompt: true,
                            storageRoot: path.join(root, "Library", "Application Support", "diogenes", "sessions"),
                            resticBinary: process.execPath,
                            resticBinaryArgs: [path.join(process.cwd(), "tests/fixtures/fake-restic.cjs")],
                            timeoutMs: 5_000,
                        },
                    },
                },
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

            expect(sessionNew && "result" in sessionNew ? sessionNew.result : null).toEqual({
                sessionId: expect.any(String),
            });
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("loads a stored session by replaying persisted session history", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-session-load-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;

        try {
            const firstServer = new ACPServer({
                config: { llm: { apiKey: "test-key", model: "gpt-4" } },
            });

            await firstServer.handleMessage({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: 1 },
            });

            const created = await firstServer.handleMessage({
                jsonrpc: "2.0",
                id: 2,
                method: "session/new",
                params: { cwd: process.cwd() },
            });
            const sessionId = created && "result" in created ? created.result.sessionId as string : "";

            const session = (firstServer as any).sessionManager.getSession(sessionId);
            await session.restorePersistedState({
                version: 1,
                kind: "diogenes_state",
                sessionId,
                cwd: process.cwd(),
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                messageHistory: [
                    { role: "user", content: "hello" },
                    { role: "assistant", content: "world" },
                ],
                workspace: {
                    loadedDirectories: [],
                    loadedFiles: [],
                    todo: [],
                    notepad: [],
                },
            });

            const notifications: Array<{ method: string; params: any }> = [];
            const secondServer = new ACPServer({
                config: { llm: { apiKey: "test-key", model: "gpt-4" } },
                notify: (method, params) => notifications.push({ method, params }),
            });

            await secondServer.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "initialize",
                params: { protocolVersion: 1 },
            });

            const loaded = await secondServer.handleMessage({
                jsonrpc: "2.0",
                id: 4,
                method: "session/load",
                params: { sessionId, cwd: process.cwd(), mcpServers: [] },
            });

            expect(loaded && "result" in loaded ? loaded.result : null).toBeNull();
            expect(notifications).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    method: "session/update",
                    params: expect.objectContaining({
                        sessionId,
                        update: expect.objectContaining({
                            sessionUpdate: "user_message_chunk",
                            content: { type: "text", text: "hello" },
                        }),
                    }),
                }),
                expect.objectContaining({
                    method: "session/update",
                    params: expect.objectContaining({
                        sessionId,
                        update: expect.objectContaining({
                            sessionUpdate: "agent_message_chunk",
                            content: { type: "text", text: "world" },
                        }),
                    }),
                }),
                expect.objectContaining({
                    method: "session/update",
                    params: expect.objectContaining({
                        sessionId,
                        update: expect.objectContaining({
                            sessionUpdate: "session_info_update",
                            _meta: expect.objectContaining({
                                diogenes: expect.objectContaining({
                                    hydratedState: expect.objectContaining({
                                        loadedDirectories: [],
                                        loadedFiles: [],
                                        notepad: [],
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
                expect.objectContaining({
                    method: "session/update",
                    params: expect.objectContaining({
                        sessionId,
                        update: expect.objectContaining({
                            sessionUpdate: "plan",
                            entries: [],
                        }),
                    }),
                }),
            ]));
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("lists active sessions and exposes snapshots through ACP management methods", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-session-management-"));
        const originalHome = process.env.HOME;
        process.env.HOME = root;
        process.env.FAKE_RESTIC_LOG = path.join(root, "restic.log");

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                    security: {
                        snapshot: {
                            enabled: true,
                            includeDiogenesState: false,
                            autoBeforePrompt: true,
                            storageRoot: path.join(root, "Library", "Application Support", "diogenes", "sessions"),
                            resticBinary: process.execPath,
                            resticBinaryArgs: [path.join(process.cwd(), "tests/fixtures/fake-restic.cjs")],
                            timeoutMs: 5_000,
                        },
                    },
                },
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

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "/snapshot manual test" }],
                },
            });

            const listResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 4,
                method: "session/list",
                params: { includeSnapshots: true },
            });
            const getResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 5,
                method: "_diogenes/session/get",
                params: { sessionId, includeSnapshots: true },
            });
            const snapshotsResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 6,
                method: "_diogenes/session/snapshots",
                params: { sessionId },
            });

            expect(listResponse && "result" in listResponse ? listResponse.result.sessions : []).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        sessionId,
                        cwd: process.cwd(),
                        title: null,
                        _meta: expect.objectContaining({
                            diogenes: expect.objectContaining({
                                snapshotEnabled: true,
                                snapshotCount: 2,
                                availableCommands: [
                                    {
                                        name: "snapshot",
                                        description: "Create a defensive session snapshot",
                                        input: { hint: "optional label for the snapshot" },
                                    },
                                ],
                            }),
                        }),
                    }),
                ]),
            );
            expect(getResponse && "result" in getResponse ? getResponse.result : null).toEqual(
                expect.objectContaining({
                    session: expect.objectContaining({
                        sessionId,
                        _meta: expect.objectContaining({
                            diogenes: expect.objectContaining({
                                liveSession: true,
                                snapshotEnabled: true,
                                availableCommands: [
                                    {
                                        name: "snapshot",
                                        description: "Create a defensive session snapshot",
                                        input: { hint: "optional label for the snapshot" },
                                    },
                                ],
                            }),
                        }),
                    }),
                    snapshots: expect.arrayContaining([
                        expect.objectContaining({ label: "manual test", trigger: "system_manual" }),
                    ]),
                }),
            );
            expect(snapshotsResponse && "result" in snapshotsResponse ? snapshotsResponse.result : null).toEqual({
                sessionId,
                liveSession: true,
                snapshots: expect.arrayContaining([
                    expect.objectContaining({ label: "manual test", trigger: "system_manual" }),
                ]),
            });
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("manages stored sessions through ACP methods even when no live session exists", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-stored-session-management-"));
        const originalHome = process.env.HOME;
        const sessionId = "stored-session-1";
        const sessionsRoot = path.join(root, "Library", "Application Support", "diogenes", "sessions");
        const sessionDir = path.join(sessionsRoot, sessionId);

        process.env.HOME = root;

        try {
            fs.mkdirSync(sessionDir, { recursive: true });
            fs.writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify({
                sessionId,
                cwd: "/tmp/workspace",
                createdAt: "2026-03-27T00:00:00.000Z",
                updatedAt: "2026-03-27T00:00:01.000Z",
                title: "Stored session",
                description: "Persisted between ACP server runs",
                state: "active",
                hasActiveRun: false,
                availableCommands: [
                    {
                        name: "snapshot",
                        description: "Create a defensive session snapshot",
                        input: { hint: "optional label for the snapshot" },
                    },
                ],
                snapshotEnabled: true,
            }, null, 2));
            fs.mkdirSync(path.join(sessionDir, "snapshots"), { recursive: true });
            fs.writeFileSync(path.join(sessionDir, "snapshots", "manifest.json"), JSON.stringify({
                sessionId,
                cwd: "/tmp/workspace",
                createdAt: "2026-03-27T00:00:00.000Z",
                snapshots: [
                    {
                        snapshotId: "snapshot-stored-1",
                        createdAt: "2026-03-27T00:00:02.000Z",
                        trigger: "system_manual",
                        turn: 1,
                        label: "stored snapshot",
                        resticSnapshotId: "restic-stored-1",
                    },
                ],
            }, null, 2));

            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
            });

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: { protocolVersion: 1 },
            });

            const listResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 2,
                method: "session/list",
                params: { includeSnapshots: true },
            });
            const getResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "_diogenes/session/get",
                params: { sessionId, includeSnapshots: true },
            });
            const snapshotsResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 4,
                method: "_diogenes/session/snapshots",
                params: { sessionId },
            });
            const disposeResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 5,
                method: "_diogenes/session/dispose",
                params: { sessionId },
            });
            const deleteResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 6,
                method: "_diogenes/session/delete",
                params: { sessionId },
            });

            expect(listResponse && "result" in listResponse ? listResponse.result.sessions : []).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        sessionId,
                        _meta: expect.objectContaining({
                            diogenes: expect.objectContaining({
                                snapshotEnabled: true,
                                snapshotCount: 1,
                                description: "Persisted between ACP server runs",
                                liveSession: false,
                            }),
                        }),
                    }),
                ]),
            );
            expect(getResponse && "result" in getResponse ? getResponse.result : null).toEqual(
                expect.objectContaining({
                    session: expect.objectContaining({
                        sessionId,
                        title: "Stored session",
                        _meta: expect.objectContaining({
                            diogenes: expect.objectContaining({
                                liveSession: false,
                            }),
                        }),
                    }),
                    snapshots: expect.arrayContaining([
                        expect.objectContaining({ snapshotId: "snapshot-stored-1", label: "stored snapshot" }),
                    ]),
                }),
            );
            expect(snapshotsResponse && "result" in snapshotsResponse ? snapshotsResponse.result : null).toEqual({
                sessionId,
                liveSession: false,
                snapshots: [
                    expect.objectContaining({ snapshotId: "snapshot-stored-1", label: "stored snapshot" }),
                ],
            });
            expect(disposeResponse && "error" in disposeResponse ? disposeResponse.error.code : null).toBe(-32001);
            expect(deleteResponse && "result" in deleteResponse ? deleteResponse.result : null).toEqual({
                deleted: true,
                sessionId,
            });
            expect(fs.existsSync(sessionDir)).toBe(false);
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("paginates session/list results with cursor", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-session-pagination-"));
        const originalHome = process.env.HOME;
        const sessionsDir = path.join(root, "Library", "Application Support", "diogenes", "sessions");
        process.env.HOME = root;

        try {
            fs.mkdirSync(sessionsDir, { recursive: true });
            for (let i = 0; i < 21; i++) {
                const sessionId = `session-${String(i).padStart(2, "0")}`;
                const sessionDir = path.join(sessionsDir, sessionId);
                fs.mkdirSync(sessionDir, { recursive: true });
                fs.writeFileSync(path.join(sessionDir, "metadata.json"), JSON.stringify({
                    sessionId,
                    cwd: "/tmp/workspace",
                    createdAt: `2026-03-27T00:00:${String(i).padStart(2, "0")}.000Z`,
                    updatedAt: `2026-03-27T00:00:${String(59 - i).padStart(2, "0")}.000Z`,
                    title: `Session ${i}`,
                    description: null,
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: false,
                }, null, 2));
                fs.writeFileSync(path.join(sessionDir, "state.json"), JSON.stringify({
                    version: 1,
                    kind: "diogenes_state",
                    sessionId,
                    cwd: "/tmp/workspace",
                    createdAt: `2026-03-27T00:00:${String(i).padStart(2, "0")}.000Z`,
                    updatedAt: `2026-03-27T00:00:${String(59 - i).padStart(2, "0")}.000Z`,
                    metadata: { title: `Session ${i}`, description: null },
                    messageHistory: [],
                    workspace: { loadedDirectories: [], loadedFiles: [], todo: [], notepad: [] },
                }, null, 2));
            }

            const server = new ACPServer({ config: { llm: { apiKey: "test-key", model: "gpt-4" } } });
            await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });

            const firstPage = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "session/list", params: { pageSize: 5 } });
            const nextCursor = firstPage && "result" in firstPage ? firstPage.result.nextCursor as string | null : null;
            const secondPage = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "session/list", params: { cursor: nextCursor, pageSize: 5 } });

            expect(firstPage && "result" in firstPage ? firstPage.result.sessions : []).toHaveLength(5);
            expect(nextCursor).toEqual(expect.any(String));
            expect(firstPage && "result" in firstPage ? firstPage.result._meta?.diogenes : null).toEqual({
                pageSize: 5,
                supportsCursorPagination: true,
            });
            expect(secondPage && "result" in secondPage ? secondPage.result.sessions : []).toHaveLength(5);
            expect(secondPage && "result" in secondPage ? secondPage.result.nextCursor : null).toEqual(expect.any(String));
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("prunes broken persisted sessions through ACP", async () => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-session-prune-"));
            const originalHome = process.env.HOME;
            const sessionsDir = path.join(root, "Library", "Application Support", "diogenes", "sessions");
            process.env.HOME = root;

        try {
            fs.mkdirSync(path.join(sessionsDir, "broken-session"), { recursive: true });
            fs.writeFileSync(path.join(sessionsDir, "broken-session", "metadata.json"), JSON.stringify({ sessionId: "broken-session" }, null, 2));
            fs.mkdirSync(path.join(sessionsDir, "snapshot-only", "snapshots"), { recursive: true });
            fs.writeFileSync(path.join(sessionsDir, "snapshot-only", "snapshots", "manifest.json"), JSON.stringify({
                sessionId: "snapshot-only",
                cwd: "/tmp/workspace",
                createdAt: "2026-03-27T00:00:00.000Z",
                snapshots: [],
            }, null, 2));

            const server = new ACPServer({ config: { llm: { apiKey: "test-key", model: "gpt-4" } } });
            await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });

            const dryRun = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "_diogenes/session/prune", params: { dryRun: true } });
            const applied = await server.handleMessage({ jsonrpc: "2.0", id: 3, method: "_diogenes/session/prune", params: {} });

            expect(dryRun && "result" in dryRun ? dryRun.result : null).toEqual(expect.objectContaining({
                dryRun: true,
                deletedSessionIds: ["broken-session", "snapshot-only"],
                reasonsBySessionId: {
                    "broken-session": "missing_state",
                    "snapshot-only": "orphaned_snapshot_artifacts",
                },
            }));
            expect(applied && "result" in applied ? applied.result : null).toEqual(expect.objectContaining({
                dryRun: false,
                deletedSessionIds: ["broken-session", "snapshot-only"],
            }));
            expect(fs.existsSync(path.join(sessionsDir, "broken-session"))).toBe(false);
            expect(fs.existsSync(path.join(sessionsDir, "snapshot-only"))).toBe(false);
        } finally {
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("streams session updates during prompt execution", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async (_messages, onChunk) => {
                onChunk({ type: "reasoning", content: "**" });
                onChunk({ type: "content", content: "Running tools...\n" });
                onChunk({ type: "content", content: "```to" });
                onChunk({ type: "content", content: 'ol-call\n[{"tool":"task.end","params":{"reason":"done","summary":"Finished via ACP"}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"Finished via ACP"}}]\n```',
                    reasoning: "",
                };
            },
        );

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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Finish the task" }],
            },
        });

        const finalResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );

        expect(promptResponse).toBeNull();
        expect(finalResponse && "result" in finalResponse && finalResponse.result.stopReason).toBe("end_turn");
        expect(notifications.some((item) => item.method === "session/update")).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call"
                    && item.params.update.title === "Calling the task done"
                    && item.params.update.kind === "other",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.status === "completed",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.status === "completed"
                    && Array.isArray(item.params.update.content)
                    && item.params.update.content[0]?.content?.text === "Finished via ACP",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.rawOutput?.success === true,
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "**",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "Running tools...\n",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "Finished via ACP",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && typeof item.params.update.content.text === "string"
                    && item.params.update.content.text.includes("```tool-call"),
            ),
        ).toBe(false);
    });

    it("uses unique toolCallIds across iterations within the same prompt run", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({ type: "content", content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["round one"]}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["round one"]}}]\n```',
                    reasoning: "",
                };
            })
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({ type: "content", content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"round two"}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"round two"}}]\n```',
                    reasoning: "",
                };
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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Take two tool-call rounds" }],
            },
        });

        const finalResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );
        const toolCallIds = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call")
            .map((item) => item.params.update.toolCallId);

        expect(promptResponse).toBeNull();
        expect(finalResponse?.result?.stopReason).toBe("end_turn");
        expect(toolCallIds).toHaveLength(2);
        expect(new Set(toolCallIds).size).toBe(2);
        expect(toolCallIds[0]).not.toBe(toolCallIds[1]);
        expect(
            notifications.some(
                (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                    && item.params.update.status === "completed"
                    && Array.isArray(item.params.update.content)
                    && item.params.update.content[0]?.content?.text === [
                        "Updated working notes (1 line total)",
                        "",
                        "round one",
                    ].join("\n"),
            ),
        ).toBe(true);
    });

    it("inserts a NEW TASK user message on later prompts in the same session", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const streamSpy = vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockResolvedValueOnce({
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"first prompt done"}}]\n```',
                reasoning: "",
            })
            .mockResolvedValueOnce({
                content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"second prompt done"}}]\n```',
                reasoning: "",
            });

        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "first prompt" }],
            },
        });
        await waitFor(() => responses.find((response) => response.id === 3));

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 4,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "second prompt" }],
            },
        });
        await waitFor(() => responses.find((response) => response.id === 4));

        const secondPromptMessages = streamSpy.mock.calls[1]?.[0] ?? [];
        expect(secondPromptMessages.some((message) => message.content.includes("========= TASK\nfirst prompt\n========="))).toBe(true);
        expect(secondPromptMessages.at(-1)?.content).toContain("========= NEW TASK");
        expect(secondPromptMessages.at(-1)?.content).toContain("second prompt");
    });

    it("uses unique toolCallIds for multiple tool calls in the same iteration", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async (_messages, onChunk) => {
                onChunk({
                    type: "content",
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["one"]}},{"tool":"task.end","params":{"reason":"done","summary":"two"}}]\n```',
                });
                return {
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["one"]}},{"tool":"task.end","params":{"reason":"done","summary":"two"}}]\n```',
                    reasoning: "",
                };
            },
        );

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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Emit two tool calls in one turn" }],
            },
        });
        await waitFor(() => responses.find((response) => response.id === 3));

        const toolCallIds = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call")
            .map((item) => item.params.update.toolCallId);

        expect(toolCallIds).toHaveLength(2);
        expect(new Set(toolCallIds).size).toBe(2);
        expect(toolCallIds[0]).not.toBe(toolCallIds[1]);
    });

    it("emits complete plan updates for todo tools", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({
                    type: "content",
                    content: '```tool-call\n[{"tool":"todo.set","params":{"items":[{"text":"Inspect repo","state":"active"},{"text":"Write tests","state":"pending"}]}}]\n```',
                });
                return {
                    content: '```tool-call\n[{"tool":"todo.set","params":{"items":[{"text":"Inspect repo","state":"active"},{"text":"Write tests","state":"pending"}]}}]\n```',
                    reasoning: "",
                };
            })
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({
                    type: "content",
                    content: '```tool-call\n[{"tool":"todo.update","params":{"text":"Inspect repo","state":"done"}},{"tool":"todo.update","params":{"text":"Write tests","state":"active"}},{"tool":"task.end","params":{"reason":"done","summary":"planned"}}]\n```',
                });
                return {
                    content: '```tool-call\n[{"tool":"todo.update","params":{"text":"Inspect repo","state":"done"}},{"tool":"todo.update","params":{"text":"Write tests","state":"active"}},{"tool":"task.end","params":{"reason":"done","summary":"planned"}}]\n```',
                    reasoning: "",
                };
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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Plan and finish" }],
            },
        });
        await waitFor(() => responses.find((response) => response.id === 3));

        const planUpdates = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "plan")
            .map((item) => item.params.update.entries);
        const todoToolCalls = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call")
            .map((item) => item.params.update);
        const todoToolUpdates = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call_update")
            .map((item) => item.params.update);

        expect(planUpdates).toHaveLength(3);
        expect(todoToolCalls).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ title: "Sketching the plan", kind: "think" }),
                expect.objectContaining({ title: "Advancing plan item Inspect repo", kind: "think" }),
                expect.objectContaining({ title: "Advancing plan item Write tests", kind: "think" }),
            ]),
        );
        expect(todoToolUpdates).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    status: "completed",
                    content: [
                        {
                            type: "content",
                            content: { type: "text", text: "Updated plan with 2 items" },
                        },
                    ],
                }),
                expect.objectContaining({
                    status: "completed",
                    content: [
                        {
                            type: "content",
                            content: { type: "text", text: 'Marked "Inspect repo" as done' },
                        },
                    ],
                }),
                expect.objectContaining({
                    status: "completed",
                    content: [
                        {
                            type: "content",
                            content: { type: "text", text: 'Marked "Write tests" as active' },
                        },
                    ],
                }),
            ]),
        );
        expect(planUpdates[0]).toEqual([
            { content: "Inspect repo", priority: "high", status: "in_progress" },
            { content: "Write tests", priority: "medium", status: "pending" },
        ]);
        expect(planUpdates[1]).toEqual([
            { content: "Inspect repo", priority: "low", status: "completed" },
            { content: "Write tests", priority: "medium", status: "pending" },
        ]);
        expect(planUpdates[2]).toEqual([
            { content: "Inspect repo", priority: "low", status: "completed" },
            { content: "Write tests", priority: "high", status: "in_progress" },
        ]);
    });

    it("formats file.edit updates as human-readable summaries", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-file-edit-"));
        const filePath = path.join(workspaceDir, "sample.ts");

        fs.writeFileSync(
            filePath,
            [
                "const greeting = 'hello';",
                "console.log(greeting);",
            ].join("\n"),
            "utf-8",
        );

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const fileEditToolCall = `\`\`\`tool-call
[{"tool":"file.edit","params":{"path":"sample.ts","edits":[{"mode":"replace","anchor":{"start":{"line":1,"text":"const greeting = 'hello';"}},"content":["const greeting = 'hello there';"]}]}},{"tool":"task.end","params":{"reason":"done","summary":"edited file"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({
                        type: "content",
                        content: fileEditToolCall,
                    });
                    return {
                        content: fileEditToolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Update the greeting" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content[0]?.content?.text === [
                            "Updated sample.ts: 1 edit applied, 2 total lines",
                            "replace lines 1-1 -> 1-1",
                        ].join("\n"),
                ),
            ).toBe(true);
            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content.some(
                            (content: any) =>
                                content.type === "diff"
                                && content.path === filePath
                                && content.oldText === [
                                    "const greeting = 'hello';",
                                    "console.log(greeting);",
                                ].join("\n")
                                && content.newText === [
                                    "const greeting = 'hello there';",
                                    "console.log(greeting);",
                                ].join("\n"),
                        ),
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("formats file.edit failures as human-readable ACP content", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-file-edit-fail-"));
        const filePath = path.join(workspaceDir, "sample.ts");

        fs.writeFileSync(
            filePath,
            [
                "const greeting = 'hello';",
                "console.log(greeting);",
            ].join("\n"),
            "utf-8",
        );

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const fileEditToolCall = `\`\`\`tool-call
[{"tool":"file.edit","params":{"path":"sample.ts","edits":[{"mode":"replace","anchor":{"start":{"line":1,"text":"const missing = 'hello';","before":[],"after":[]}},"content":["const greeting = 'hello there';"]}]}},{"tool":"task.end","params":{"reason":"done","summary":"attempted edit"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({
                        type: "content",
                        content: fileEditToolCall,
                    });
                    return {
                        content: fileEditToolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Update the greeting" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "failed"
                        && Array.isArray(item.params.update.content)
                        && typeof item.params.update.content[0]?.content?.text === "string"
                        && item.params.update.content[0].content.text.includes("[FAIL] file.edit")
                        && item.params.update.content[0].content.text.includes("Could not apply edits to sample.ts")
                        && item.params.update.content[0].content.text.includes("Closest match:")
                        && !item.params.update.content[0].content.text.includes("failedEdits"),
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("returns overwrite diffs in ACP updates for file.overwrite", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-file-overwrite-"));
        const filePath = path.join(workspaceDir, "notes.txt");

        fs.writeFileSync(
            filePath,
            ["old line 1", "old line 2"].join("\n"),
            "utf-8",
        );

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const fileOverwriteToolCall = `\`\`\`tool-call
[{"tool":"file.overwrite","params":{"path":"notes.txt","content":["new line 1","new line 2","new line 3"]}},{"tool":"task.end","params":{"reason":"done","summary":"overwrote file"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({
                        type: "content",
                        content: fileOverwriteToolCall,
                    });
                    return {
                        content: fileOverwriteToolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Overwrite the file" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content.some(
                            (content: any) =>
                                content.type === "diff"
                                && content.path === filePath
                                && content.oldText === "old line 1\nold line 2"
                                && content.newText === "new line 1\nnew line 2\nnew line 3",
                        ),
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("returns created file content in ACP updates for file.create", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-file-create-"));
        const createdPath = path.join(workspaceDir, "notes.txt");

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const fileCreateToolCall = `\`\`\`tool-call
[{"tool":"file.create","params":{"path":"notes.txt","content":["line 1","line 2"]}},{"tool":"task.end","params":{"reason":"done","summary":"created file"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({
                        type: "content",
                        content: fileCreateToolCall,
                    });
                    return {
                        content: fileCreateToolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Create a file" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content.some(
                            (content: any) =>
                                content.type === "diff"
                                && content.path === createdPath
                                && content.oldText === null
                                && content.newText === "line 1\nline 2",
                        ),
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("formats file.peek updates as human-readable ACP content", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-file-peek-"));
        const filePath = path.join(workspaceDir, "peek.txt");

        fs.writeFileSync(
            filePath,
            ["line 1", "line 2", "line 3"].join("\n"),
            "utf-8",
        );

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const toolCall = `\`\`\`tool-call
[{"tool":"file.peek","params":{"path":"peek.txt","start":2,"end":3}},{"tool":"task.end","params":{"reason":"done","summary":"peeked file"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({ type: "content", content: toolCall });
                    return {
                        content: toolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Peek the file" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content[0]?.content?.text === [
                            "Peeked peek.txt",
                            "Lines 2-3 of 3",
                            "",
                            "```",
                            "2 | line 2",
                            "3 | line 3",
                            "```",
                            "",
                            "Peeked content not loaded into workspace. Use file.load to load for editing.",
                        ].join("\n"),
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("includes relative paths in ACP updates for unload tools", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "acp-unload-"));
        const filePath = path.join(workspaceDir, "sample.ts");

        fs.writeFileSync(filePath, "const greeting = 'hello';\n", "utf-8");

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                },
                notify: (method, params) => notifications.push({ method, params }),
                respond: (response) => responses.push(response),
            });
            const toolCall = `\`\`\`tool-call
[{"tool":"file.load","params":{"path":"sample.ts"}},{"tool":"dir.list","params":{"path":"."}},{"tool":"file.unload","params":{"path":"sample.ts"}},{"tool":"dir.unload","params":{"path":"."}},{"tool":"task.end","params":{"reason":"done","summary":"unloaded"}}]
\`\`\``;

            vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
                async (_messages, onChunk) => {
                    onChunk({ type: "content", content: toolCall });
                    return {
                        content: toolCall,
                        reasoning: "",
                    };
                },
            );

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
                params: { cwd: workspaceDir },
            });
            const sessionId =
                sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "Load and unload context" }],
                },
            });
            await waitFor(() => responses.find((response) => response.id === 3));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content[0]?.content?.text === "Removed sample.ts from workspace context",
                ),
            ).toBe(true);
            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "tool_call_update"
                        && item.params.update.status === "completed"
                        && Array.isArray(item.params.update.content)
                        && item.params.update.content[0]?.content?.text === "Removed . from workspace context",
                ),
            ).toBe(true);
        } finally {
            fs.rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it("sends a final reply over stdio with a mocked OpenAI stream", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const error = new PassThrough();
        const lines: string[] = [];
        const errors: string[] = [];

        output.setEncoding("utf-8");
        output.on("data", (chunk: string) => {
            lines.push(
                ...chunk
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
            );
        });
        error.setEncoding("utf-8");
        error.on("data", (chunk: string) => {
            errors.push(chunk);
        });

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            createStreamingResponse([
                "data: {\"id\":\"cmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Working...\\n\"},\"finish_reason\":null}]}\n\n",
                "data: {\"id\":\"cmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"```tool-call\\n[{\\\"tool\\\":\\\"task.end\\\",\\\"params\\\":{\\\"reason\\\":\\\"done\\\",\\\"summary\\\":\\\"Mock reply delivered\\\"}}]\\n```\"},\"finish_reason\":null}]}\n\n",
                "data: [DONE]\n\n",
            ]),
        );

        startACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4", baseURL: "https://mock-openai.test/v1" },
            },
            input: input as NodeJS.ReadStream,
            output: output as NodeJS.WriteStream,
            error: error as NodeJS.WriteStream,
        });

        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n`);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } })}\n`);
        const sessionNewResponse = await waitFor(() => lines
            .map((line) => JSON.parse(line))
            .find((message) => message.id === 2), 500);
        const sessionId = sessionNewResponse?.result?.sessionId as string;

        input.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Finish the task" }],
            },
        })}\n`);
        await waitFor(() => {
            const messages = lines.map((line) => JSON.parse(line));
            const promptResponse = messages.find((message) => message.id === 3);
            const finalReply = messages.find(
                (message) => message.method === "session/update"
                    && message.params?.update?.sessionUpdate === "agent_message_chunk"
                    && message.params?.update?.content?.text === "Mock reply delivered",
            );
            return promptResponse && finalReply ? true : undefined;
        }, 2000);

        const messages = lines.map((line) => JSON.parse(line));
        const promptResponse = messages.find((message) => message.id === 3);
        const finalReply = messages.find(
            (message) => message.method === "session/update"
                && message.params?.update?.sessionUpdate === "agent_message_chunk"
                && message.params?.update?.content?.text === "Mock reply delivered",
        );
        const toolCallChunk = messages.find(
            (message) => message.method === "session/update"
                && message.params?.update?.sessionUpdate === "agent_message_chunk"
                && typeof message.params?.update?.content?.text === "string"
                && message.params.update.content.text.includes("```tool-call"),
        );

        expect(errors).toEqual([]);
        expect(promptResponse?.result?.stopReason).toBe("end_turn");
        expect(finalReply).toBeDefined();
        expect(toolCallChunk).toBeUndefined();
    });

    it("advertises available slash commands after session/new returns", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-slash-order-"));
        const originalHome = process.env.HOME;
        const fixturePath = path.join(process.cwd(), "tests/fixtures/fake-restic.cjs");
        const notifications: Array<{ method: string; params: any }> = [];

        process.env.FAKE_RESTIC_LOG = path.join(root, "restic.log");
        process.env.HOME = root;

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                    security: {
                        snapshot: {
                            enabled: true,
                            includeDiogenesState: false,
                            autoBeforePrompt: true,
                            storageRoot: path.join(root, "Library", "Application Support", "diogenes", "sessions"),
                            resticBinary: process.execPath,
                            resticBinaryArgs: [fixturePath],
                            timeoutMs: 5_000,
                        },
                    },
                },
                notify: (method, params) => notifications.push({ method, params }),
            });

            await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
            const sessionNew = await server.handleMessage({
                jsonrpc: "2.0",
                id: 2,
                method: "session/new",
                params: { cwd: process.cwd() },
            });

            expect(sessionNew && "result" in sessionNew ? sessionNew.result.sessionId : null).toBeTypeOf("string");
            expect(notifications).toEqual([]);

            await waitFor(() => notifications.find(
                (item) => item.params?.update?.sessionUpdate === "available_commands_update",
            ));
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            process.env.HOME = originalHome;
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("supports cancellation for an active prompt turn", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        let cancelled = false;
        vi.spyOn(OpenAIClient.prototype, "abort").mockImplementation(function () {
            cancelled = true;
        });
        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async () => {
                while (!cancelled) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                throw new Error("Request cancelled");
            },
        );

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
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptStartResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Start a long-running task" }],
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        const cancelResponse = await server.handleMessage({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId },
        });
        const promptResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );

        expect(promptStartResponse).toBeNull();
        expect(cancelResponse).toBeNull();
        expect(promptResponse && "result" in promptResponse && promptResponse.result.stopReason).toBe("cancelled");
        expect(cancelled).toBe(true);
        expect(notifications).toEqual([]);
    });

    it("restores a snapshot through the host-controlled ACP method", async () => {
        const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "acp-restore-"));
        const workspaceDir = path.join(root, "workspace");
        const storageRoot = path.join(root, "Library", "Application Support", "diogenes", "sessions");
        const fixturePath = path.join(process.cwd(), "tests/fixtures/fake-restic.cjs");
        const logPath = path.join(root, "restic.log");
        const notifications: any[] = [];

        await fs.promises.mkdir(workspaceDir, { recursive: true });
        await fs.promises.writeFile(path.join(workspaceDir, "hello.txt"), "hello\n", "utf8");

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockResolvedValue({
            content: '```tool-call\n[{"tool":"task.end","params":{"title":"Initial snapshot","description":"Creates the baseline snapshot.","reason":"done","summary":"done"}}]\n```',
            reasoning: "",
        });

        process.env.FAKE_RESTIC_LOG = logPath;
        process.env.FAKE_RESTIC_RESTORE_ROOTNAME = path.basename(workspaceDir);
        process.env.FAKE_RESTIC_RESTORE_HELLO = "restored via acp\n";
        const originalHome = process.env.HOME;
        process.env.HOME = root;

        try {
            const server = new ACPServer({
                config: {
                    llm: { apiKey: "test-key", model: "gpt-4" },
                    security: {
                        snapshot: {
                            enabled: true,
                            includeDiogenesState: true,
                            autoBeforePrompt: true,
                            storageRoot,
                            resticBinary: process.execPath,
                            resticBinaryArgs: [fixturePath],
                            timeoutMs: 5_000,
                        },
                    },
                },
                notify: (method, params) => notifications.push({ method, params }),
            });

            await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } });
            const sessionNew = await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: workspaceDir } });
            const sessionId = sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: { sessionId, prompt: [{ type: "text", text: "take baseline" }] },
            });

            const manifest = JSON.parse(await fs.promises.readFile(path.join(storageRoot, sessionId, "snapshots", "manifest.json"), "utf8"));
            await fs.promises.writeFile(path.join(workspaceDir, "hello.txt"), "mutated\n", "utf8");

            const restoreResponse = await server.handleMessage({
                jsonrpc: "2.0",
                id: 4,
                method: "_diogenes/session/restore",
                params: { sessionId, snapshotId: manifest.snapshots[0].snapshotId },
            });

            expect(restoreResponse && "result" in restoreResponse ? restoreResponse.result.restored : null).toBe(true);
            expect(restoreResponse && "result" in restoreResponse ? restoreResponse.result.metadata : null).toEqual(
                expect.objectContaining({
                    title: "Initial snapshot",
                    description: "Creates the baseline snapshot.",
                }),
            );
            expect(await fs.promises.readFile(path.join(workspaceDir, "hello.txt"), "utf8")).toBe("restored via acp\n");
            expect(notifications.some((item) => item.params?.update?.sessionUpdate === "snapshot_restore_started")).toBe(true);
            expect(notifications.some((item) => item.params?.update?.sessionUpdate === "snapshot_restore_completed")).toBe(true);
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            delete process.env.FAKE_RESTIC_RESTORE_ROOTNAME;
            delete process.env.FAKE_RESTIC_RESTORE_HELLO;
            process.env.HOME = originalHome;
            await fs.promises.rm(root, { recursive: true, force: true });
        }
    });
});
