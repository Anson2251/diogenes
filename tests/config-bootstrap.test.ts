import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as appPaths from "../src/utils/app-paths";
import { ensureDefaultConfigFileSync } from "../src/utils/config-bootstrap";

describe("config bootstrap", () => {
    const tempDirs: string[] = [];

    afterEach(() => {
        vi.restoreAllMocks();
        for (const dir of tempDirs) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
        tempDirs.length = 0;
    });

    it("creates a default config.yaml on first run", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "config-bootstrap-"));
        tempDirs.push(home);

        const paths = appPaths.resolveDiogenesAppPaths({ homeDir: home });
        const configDir = paths.configDir;
        const dataDir = paths.dataDir;
        const sessionsDir = paths.sessionsDir;

        vi.spyOn(appPaths, "ensureDiogenesAppDirsSync").mockImplementation(() => {
            fs.mkdirSync(configDir, { recursive: true });
            fs.mkdirSync(dataDir, { recursive: true });
            fs.mkdirSync(sessionsDir, { recursive: true });
            return {
                homeDir: home,
                configDir,
                dataDir,
                sessionsDir,
                defaultConfigCandidates: [
                    path.join(configDir, "config.yaml"),
                    path.join(configDir, "config.yml"),
                    path.join(configDir, "config.json"),
                ],
                modelsConfigPath: path.join(configDir, "models.yaml"),
            };
        });
        vi.spyOn(appPaths, "findDefaultConfigFileSync").mockReturnValue(null);

        const configPath = ensureDefaultConfigFileSync();
        const content = fs.readFileSync(configPath, "utf8");

        expect(configPath).toBe(path.join(configDir, "config.yaml"));
        expect(content).toContain("# Diogenes default configuration");
        expect(content).toContain("llm:");
        expect(content).toContain("security:");
        expect(content).toContain("snapshot:");
        expect(content).toContain("enabled: true");
    });

    it("does not overwrite an existing managed config file", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "config-bootstrap-existing-"));
        tempDirs.push(home);

        const paths = appPaths.resolveDiogenesAppPaths({ homeDir: home });
        const configDir = paths.configDir;
        const dataDir = paths.dataDir;
        const sessionsDir = paths.sessionsDir;
        fs.mkdirSync(configDir, { recursive: true });
        const configPath = path.join(configDir, "config.yaml");
        fs.writeFileSync(configPath, "llm:\n  model: custom\n", "utf8");

        vi.spyOn(appPaths, "ensureDiogenesAppDirsSync").mockReturnValue({
            homeDir: home,
            configDir,
            dataDir,
            sessionsDir,
            defaultConfigCandidates: [
                path.join(configDir, "config.yaml"),
                path.join(configDir, "config.yml"),
                path.join(configDir, "config.json"),
            ],
            modelsConfigPath: path.join(configDir, "models.yaml"),
        });
        vi.spyOn(appPaths, "findDefaultConfigFileSync").mockReturnValue(configPath);

        const returnedPath = ensureDefaultConfigFileSync();
        const content = fs.readFileSync(configPath, "utf8");

        expect(returnedPath).toBe(configPath);
        expect(content).toBe("llm:\n  model: custom\n");
    });
});
