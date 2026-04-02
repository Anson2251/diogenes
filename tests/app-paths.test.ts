import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import {
    ensureDiogenesAppDirs,
    findDefaultConfigFileSync,
    getDefaultSessionsStorageRoot,
    getDefaultTreeSitterStorageRoot,
    resolveDiogenesAppPaths,
} from "../src/utils/app-paths";

describe("app paths", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("resolves linux paths from XDG directories", () => {
        const result = resolveDiogenesAppPaths({
            platform: "linux",
            homeDir: "/home/alice",
            env: {
                XDG_CONFIG_HOME: "/xdg/config",
                XDG_DATA_HOME: "/xdg/data",
            },
        });

        expect(result.configDir).toBe(path.join("/xdg/config", "diogenes"));
        expect(result.sessionsDir).toBe(path.join("/xdg/data", "diogenes", "sessions"));
    });

    it("resolves macOS paths under Application Support", () => {
        const result = resolveDiogenesAppPaths({
            platform: "darwin",
            homeDir: "/Users/alice",
            env: {},
        });

        expect(result.configDir).toBe(
            path.join("/Users/alice", "Library", "Application Support", "diogenes"),
        );
        expect(result.sessionsDir).toBe(
            path.join("/Users/alice", "Library", "Application Support", "diogenes", "sessions"),
        );
    });

    it("resolves windows paths from APPDATA and LOCALAPPDATA", () => {
        const result = resolveDiogenesAppPaths({
            platform: "win32",
            homeDir: "C:\\Users\\Alice",
            env: {
                APPDATA: "C:\\Users\\Alice\\AppData\\Roaming",
                LOCALAPPDATA: "C:\\Users\\Alice\\AppData\\Local",
            },
        });

        expect(result.configDir).toBe(path.join("C:\\Users\\Alice\\AppData\\Roaming", "diogenes"));
        expect(result.sessionsDir).toBe(
            path.join("C:\\Users\\Alice\\AppData\\Local", "diogenes", "sessions"),
        );
    });

    it("creates config and snapshot directories on first run", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-paths-"));
        tempDirs.push(root);

        const paths = await ensureDiogenesAppDirs({
            platform: "linux",
            homeDir: root,
            env: {
                XDG_CONFIG_HOME: path.join(root, "config-root"),
                XDG_DATA_HOME: path.join(root, "data-root"),
            },
        });

        await expect(fs.access(paths.configDir)).resolves.toBeUndefined();
        await expect(fs.access(paths.dataDir)).resolves.toBeUndefined();
        await expect(fs.access(paths.sessionsDir)).resolves.toBeUndefined();
        await expect(fs.access(paths.treeSitterDir)).resolves.toBeUndefined();
        await expect(fs.access(paths.treeSitterGrammarsDir)).resolves.toBeUndefined();
    });

    it("finds the default config file when present", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "app-config-"));
        tempDirs.push(root);

        const configHome = path.join(root, "config-home");
        const paths = await ensureDiogenesAppDirs({
            platform: "linux",
            homeDir: root,
            env: {
                XDG_CONFIG_HOME: configHome,
                XDG_DATA_HOME: path.join(root, "data-home"),
            },
        });
        const configPath = path.join(paths.configDir, "config.yaml");
        await fs.writeFile(configPath, "llm:\n  model: test\n", "utf8");

        const found = findDefaultConfigFileSync({
            platform: "linux",
            homeDir: root,
            env: {
                XDG_CONFIG_HOME: configHome,
                XDG_DATA_HOME: path.join(root, "data-home"),
            },
        });

        expect(found).toBe(configPath);
    });

    it("returns the platform snapshot storage root", () => {
        const storageRoot = getDefaultSessionsStorageRoot({
            platform: "linux",
            homeDir: "/home/alice",
            env: {
                XDG_DATA_HOME: "/xdg/data",
            },
        });

        expect(storageRoot).toBe(path.join("/xdg/data", "diogenes", "sessions"));
    });

    it("returns the platform tree-sitter storage root", () => {
        const storageRoot = getDefaultTreeSitterStorageRoot({
            platform: "linux",
            homeDir: "/home/alice",
            env: {
                XDG_DATA_HOME: "/xdg/data",
            },
        });

        expect(storageRoot).toBe(path.join("/xdg/data", "diogenes", "tree-sitter"));
    });
});
