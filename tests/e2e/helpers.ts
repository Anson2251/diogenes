import { execFileSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { resolveDiogenesAppPaths } from "../../src/utils/app-paths";

export const BUNDLE_CLI = path.resolve(__dirname, "../../bundle/cli.cjs");

export interface TestContext {
    homeDir: string;
    env: NodeJS.ProcessEnv;
    configDir: string;
    dataDir: string;
}

export async function setupTestHome(): Promise<TestContext> {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "diogenes-e2e-"));
    const fakeResticPath = await createFakeResticBinary(homeDir);
    const xdgConfigHome = path.join(homeDir, ".config");
    const xdgDataHome = path.join(homeDir, ".local", "share");
    const appData = path.join(homeDir, "AppData", "Roaming");
    const localAppData = path.join(homeDir, "AppData", "Local");
    const env = {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        XDG_CONFIG_HOME: xdgConfigHome,
        XDG_DATA_HOME: xdgDataHome,
        APPDATA: appData,
        LOCALAPPDATA: localAppData,
        DIOGENES_RESTIC_BINARY: fakeResticPath,
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "",
    };
    const appPaths = resolveDiogenesAppPaths({
        platform: process.platform,
        env,
        homeDir,
    });
    return { homeDir, env, configDir: appPaths.configDir, dataDir: appPaths.dataDir };
}

export async function teardownTestHome(homeDir: string): Promise<void> {
    await fs.rm(homeDir, { recursive: true, force: true });
}

async function createFakeResticBinary(homeDir: string): Promise<string> {
    if (process.platform === "win32") {
        const fakeResticPath = path.join(homeDir, "fake-restic.cmd");
        await fs.writeFile(fakeResticPath, "@echo off\r\nexit /b 0\r\n", "utf-8");
        return fakeResticPath;
    }

    const fakeResticPath = path.join(homeDir, "fake-restic");
    await fs.writeFile(fakeResticPath, "#!/bin/sh\nexit 0\n", "utf-8");
    await fs.chmod(fakeResticPath, 0o755);
    return fakeResticPath;
}

export function runCLI(
    args: string[],
    env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; exitCode: number } {
    try {
        const stdout = execFileSync("node", [BUNDLE_CLI, ...args], {
            env,
            encoding: "utf-8",
            timeout: 30000,
        });
        return { stdout, stderr: "", exitCode: 0 };
    } catch (error: unknown) {
        const execError = error as {
            stdout?: string | Buffer;
            stderr?: string | Buffer;
            status?: number;
        };
        return {
            stdout:
                typeof execError.stdout === "string"
                    ? execError.stdout
                    : execError.stdout?.toString("utf-8") || "",
            stderr:
                typeof execError.stderr === "string"
                    ? execError.stderr
                    : execError.stderr?.toString("utf-8") || "",
            exitCode: execError.status ?? 1,
        };
    }
}
