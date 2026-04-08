import { execSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

export const BUNDLE_CLI = path.resolve(__dirname, "../../bundle/cli.cjs");
export const BUNDLE_ACP = path.resolve(__dirname, "../../bundle/acp-server.cjs");

export interface TestContext {
    homeDir: string;
    env: NodeJS.ProcessEnv;
}

export async function setupTestHome(): Promise<TestContext> {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "diogenes-e2e-"));
    const env = {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        OPENROUTER_API_KEY: "",
    };
    return { homeDir, env };
}

export async function teardownTestHome(homeDir: string): Promise<void> {
    await fs.rm(homeDir, { recursive: true, force: true });
}

export function escapeArg(arg: string): string {
    if (arg.includes(" ") || arg.includes("'") || arg.includes('"')) {
        return `"${arg.replace(/"/g, '\\"')}"`;
    }
    return arg;
}

export function runCLI(
    args: string[],
    env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; exitCode: number } {
    try {
        const escapedArgs = args.map(escapeArg).join(" ");
        const stdout = execSync(`node ${BUNDLE_CLI} ${escapedArgs}`, {
            env,
            encoding: "utf-8",
            timeout: 30000,
        });
        return { stdout, stderr: "", exitCode: 0 };
    } catch (error: unknown) {
        const execError = error as { stdout?: string; stderr?: string; status?: number };
        return {
            stdout: execError.stdout || "",
            stderr: execError.stderr || "",
            exitCode: execError.status ?? 1,
        };
    }
}

export function runACP(
    args: string[],
    env: NodeJS.ProcessEnv,
): { stdout: string; stderr: string; exitCode: number } {
    try {
        const escapedArgs = args.map(escapeArg).join(" ");
        const stdout = execSync(`node ${BUNDLE_ACP} ${escapedArgs}`, {
            env,
            encoding: "utf-8",
            timeout: 30000,
        });
        return { stdout, stderr: "", exitCode: 0 };
    } catch (error: unknown) {
        const execError = error as { stdout?: string; stderr?: string; status?: number };
        return {
            stdout: execError.stdout || "",
            stderr: execError.stderr || "",
            exitCode: execError.status ?? 1,
        };
    }
}
