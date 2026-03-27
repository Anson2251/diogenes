import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDiogenesAppData, CLEAR_APP_DATA_PASSPHRASE, parseArgs } from "../src/cli";
import * as appPaths from "../src/utils/app-paths";

describe("CLI reset option", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        vi.restoreAllMocks();
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("parses --clear-app-data", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes", "--clear-app-data"];

        try {
            const parsed = parseArgs();
            expect(parsed.options.clearAppData).toBe(true);
        } finally {
            process.argv = originalArgv;
        }
    });

    it("deletes config and local data after the correct passphrase", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-reset-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        await fs.mkdir(configDir, { recursive: true });
        await fs.mkdir(dataDir, { recursive: true });
        await fs.writeFile(path.join(configDir, "config.yaml"), "llm:\n  model: test\n", "utf8");
        await fs.writeFile(path.join(dataDir, "state.txt"), "data\n", "utf8");

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir: path.join(dataDir, "sessions"),
            defaultConfigCandidates: [],
        });

        const writes: string[] = [];
        const output = {
            write: (chunk: string) => {
                writes.push(chunk);
                return true;
            },
        } as unknown as NodeJS.WriteStream;

        const result = await clearDiogenesAppData(async () => CLEAR_APP_DATA_PASSPHRASE, output);

        expect(result).toBe(true);
        await expect(fs.access(configDir)).rejects.toThrow();
        await expect(fs.access(dataDir)).rejects.toThrow();
        expect(writes.join("")).toContain("delete Diogenes config and local storage");
    });

    it("cancels deletion when the passphrase does not match", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "cli-reset-cancel-"));
        tempDirs.push(root);

        const configDir = path.join(root, "config");
        const dataDir = path.join(root, "data");
        await fs.mkdir(configDir, { recursive: true });
        await fs.mkdir(dataDir, { recursive: true });

        vi.spyOn(appPaths, "resolveDiogenesAppPaths").mockReturnValue({
            homeDir: root,
            configDir,
            dataDir,
            sessionsDir: path.join(dataDir, "sessions"),
            defaultConfigCandidates: [],
        });

        const output = {
            write: () => true,
        } as unknown as NodeJS.WriteStream;

        const result = await clearDiogenesAppData(async () => "nope", output);

        expect(result).toBe(false);
        await expect(fs.access(configDir)).resolves.toBeUndefined();
        await expect(fs.access(dataDir)).resolves.toBeUndefined();
    });
});
