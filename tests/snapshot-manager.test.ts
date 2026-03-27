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
        await fs.writeFile(path.join(workspaceDir, ".gitignore"), "secret.txt\nignored-dir/\n", "utf8");
        await fs.writeFile(path.join(workspaceDir, "secret.txt"), "hidden\n", "utf8");
        await fs.mkdir(path.join(workspaceDir, "ignored-dir"), { recursive: true });
        await fs.writeFile(path.join(workspaceDir, "ignored-dir", "hidden.txt"), "hidden\n", "utf8");

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
                await fs.readFile(path.join(fixture.storageRoot, "session-1", "snapshots", "manifest.json"), "utf8"),
            );
            expect(manifest.snapshots).toHaveLength(1);
            expect(manifest.snapshots[0].diogenesStatePath).toContain(path.join("state", `${snapshot.snapshotId}.json`));

            const state = JSON.parse(await fs.readFile(manifest.snapshots[0].diogenesStatePath, "utf8"));
            expect(state).toEqual(expect.objectContaining({
                kind: "diogenes_state",
                sessionId: "session-1",
                cwd: fixture.workspaceDir,
                acpReplayLog: [],
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
            expect(entries[1].args).toEqual(expect.arrayContaining([
                "--exclude",
                "workspace/secret.txt",
                "--exclude",
                "workspace/ignored-dir",
            ]));

            await manager.cleanup();
            await expect(fs.access(path.join(fixture.storageRoot, "session-1", "snapshots"))).rejects.toThrow();
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("restores workspace files from staging and rehydrates persisted state", async () => {
        const fixture = await createFixture();
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: fixture.workspaceDir,
            },
        });
        const workspace = diogenes.getWorkspaceManager();
        await workspace.loadDirectory(".");
        await workspace.loadFile("hello.txt", 1, 1);
        workspace.setTodoItems([{ text: "before restore", state: "active" }]);
        workspace.setNotepadLines(["keep me"]);

        const sessionState = {
            title: "Before restore",
            description: "Snapshot metadata",
        };

        let restoredState: any = null;
        const manager = new SessionSnapshotManager({
            sessionId: "session-restore",
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
                getMessageHistory: () => [{ role: "assistant", content: "captured before restore" }],
                getCreatedAt: () => "2026-03-26T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-26T00:01:00.000Z",
                getSnapshotMetadata: () => sessionState,
            },
            stateRestorer: {
                restorePersistedState: async (state) => {
                    restoredState = state;
                },
            },
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        process.env.FAKE_RESTIC_RESTORE_ROOTNAME = path.basename(fixture.workspaceDir);
        process.env.FAKE_RESTIC_RESTORE_HELLO = "restored from snapshot\n";
        try {
            await manager.initialize();
            const snapshot = await manager.createSnapshot({
                trigger: "system_manual",
                turn: 1,
                label: "restore-point",
            });

            await fs.writeFile(path.join(fixture.workspaceDir, "hello.txt"), "mutated\n", "utf8");
            await manager.restoreSnapshot({ snapshotId: snapshot.snapshotId });

            expect(await fs.readFile(path.join(fixture.workspaceDir, "hello.txt"), "utf8")).toBe("restored from snapshot\n");
            expect(restoredState).toEqual(expect.objectContaining({
                kind: "diogenes_state",
                metadata: sessionState,
                acpReplayLog: [],
                messageHistory: [{ role: "assistant", content: "captured before restore" }],
            }));
            expect(restoredState.workspace.todo).toEqual([{ text: "before restore", state: "active" }]);
            expect(restoredState.workspace.notepad).toEqual(["keep me"]);
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            delete process.env.FAKE_RESTIC_RESTORE_ROOTNAME;
            delete process.env.FAKE_RESTIC_RESTORE_HELLO;
        }
    });

    it("rolls back workspace changes if state restore fails", async () => {
        const fixture = await createFixture();
        const manager = new SessionSnapshotManager({
            sessionId: "session-rollback",
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
                getWorkspaceManager: () => createDiogenes({ security: { workspaceRoot: fixture.workspaceDir } }).getWorkspaceManager(),
                getMessageHistory: () => [],
                getCreatedAt: () => "2026-03-26T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-26T00:01:00.000Z",
            },
            stateRestorer: {
                restorePersistedState: async () => {
                    throw new Error("rehydrate failed");
                },
            },
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        process.env.FAKE_RESTIC_RESTORE_ROOTNAME = path.basename(fixture.workspaceDir);
        process.env.FAKE_RESTIC_RESTORE_HELLO = "restored from snapshot\n";
        try {
            await manager.initialize();
            const snapshot = await manager.createSnapshot({
                trigger: "system_manual",
                turn: 1,
                label: "rollback-point",
            });

            await fs.writeFile(path.join(fixture.workspaceDir, "hello.txt"), "local mutation\n", "utf8");
            await expect(manager.restoreSnapshot({ snapshotId: snapshot.snapshotId })).rejects.toThrow("rehydrate failed");
            expect(await fs.readFile(path.join(fixture.workspaceDir, "hello.txt"), "utf8")).toBe("local mutation\n");
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            delete process.env.FAKE_RESTIC_RESTORE_ROOTNAME;
            delete process.env.FAKE_RESTIC_RESTORE_HELLO;
        }
    });

    it("creates automatic snapshots before prompts and keeps session snapshots after closing the live session", async () => {
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

            const manifestPath = path.join(fixture.storageRoot, session.sessionId, "snapshots", "manifest.json");
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

            await manager.closeSession(session.sessionId);
            await expect(fs.access(path.join(fixture.storageRoot, session.sessionId, "snapshots", "manifest.json"))).resolves.toBeUndefined();
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

            const manifestPath = path.join(fixture.storageRoot, session.sessionId, "snapshots", "manifest.json");
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

            await new Promise((resolve) => setTimeout(resolve, 20));

            expect(
                notifications.some(
                    (item) => item.params?.update?.sessionUpdate === "available_commands_update"
                        && item.params.update.availableCommands.some(
                            (command: any) => command.name === "snapshot"
                                && command._meta?.diogenes?.example === "/snapshot before-risky-edit",
                        ),
                ),
            ).toBe(true);

            const response = await server.handleMessage({
                jsonrpc: "2.0",
                id: 3,
                method: "session/prompt",
                params: {
                    sessionId,
                    prompt: [
                        { type: "text", text: "/snapshot manual-checkpoint" },
                        {
                            type: "resource_link",
                            uri: "file:///tmp/example.txt",
                            name: "example.txt",
                        },
                    ],
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
                await fs.readFile(path.join(fixture.storageRoot, sessionId, "snapshots", "manifest.json"), "utf8"),
            );
            expect(manifest.snapshots).toHaveLength(1);
            expect(manifest.snapshots[0]).toEqual(
                expect.objectContaining({
                    trigger: "system_manual",
                    label: "manual-checkpoint",
                    turn: 1,
                }),
            );

            const slashState = JSON.parse(await fs.readFile(manifest.snapshots[0].diogenesStatePath, "utf8"));
            expect(slashState.messageHistory.some((message: any) => String(message.content).includes("/snapshot manual-checkpoint"))).toBe(true);
            expect(slashState.messageHistory.some((message: any) => String(message.content).includes("file:///tmp/example.txt"))).toBe(true);

            const entries = await readInvocationLog(fixture.logPath);
            expect(entries.filter((entry) => entry.args.includes("backup"))).toHaveLength(1);
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("uses the previous snapshot as the restic parent for later snapshots", async () => {
        const fixture = await createFixture();
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: fixture.workspaceDir,
            },
        });
        const workspace = diogenes.getWorkspaceManager();
        const manager = new SessionSnapshotManager({
            sessionId: "session-parent",
            cwd: fixture.workspaceDir,
            config: {
                enabled: true,
                includeDiogenesState: false,
                autoBeforePrompt: true,
                storageRoot: fixture.storageRoot,
                resticBinary: process.execPath,
                resticBinaryArgs: [fixture.fixturePath],
                timeoutMs: 5_000,
            },
            stateProvider: {
                getWorkspaceManager: () => workspace,
                getMessageHistory: () => [],
                getCreatedAt: () => "2026-03-26T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-26T00:01:00.000Z",
            },
        });

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        try {
            await manager.createSnapshot({ trigger: "before_prompt", turn: 1 });
            await manager.createSnapshot({ trigger: "before_prompt", turn: 2 });

            const entries = await readInvocationLog(fixture.logPath);
            const backupEntries = entries.filter((entry) => entry.args.includes("backup"));
            expect(backupEntries).toHaveLength(2);
            expect(backupEntries[0].args).toContain("--skip-if-unchanged");
            expect(backupEntries[1].args).toEqual(expect.arrayContaining([
                "--parent",
                "abc123def456",
                "--skip-if-unchanged",
            ]));
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
        }
    });

    it("preserves gitignored files and directories during snapshot restore", async () => {
        const fixture = await createFixture();
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: fixture.workspaceDir,
            },
        });
        const workspace = diogenes.getWorkspaceManager();
        const manager = new SessionSnapshotManager({
            sessionId: "session-gitignore-preserve",
            cwd: fixture.workspaceDir,
            config: {
                enabled: true,
                includeDiogenesState: false,
                autoBeforePrompt: true,
                storageRoot: fixture.storageRoot,
                resticBinary: process.execPath,
                resticBinaryArgs: [fixture.fixturePath],
                timeoutMs: 5_000,
            },
            stateProvider: {
                getWorkspaceManager: () => workspace,
                getMessageHistory: () => [],
                getCreatedAt: () => "2026-03-26T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-26T00:01:00.000Z",
            },
        });

        // Create additional gitignored files that should be preserved
        await fs.writeFile(path.join(fixture.workspaceDir, "secret.txt"), "original-secret\n", "utf8");
        await fs.mkdir(path.join(fixture.workspaceDir, "ignored-dir"), { recursive: true });
        await fs.writeFile(path.join(fixture.workspaceDir, "ignored-dir", "hidden.txt"), "original-hidden\n", "utf8");

        process.env.FAKE_RESTIC_LOG = fixture.logPath;
        process.env.FAKE_RESTIC_RESTORE_ROOTNAME = path.basename(fixture.workspaceDir);
        process.env.FAKE_RESTIC_RESTORE_HELLO = "restored from snapshot\n";
        try {
            await manager.initialize();
            const snapshot = await manager.createSnapshot({
                trigger: "system_manual",
                turn: 1,
                label: "gitignore-test",
            });

            // Mutate non-gitignored file
            await fs.writeFile(path.join(fixture.workspaceDir, "hello.txt"), "mutated\n", "utf8");

            // Mutate gitignored file (should be preserved during restore)
            await fs.writeFile(path.join(fixture.workspaceDir, "secret.txt"), "modified-secret\n", "utf8");
            await fs.writeFile(path.join(fixture.workspaceDir, "ignored-dir", "hidden.txt"), "modified-hidden\n", "utf8");

            await manager.restoreSnapshot({ snapshotId: snapshot.snapshotId });

            // Non-gitignored file should be restored
            expect(await fs.readFile(path.join(fixture.workspaceDir, "hello.txt"), "utf8")).toBe("restored from snapshot\n");

            // Gitignored files should be preserved (not restored, not deleted)
            expect(await fs.readFile(path.join(fixture.workspaceDir, "secret.txt"), "utf8")).toBe("modified-secret\n");
            expect(await fs.readFile(path.join(fixture.workspaceDir, "ignored-dir", "hidden.txt"), "utf8")).toBe("modified-hidden\n");

            // Gitignored directory should still exist
            await expect(fs.access(path.join(fixture.workspaceDir, "ignored-dir"))).resolves.toBeUndefined();
        } finally {
            delete process.env.FAKE_RESTIC_LOG;
            delete process.env.FAKE_RESTIC_RESTORE_ROOTNAME;
            delete process.env.FAKE_RESTIC_RESTORE_HELLO;
        }
    });
});
