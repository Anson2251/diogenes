import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import type { DiogenesConfig } from "../src/types";

import {
    ensureSnapshotResticConfigured,
    getExtractionCommand,
    persistResticBinaryToConfig,
    selectReleaseAsset,
} from "../src/utils/restic-manager";

describe("restic-manager", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("selects the asset dynamically from the latest release tag", () => {
        const asset = selectReleaseAsset(
            {
                tag_name: "v9.9.9",
                assets: [
                    {
                        name: "restic_9.9.9_darwin_arm64.bz2",
                        browser_download_url: "https://example.com/restic_9.9.9_darwin_arm64.bz2",
                    },
                ],
            },
            "darwin",
            "arm64",
        );

        expect(asset.name).toBe("restic_9.9.9_darwin_arm64.bz2");
    });

    it("writes resticBinary into yaml config", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "restic-config-"));
        tempDirs.push(root);

        const configPath = path.join(root, "config.yaml");
        await fs.writeFile(
            configPath,
            [
                "llm:",
                "  model: openai/gpt-4o",
                "security:",
                "  snapshot:",
                "    enabled: true",
                "",
            ].join("\n"),
            "utf8",
        );

        await persistResticBinaryToConfig(configPath, "/tmp/restic-managed");

        const updated = await fs.readFile(configPath, "utf8");
        expect(updated).toContain("resticBinary: /tmp/restic-managed");
    });

    it("accepts an explicitly configured restic binary", async () => {
        const fixturePath = path.join(process.cwd(), "tests/fixtures/fake-restic.cjs");
        const config: DiogenesConfig = {
            llm: { apiKey: "test", model: "openai/gpt-4o" },
            security: {
                snapshot: {
                    enabled: true,
                    resticBinary: process.execPath,
                    resticBinaryArgs: [fixturePath],
                },
            },
        };

        const result = await ensureSnapshotResticConfigured(config);

        expect(result.enabled).toBe(true);
        expect(result.source).toBe("configured");
        expect(result.binaryPath).toBe(process.execPath);
    });

    it("reports verify-stage errors when configured binary is invalid", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "restic-verify-error-"));
        tempDirs.push(root);

        const config: DiogenesConfig = {
            llm: { apiKey: "test", model: "openai/gpt-4o" },
            security: {
                snapshot: {
                    enabled: true,
                    resticBinary: path.join(root, "missing-restic"),
                    resticBinaryArgs: [],
                },
            },
        };

        const originalPath = process.env.PATH;
        process.env.PATH = "";

        try {
            const result = await ensureSnapshotResticConfigured(config, {
                appPaths: {
                    homeDir: root,
                    configDir: path.join(root, "config"),
                    dataDir: path.join(root, "data"),
                    sessionsDir: path.join(root, "data", "sessions"),
                    defaultConfigCandidates: [],
                    modelsConfigPath: path.join(root, "config", "models.yaml"),
                },
                fetchImpl: async () => {
                    throw new Error("network unavailable");
                },
            });

            expect(result.enabled).toBe(false);
            expect(config.security?.snapshot?.unavailableReason).toContain("network unavailable");
        } finally {
            process.env.PATH = originalPath;
        }
    });

    it("disables snapshots when release fetch fails and no binary is available", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "restic-download-fail-"));
        tempDirs.push(root);

        const config: DiogenesConfig = {
            llm: { apiKey: "test", model: "openai/gpt-4o" },
            security: {
                snapshot: {
                    enabled: true,
                    resticBinary: path.join(root, "missing-restic"),
                    resticBinaryArgs: [],
                },
            },
        };

        const originalPath = process.env.PATH;
        process.env.PATH = "";

        try {
            const result = await ensureSnapshotResticConfigured(config, {
                appPaths: {
                    homeDir: root,
                    configDir: path.join(root, "config"),
                    dataDir: path.join(root, "data"),
                    sessionsDir: path.join(root, "data", "sessions"),
                    defaultConfigCandidates: [],
                    modelsConfigPath: path.join(root, "config", "models.yaml"),
                },
                fetchImpl: async () => {
                    throw new Error("network unavailable");
                },
            });

            expect(result.enabled).toBe(false);
            expect(result.reason).toContain("network unavailable");
            expect(config.security?.snapshot?.enabled).toBe(false);
        } finally {
            process.env.PATH = originalPath;
        }
    });

    it("uses powershell to extract zip assets on windows", () => {
        const extraction = getExtractionCommand(
            "win32",
            "C:/tmp/restic.zip",
            "C:/tmp/extract",
            "restic_0.18.1_windows_amd64.zip",
        );

        expect(extraction.command).toBe("powershell");
        expect(extraction.args.join(" ")).toContain("Expand-Archive");
    });
});
