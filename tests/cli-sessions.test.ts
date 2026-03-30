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
        process.argv = ["node", "diogenes", "sessions", "list"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "sessions.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses session delete commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "sessions", "delete", "session-123"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "sessions.delete", sessionId: "session-123" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses session prune commands", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "sessions", "prune", "--dry-run"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "sessions.prune", dryRun: true });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses models list command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "models"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses models list command explicitly", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "models", "list"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.list" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses models default command without model", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "models", "default"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.default", model: undefined });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses models default command with model", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "models", "default", "openai/gpt-4o-mini"];

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
                    cwd: "/tmp/workspace",
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
                    cwd: "/tmp/workspace",
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

        const output = JSON.parse(consoleSpy.mock.calls[0]?.[0] ?? "{}");

        expect(output).toEqual({
            metadata: expect.objectContaining({ sessionId, title: "Session title" }),
            snapshots: [
                {
                    snapshotId: "snapshot-1",
                    createdAt: "2026-03-27T00:00:02.000Z",
                    trigger: "system_manual",
                    turn: 1,
                    label: "before risky change",
                },
            ],
        });
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
                cwd: "/tmp/workspace",
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

        const output = JSON.parse(consoleSpy.mock.calls[0]?.[0] ?? "{}");
        expect(output).toEqual(
            expect.objectContaining({
                deletedSessionIds: ["broken", "snapshot-only"],
                reasonsBySessionId: {
                    broken: "missing_state",
                    "snapshot-only": "orphaned_snapshot_artifacts",
                },
                dryRun: false,
            }),
        );
        await expect(fs.access(path.join(sessionsDir, "broken"))).rejects.toThrow();
        await expect(fs.access(path.join(sessionsDir, "snapshot-only"))).rejects.toThrow();
    });
});
