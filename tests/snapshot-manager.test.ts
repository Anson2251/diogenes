import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionManager } from "../src/acp/session-manager";
import { OpenAIClient } from "../src/llm/openai-client";
import { SessionSnapshotManager } from "../src/snapshot/manager";
import { ACPServer } from "../src/acp/server";
import * as appPaths from "../src/utils/app-paths";
import { createDiogenes } from "../src/create-diogenes";

async function createTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "snapshot-manager-"));
}

async function readInvocationLog(logPath: string): Promise<Array<Record<string, any>>> {
    const content = await fs.readFile(logPath, "utf8");
    return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

describe("SessionSnapshotManager", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    async function createFixture() {
        const rootDir = await createTempDir();
        tempDirs.push(rootDir);

        const storageRoot = path.join(rootDir, "snapshots");
        const workspaceDir = path.join(rootDir, "workspace");
        const fixturePath = path.join(process.cwd(), "tests/fixtures/fake-restic.cjs");
        const logPath = path.join(rootDir, "restic.log");

        await fs.mkdir(workspaceDir, { recursive: true });
        await fs.writeFile(path.join(workspaceDir, "hello.txt"), "hello\n", "utf8");

        return {
            rootDir,
            storageRoot,
            workspaceDir,
            fixturePath,
            logPath,
        };
    }

    it("creates a session-scoped repo, manifest, serialized state, and cleanup", async () => {
        const fixture = await createFixture();
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: fixture.workspaceDir,
            },
        });
        const workspace = diogenes.getWorkspaceManager();
        await workspace.loadDirectory(".");
        await workspace.loadFile("hello.txt", 1, 1);
        workspace.setTodoItems([{ text: "Inspect snapshot", state: "active" }]);
        workspace.setNotepadLines(["remember this"]);
            const manager = new SessionSnapshotManager({
                sessionId: "session-1",
            cwd: fixture.workspaceDir,
            config: {
                enabled: true,
                includeDiogenesState: true,
                autoBeforePrompt: true,
                storageRoot: fixture.storageRoot,
                resticBinary: process.execPath,
                resticBinaryArgs: [fixture.fixturePath],
                timeoutMs: 5_000,
            },
            stateProvider: {
                getWorkspaceManager: () => workspace,
                getMessageHistory: () => [{ role: "assistant", content: "Earlier summary" }],
                getCreatedAt: () => "2026-03-26T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-26T00:01:00.000Z",
            },
            stateSerializer: undefined,
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        try {
            await manager.initialize();
            const snapshot = await manager.createSnapshot({
                trigger: "system_manual",
                turn: 1,
                label: "baseline",
            });
            const listed = await manager.listSnapshots();

            expect(snapshot.resticSnapshotId).toBe("abc123def456");
            expect(listed).toEqual([
                expect.objectContaining({
                    snapshotId: snapshot.snapshotId,
                    trigger: "system_manual",
                    turn: 1,
                    label: "baseline",
                }),
            ]);

            const manifest = JSON.parse(
                await fs.readFile(path.join(fixture.storageRoot, "session-1", "manifest.json"), "utf8"),
            );
            expect(manifest.snapshots).toHaveLength(1);
            expect(manifest.snapshots[0].diogenesStatePath).toContain(path.join("state", `${snapshot.snapshotId}.json`));

            const state = JSON.parse(await fs.readFile(manifest.snapshots[0].diogenesStatePath, "utf8"));
            expect(state).toEqual(expect.objectContaining({
                kind: "diogenes_state",
                sessionId: "session-1",
                cwd: fixture.workspaceDir,
                messageHistory: [{ role: "assistant", content: "Earlier summary" }],
            }));
            expect(state.workspace.loadedDirectories).toEqual(["."]);
            expect(state.workspace.loadedFiles).toEqual([{ path: "hello.txt", ranges: [{ start: 1, end: 1 }] }]);
            expect(state.workspace.todo).toEqual([{ text: "Inspect snapshot", state: "active" }]);
            expect(state.workspace.notepad).toEqual(["remember this"]);

            const entries = await readInvocationLog(fixture.logPath);
            expect(entries[0].args).toEqual(["init"]);
            expect(entries[1].args).toContain("backup");
            expect(entries[1].args).toContain("workspace");

            await manager.cleanup();
            await expect(fs.access(path.join(fixture.storageRoot, "session-1"))).rejects.toThrow();
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("creates automatic snapshots before prompts and removes them on session disposal", async () => {
        const fixture = await createFixture();
        const maliciousStorageRoot = path.join(fixture.rootDir, "Desktop");
        vi.spyOn(appPaths, "getDefaultSessionsStorageRoot").mockReturnValue(fixture.storageRoot);
        const manager = new SessionManager(
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: {
                    snapshot: {
                        enabled: true,
                        includeDiogenesState: true,
                        autoBeforePrompt: true,
                        storageRoot: maliciousStorageRoot,
                        resticBinary: process.execPath,
                        resticBinaryArgs: [fixture.fixturePath],
                        timeoutMs: 5_000,
                    },
                },
            },
            5,
            () => {},
        );

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockResolvedValue({
            content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"ok"}}]\n```',
            reasoning: "",
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        try {
            const session = await manager.createSession(fixture.workspaceDir);
            expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
            await session.prompt([{ type: "text", text: "Take a snapshot first" }]);

            const manifestPath = path.join(fixture.storageRoot, session.sessionId, "manifest.json");
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
            expect(manifest.snapshots).toHaveLength(1);
            expect(manifest.snapshots[0]).toEqual(
                expect.objectContaining({
                    trigger: "before_prompt",
                    turn: 1,
                    resticSnapshotId: "abc123def456",
                }),
            );

            const entries = await readInvocationLog(fixture.logPath);
            expect(entries.map((entry) => entry.args[0])).toEqual(["init", "backup"]);
            await expect(fs.access(path.join(maliciousStorageRoot, session.sessionId))).rejects.toThrow();

            await manager.disposeSession(session.sessionId);
            await expect(fs.access(path.join(fixture.storageRoot, session.sessionId))).rejects.toThrow();
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("registers snapshot.create for LLM-driven manual checkpoints", async () => {
        const fixture = await createFixture();
        vi.spyOn(appPaths, "getDefaultSessionsStorageRoot").mockReturnValue(fixture.storageRoot);
        const manager = new SessionManager(
            {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: {
                    snapshot: {
                        enabled: true,
                        includeDiogenesState: true,
                        autoBeforePrompt: true,
                        storageRoot: fixture.storageRoot,
                        resticBinary: process.execPath,
                        resticBinaryArgs: [fixture.fixturePath],
                        timeoutMs: 5_000,
                    },
                },
            },
            5,
            () => {},
        );

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockResolvedValue({
            content: '```tool-call\n[{"tool":"snapshot.create","params":{"label":"before-risky-edit","reason":"checkpoint"}},{"tool":"task.end","params":{"reason":"done","summary":"ok"}}]\n```',
            reasoning: "",
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        try {
            const session = await manager.createSession(fixture.workspaceDir);
            expect((session as any).diogenes.getTool("snapshot.create")).toBeDefined();
            await session.prompt([{ type: "text", text: "Create a checkpoint" }]);

            const manifestPath = path.join(fixture.storageRoot, session.sessionId, "manifest.json");
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
            expect(manifest.snapshots).toHaveLength(2);
            expect(manifest.snapshots[0].trigger).toBe("before_prompt");
            expect(manifest.snapshots[1]).toEqual(
                expect.objectContaining({
                    trigger: "llm_manual",
                    label: "before-risky-edit",
                    turn: 1,
                }),
            );

            const manualState = JSON.parse(await fs.readFile(manifest.snapshots[1].diogenesStatePath, "utf8"));
            expect(manualState.messageHistory).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ role: "user" }),
                    expect.objectContaining({ role: "assistant" }),
                ]),
            );
            expect(manualState.messageHistory.some((message: any) => String(message.content).includes("Create a checkpoint"))).toBe(true);
            expect(manualState.messageHistory.some((message: any) => String(message.content).includes("snapshot.create"))).toBe(true);
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("advertises and handles the /snapshot ACP slash command", async () => {
        const fixture = await createFixture();
        vi.spyOn(appPaths, "getDefaultSessionsStorageRoot").mockReturnValue(fixture.storageRoot);
        const notifications: Array<{ method: string; params: any }> = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
                security: {
                    snapshot: {
                        enabled: true,
                        includeDiogenesState: true,
                        autoBeforePrompt: true,
                        storageRoot: fixture.storageRoot,
                        resticBinary: process.execPath,
                        resticBinaryArgs: [fixture.fixturePath],
                        timeoutMs: 5_000,
                    },
                },
            },
            notify: (method, params) => notifications.push({ method, params }),
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        try {
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
                params: { cwd: fixture.workspaceDir },
            });

            const sessionId = sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "available_commands_update"
                        && item.params.update.availableCommands.some((command: any) => command.name === "snapshot"),
                ),
            ).toBe(true);

            const response = await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [{ type: "text", text: "/snapshot manual-checkpoint" }],
                },
            });

            expect(response && "result" in response ? response.result.stopReason : null).toBe("end_turn");
            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "agent_message_chunk"
                        && typeof item.params.update.content?.text === "string"
                        && item.params.update.content.text.includes("manual-checkpoint"),
                ),
            ).toBe(true);

            const manifest = JSON.parse(
                await fs.readFile(path.join(fixture.storageRoot, sessionId, "manifest.json"), "utf8"),
            );
            expect(manifest.snapshots).toHaveLength(2);
            expect(manifest.snapshots[0]).toEqual(
                expect.objectContaining({
                    trigger: "before_prompt",
                    turn: 1,
                }),
            );
            expect(manifest.snapshots[1]).toEqual(
                expect.objectContaining({
                    trigger: "system_manual",
                    label: "manual-checkpoint",
                    turn: 1,
                }),
            );

            const slashState = JSON.parse(await fs.readFile(manifest.snapshots[1].diogenesStatePath, "utf8"));
            expect(slashState.messageHistory.some((message: any) => String(message.content).includes("/snapshot manual-checkpoint"))).toBe(true);
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });
});
