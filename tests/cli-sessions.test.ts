import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConfig, handleCommand, parseArgs } from "../src/cli";
import * as appPaths from "../src/utils/app-paths";
import * as resticManager from "../src/utils/restic-manager";

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

    it("parses init command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "init"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "init" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses doctor command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "doctor"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "doctor" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses restic binary option", () => {
        const originalArgv = process.argv;
        process.argv = [
            "node",
            "diogenes",
            "--restic-binary",
            "/tmp/restic",
            "run",
            "inspect",
            "src",
        ];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "run" });
            expect(parsed.options.resticBinary).toBe("/tmp/restic");
            expect(parsed.task).toBe("inspect src");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("creates config with restic binary from environment", () => {
        const originalValue = process.env.DIOGENES_RESTIC_BINARY;
        process.env.DIOGENES_RESTIC_BINARY = "relative/restic";

        try {
            const config = createConfig({});
            expect(config.security?.snapshot?.resticBinary).toBe(path.resolve("relative/restic"));
        } finally {
            if (originalValue === undefined) {
                delete process.env.DIOGENES_RESTIC_BINARY;
            } else {
                process.env.DIOGENES_RESTIC_BINARY = originalValue;
            }
        }
    });

    it("creates config with restic binary from CLI option", () => {
        const config = createConfig({ resticBinary: "relative/restic" });
        expect(config.security?.snapshot?.resticBinary).toBe(path.resolve("relative/restic"));
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
            expect(parsed.command).toEqual({
                kind: "models.default",
                model: undefined,
                clear: false,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model default command with model", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "default", "openai/gpt-4o-mini"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "models.default",
                model: "openai/gpt-4o-mini",
                clear: false,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model path command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "path"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.path" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model providers command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "providers"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.providers" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model show command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "show", "openai/gpt-4o"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({ kind: "models.show", model: "openai/gpt-4o" });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model default clear command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "model", "default", "--clear"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "models.default",
                model: undefined,
                clear: true,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model add-provider command", () => {
        const originalArgv = process.argv;
        process.argv = [
            "node",
            "diogenes",
            "model",
            "add-provider",
            "proxy",
            "--style",
            "openai",
            "--base-url",
            "https://example.com/v1",
            "--supports-tool-role",
        ];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "models.addProvider",
                provider: "proxy",
                style: "openai",
                baseUrl: "https://example.com/v1",
                supportsToolRole: true,
            });
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses model add command", () => {
        const originalArgv = process.argv;
        process.argv = [
            "node",
            "diogenes",
            "model",
            "add",
            "proxy/gpt-4.1",
            "--name",
            "GPT 4.1 Proxy",
            "--description",
            "Proxy-backed model",
            "--context-window",
            "128000",
            "--max-tokens",
            "4096",
            "--temperature",
            "0.2",
        ];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toEqual({
                kind: "models.add",
                model: "proxy/gpt-4.1",
                name: "GPT 4.1 Proxy",
                description: "Proxy-backed model",
                contextWindow: 128000,
                maxTokens: 4096,
                temperature: 0.2,
            });
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

    it("prints init summary", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(resticManager, "ensureSnapshotResticConfigured").mockImplementation(
            async (config) => {
                config.security = {
                    ...(config.security || {}),
                    snapshot: {
                        ...(config.security?.snapshot || {}),
                        enabled: false,
                    },
                };
                return { enabled: false, reason: "snapshots disabled" };
            },
        );

        await handleCommand({ kind: "init" });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Diogenes Init"));
    });

    it("prints doctor summary with degraded snapshots", async () => {
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        vi.spyOn(resticManager, "ensureSnapshotResticConfigured").mockImplementation(
            async (config) => {
                config.security = {
                    ...(config.security || {}),
                    snapshot: {
                        ...(config.security?.snapshot || {}),
                        requestedEnabled: true,
                        enabled: false,
                        unavailableReason: "init:timeout: restic command timed out",
                        resticBinary: "/tmp/restic-managed",
                    },
                };
                return { enabled: false, reason: "init:timeout: restic command timed out" };
            },
        );

        await handleCommand({ kind: "doctor" });

        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Diogenes Doctor"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("ACP Logs Dir:"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("ACP Current Log:"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("mode: degraded"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("phase: init"));
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("kind: timeout"));
    });

    it("prints model path", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-path-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await handleCommand({ kind: "models.path" });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("models.yaml"));
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("prints configured providers", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-providers-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await handleCommand({ kind: "models.providers" });
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Configured Providers"),
            );
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("prints one model definition", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-show-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await handleCommand({ kind: "models.show", model: "openai/gpt-4o" });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Model"));
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("openai/gpt-4o"));
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("clears the default model", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-clear-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await handleCommand({ kind: "models.default", clear: true });
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining("Default model cleared"),
            );
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("adds a provider to models.yaml", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-add-provider-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            await handleCommand({
                kind: "models.addProvider",
                provider: "proxy",
                style: "openai",
                baseUrl: "https://example.com/v1",
                supportsToolRole: true,
            });

            const modelsPath = appPaths.resolveDiogenesAppPaths({ homeDir: root }).modelsConfigPath;
            const content = await fs.readFile(modelsPath, "utf8");

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Added provider:"));
            expect(content).toContain("proxy:");
            expect(content).toContain("style: openai");
            expect(content).toContain("baseURL: https://example.com/v1");
            expect(content).toContain("supportsToolRole: true");
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("rejects adding an existing provider", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-add-provider-existing-"));
        tempDirs.push(root);
        process.env.HOME = root;

        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit:1");
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const modelsPath = appPaths.resolveDiogenesAppPaths({ homeDir: root }).modelsConfigPath;
            await fs.mkdir(path.dirname(modelsPath), { recursive: true });
            await fs.writeFile(
                modelsPath,
                ["providers:", "  proxy:", "    style: openai", "    models: {}", ""].join("\n"),
                "utf8",
            );

            await expect(
                handleCommand({
                    kind: "models.addProvider",
                    provider: "proxy",
                    style: "openai",
                    baseUrl: undefined,
                    supportsToolRole: false,
                }),
            ).rejects.toThrow("process.exit:1");

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Provider already exists"),
            );
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("adds a model to an existing provider", async () => {
        const originalHome = process.env.HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-add-"));
        tempDirs.push(root);
        process.env.HOME = root;
        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

        try {
            const modelsPath = appPaths.resolveDiogenesAppPaths({ homeDir: root }).modelsConfigPath;
            await fs.mkdir(path.dirname(modelsPath), { recursive: true });
            await fs.writeFile(
                modelsPath,
                ["providers:", "  proxy:", "    style: openai", "    models: {}", ""].join("\n"),
                "utf8",
            );

            await handleCommand({
                kind: "models.add",
                model: "proxy/gpt-4.1",
                name: "GPT 4.1 Proxy",
                description: "Proxy-backed model",
                contextWindow: 128000,
                maxTokens: 4096,
                temperature: 0.2,
            });

            const content = await fs.readFile(modelsPath, "utf8");
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("Added model:"));
            expect(content).toContain("gpt-4.1:");
            expect(content).toContain("name: GPT 4.1 Proxy");
            expect(content).toContain("description: Proxy-backed model");
            expect(content).toContain("contextWindow: 128000");
            expect(content).toContain("maxTokens: 4096");
            expect(content).toContain("temperature: 0.2");
        } finally {
            process.env.HOME = originalHome;
        }
    });

    it("rejects adding a model to an unknown provider", async () => {
        const originalHome = process.env.HOME;
        const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
        const originalXdgDataHome = process.env.XDG_DATA_HOME;
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-model-add-missing-provider-"));
        tempDirs.push(root);
        process.env.HOME = root;
        process.env.XDG_CONFIG_HOME = path.join(root, ".config");
        process.env.XDG_DATA_HOME = path.join(root, ".local", "share");

        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("process.exit:1");
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        try {
            const modelsPath = appPaths.resolveDiogenesAppPaths({
                homeDir: root,
                env: process.env,
            }).modelsConfigPath;
            await fs.mkdir(path.dirname(modelsPath), { recursive: true });
            await fs.writeFile(
                modelsPath,
                [
                    "providers:",
                    "  openai:",
                    "    style: openai",
                    "    models:",
                    "      gpt-4o:",
                    '        name: "GPT-4o"',
                    "",
                ].join("\n"),
                "utf8",
            );

            await expect(
                handleCommand({
                    kind: "models.add",
                    model: "proxy/gpt-4.1",
                    name: "GPT 4.1 Proxy",
                }),
            ).rejects.toThrow("process.exit:1");

            expect(exitSpy).toHaveBeenCalledWith(1);
            expect(errorSpy).toHaveBeenCalledWith(
                expect.stringContaining("Unknown provider for model"),
            );
        } finally {
            process.env.HOME = originalHome;
            if (originalXdgConfigHome === undefined) {
                delete process.env.XDG_CONFIG_HOME;
            } else {
                process.env.XDG_CONFIG_HOME = originalXdgConfigHome;
            }
            if (originalXdgDataHome === undefined) {
                delete process.env.XDG_DATA_HOME;
            } else {
                process.env.XDG_DATA_HOME = originalXdgDataHome;
            }
        }
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
