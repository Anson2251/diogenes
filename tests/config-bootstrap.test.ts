import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        vi.stubEnv("HOME", home);

        const configPath = ensureDefaultConfigFileSync();
        const content = fs.readFileSync(configPath, "utf8");

        expect(configPath).toBe(path.join(home, "Library", "Application Support", "diogenes", "config.yaml"));
        expect(content).toContain("# Diogenes default configuration");
        expect(content).toContain("llm:");
        expect(content).toContain("security:");
        expect(content).toContain("snapshot:");
        expect(content).toContain("enabled: true");
    });

    it("does not overwrite an existing managed config file", () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), "config-bootstrap-existing-"));
        tempDirs.push(home);
        vi.stubEnv("HOME", home);

        const configDir = path.join(home, "Library", "Application Support", "diogenes");
        fs.mkdirSync(configDir, { recursive: true });
        const configPath = path.join(configDir, "config.yaml");
        fs.writeFileSync(configPath, "llm:\n  model: custom\n", "utf8");

        const returnedPath = ensureDefaultConfigFileSync();
        const content = fs.readFileSync(configPath, "utf8");

        expect(returnedPath).toBe(configPath);
        expect(content).toBe("llm:\n  model: custom\n");
    });
});
