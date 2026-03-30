import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { handleCommand, parseArgs } from "../src/cli";
import * as appPaths from "../src/utils/app-paths";

describe("CLI session commands", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("parses session list commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "session", "list"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "sessions.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses run commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "run", "inspect", "src"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "run" });
            expect(parsed.task).toBe("inspect src");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("rejects bare task input", () => {
        const originalArgv = process.argv;
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code?: string | number | null,
        ) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        process.argv = ["node", "diogenes", "inspect", "src"];

        try {
            expect(() => parseArgs()).toThrow("process.exit:1");
            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalled();
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses session delete commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "session", "delete", "session-123"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "sessions.delete", sessionId: "session-123" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses session prune commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "session", "prune", "--dry-run"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "sessions.prune",
                dryRun: true,
                tempOnly: false,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses session prune temp commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "session", "prune", "--temp", "--dry-run"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "sessions.prune",
                dryRun: true,
                tempOnly: true,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model list command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model list command explicitly", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "list"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model default command without model", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "default"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.default", model: undefined });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model default command with model", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "default", "openai/gpt-4o-mini"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.default", model: "openai/gpt-4o-mini" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("prints stored session metadata for sessions get", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-sessions-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        const sessionId = "session-123";
        const sessionDir = path.join(sessionsDir, sessionId);

        await fs.mkdir(sessionDir, { recursive: true });
        await fs.mkdir(path.join(sessionDir, "snapshots"), { recursive: true });
        await fs.writeFile(
            path.join(sessionDir, "metadata.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/home/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Session title",
                    description: "Session description",
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );
        await fs.writeFile(
            path.join(sessionDir, "snapshots", "manifest.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/home/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    snapshots: [
                        {
                            snapshotId: "snapshot-1",
                            createdAt: "2026-03-27T00:00:02.000Z",
                            trigger: "system_manual",
                            turn: 1,
                            label: "before risky change",
                            resticSnapshotId: "restic-1",
                        },
                    ],
                },
                null,
                2,
            ),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.get", sessionId });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");

        expect(output).toContain("Session");
        expect(output).toContain(sessionId);
        expect(output).toContain("title: Session title");
        expect(output).toContain("snapshots: 1");
        expect(output).toContain("snapshot-1");
    });

    it("prints session snapshots in table format", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-snapshot-list-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        const sessionId = "session-123";
        const sessionDir = path.join(sessionsDir, sessionId);

        await fs.mkdir(path.join(sessionDir, "snapshots"), { recursive: true });
        await fs.writeFile(
            path.join(sessionDir, "metadata.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/home/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Session title",
                    description: "Session description",
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );
        await fs.writeFile(
            path.join(sessionDir, "snapshots", "manifest.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/home/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    snapshots: [
                        {
                            snapshotId: "snapshot-1",
                            createdAt: "2026-03-27T00:00:02.000Z",
                            trigger: "system_manual",
                            turn: 1,
                            label: "before risky change",
                            resticSnapshotId: "restic-1",
                        },
                    ],
                },
                null,
                2,
            ),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.snapshots", sessionId });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
        expect(output).toContain("Snapshots for session-123");
        expect(output).toContain("Snapshot");
        expect(output).toContain("snapshot-1");
        expect(output).toContain("before risky change");
    });

    it("prints session list in CLI format", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-session-list-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        const sessionId = "session-abc";
        const sessionDir = path.join(sessionsDir, sessionId);

        await fs.mkdir(sessionDir, { recursive: true });
        await fs.writeFile(
            path.join(sessionDir, "metadata.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/home/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Demo session",
                    description: "Session description",
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.list" });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
        expect(output).toContain("Stored Sessions");
        expect(output).toContain(sessionId);
        expect(output).toContain("Demo session");
        expect(output).toContain("/home/test/workspace");
    });

    it("hides temporary sessions from /var/folders in session list", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-session-hidden-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        const sessionId = "temp-session";
        const sessionDir = path.join(sessionsDir, sessionId);

        await fs.mkdir(sessionDir, { recursive: true });
        await fs.writeFile(
            path.join(sessionDir, "metadata.json"),
            JSON.stringify(
                {
                    sessionId,
                    cwd: "/var/folders/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Temp session",
                    description: null,
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.list" });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
        expect(output).not.toContain("temp-session");
        expect(output).toContain("temporary test session");
    });

    it("prunes broken session directories from CLI", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-prune-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        await fs.mkdir(path.join(sessionsDir, "broken"), { recursive: true });
        await fs.writeFile(
            path.join(sessionsDir, "broken", "metadata.json"),
            JSON.stringify({ sessionId: "broken" }),
            "utf8",
        );
        await fs.mkdir(path.join(sessionsDir, "snapshot-only", "snapshots"), { recursive: true });
        await fs.writeFile(
            path.join(sessionsDir, "snapshot-only", "snapshots", "manifest.json"),
            JSON.stringify({
                sessionId: "snapshot-only",
                cwd: "/home/test/workspace",
                createdAt: "2026-03-27T00:00:00.000Z",
                snapshots: [],
            }),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.prune", dryRun: false });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
        expect(output).toContain("Removed 2 session artifact set(s)");
        expect(output).toContain("broken");
        expect(output).toContain("missing_state");
        expect(output).toContain("snapshot-only");
        expect(output).toContain("orphaned_snapshot_artifacts");
        await expect(fs.access(path.join(sessionsDir, "broken"))).rejects.toThrow();
        await expect(fs.access(path.join(sessionsDir, "snapshot-only"))).rejects.toThrow();
    });

    it("prunes temporary test sessions from CLI", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-prune-temp-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        const sessionsDir = path.join(dataDir, "sessions");
        const tempSessionId = "temp-session";
        const keepSessionId = "keep-session";

        await fs.mkdir(path.join(sessionsDir, tempSessionId), { recursive: true });
        await fs.mkdir(path.join(sessionsDir, keepSessionId), { recursive: true });
        await fs.writeFile(
            path.join(sessionsDir, tempSessionId, "metadata.json"),
            JSON.stringify(
                {
                    sessionId: tempSessionId,
                    cwd: "/var/folders/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Temp session",
                    description: null,
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );
        await fs.writeFile(
            path.join(sessionsDir, keepSessionId, "metadata.json"),
            JSON.stringify(
                {
                    sessionId: keepSessionId,
                    cwd: "/Users/test/workspace",
                    createdAt: "2026-03-27T00:00:00.000Z",
                    updatedAt: "2026-03-27T00:00:01.000Z",
                    title: "Keep session",
                    description: null,
                    state: "active",
                    hasActiveRun: false,
                    availableCommands: [],
                    snapshotEnabled: true,
                },
                null,
                2,
            ),
            "utf8",
        );

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        await handleCommand({ kind: "sessions.prune", dryRun: false, tempOnly: true });

        const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
        expect(output).toContain("Removed 1 temporary test session(s)");
        expect(output).toContain(tempSessionId);
        await expect(fs.access(path.join(sessionsDir, tempSessionId))).rejects.toThrow();
        await expect(fs.access(path.join(sessionsDir, keepSessionId))).resolves.toBeUndefined();
    });

    it("prints models in table format", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-list-"));
        tempDirs.push(root);
        process.env.HOME = root;

        try {
            const paths = appPaths.resolveDiogenesAppPaths({ homeDir: root });
            const configDir = paths.configDir;

            await fs.mkdir(configDir, { recursive: true });
            await fs.writeFile(
                path.join(configDir, "models.yaml"),
                [
                    "providers:",
                    "  openai:",
                    "    style: openai",
                    "    models:",
                    "      gpt-4o-mini:",
                    "        name: GPT-4o Mini",
                    "        contextWindow: 128000",
                    "default: openai/gpt-4o-mini",
                ].join("\n"),
                "utf8",
            );

            const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

            await handleCommand({ kind: "models.list" });

            const output = String(consoleSpy.mock.calls[0]?.[0] ?? "");
            expect(output).toContain("Available Models");
            expect(output).toContain("Model");
            expect(output).toContain("openai/gpt-4o-mini");
            expect(output).toContain("GPT-4o Mini");
            expect(output).toContain("yes");
        } finally {
            process.env.HOME = originalHome;
        }
    });
});
