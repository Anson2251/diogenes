import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";

import { ResticClient, ResticCommandError, ResticParseError } from "../src/utils/restic";

async function createTempDir(): Promise<string> {
    return fs.mkdtemp(path.join(os.tmpdir(), "restic-test-"));
}

async function readInvocationLog(logPath: string): Promise<Array<Record<string, any>>> {
    const content = await fs.readFile(logPath, "utf8");
    return content
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

describe("ResticClient", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    async function createClient(extraEnv: NodeJS.ProcessEnv = {}) {
        const tempDir = await createTempDir();
        tempDirs.push(tempDir);

        const logPath = path.join(tempDir, "invocations.log");
        const fixturePath = path.join(process.cwd(), "tests/fixtures/fake-restic.cjs");

        const client = new ResticClient({
            binary: process.execPath,
            binaryArgs: [fixturePath],
            repository: path.join(tempDir, "repo"),
            passwordFile: path.join(tempDir, "password.txt"),
            env: {
                FAKE_RESTIC_LOG: logPath,
                ...extraEnv,
            },
        });

        await fs.writeFile(path.join(tempDir, "password.txt"), "secret\n");

        return {
            client,
            logPath,
            tempDir,
        };
    }

    it("initializes a repository using environment-based credentials", async () => {
        const { client, logPath, tempDir } = await createClient();

        await client.initRepo();

        const entries = await readInvocationLog(logPath);
        expect(entries).toHaveLength(1);
        expect(entries[0].args).toEqual(["init"]);
        expect(entries[0].env.RESTIC_REPOSITORY).toBe(path.join(tempDir, "repo"));
        expect(entries[0].env.RESTIC_PASSWORD_FILE).toBe(path.join(tempDir, "password.txt"));
        expect(entries[0].env.RESTIC_PASSWORD).toBeUndefined();
    });

    it("creates backups asynchronously and returns the parsed snapshot id", async () => {
        const { client } = await createClient({ FAKE_RESTIC_DELAY_MS: "40" });
        let timerFired = false;

        const backupPromise = client.backup({
            paths: ["/workspace"],
            tags: ["before_prompt", "turn_1"],
            excludes: ["node_modules", "*.log"],
            skipIfUnchanged: true,
        });

        setTimeout(() => {
            timerFired = true;
        }, 5);

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(timerFired).toBe(true);

        const result = await backupPromise;
        expect(result.snapshotId).toBe("abc123def456");
        expect(result.rawOutput).toContain("summary");
    });

    it("builds snapshot listing arguments and parses json output", async () => {
        const { client, logPath } = await createClient();

        const snapshots = await client.snapshots({
            tags: ["before_prompt"],
            paths: ["/workspace"],
            host: "test-host",
        });

        expect(snapshots).toHaveLength(1);
        expect(snapshots[0]?.id).toBe("abc123def456");

        const entries = await readInvocationLog(logPath);
        expect(entries[0].args).toEqual([
            "snapshots",
            "--json",
            "--tag",
            "before_prompt",
            "--path",
            "/workspace",
            "--host",
            "test-host",
        ]);
    });

    it("builds restore arguments without using a shell", async () => {
        const { client, logPath, tempDir } = await createClient();
        const target = path.join(tempDir, "restore-target");

        await client.restore({
            snapshotId: "latest",
            target,
            includes: ["/src"],
            excludes: ["*.tmp"],
            delete: true,
            dryRun: true,
        });

        const entries = await readInvocationLog(logPath);
        expect(entries[0].args).toEqual([
            "restore",
            "latest",
            "--target",
            target,
            "--include",
            "/src",
            "--exclude",
            "*.tmp",
            "--delete",
            "--dry-run",
        ]);
    });

    it("passes potentially dangerous input as a literal argument instead of executing it", async () => {
        const { client, logPath, tempDir } = await createClient();
        const injectedPath = `safe;touch ${path.join(tempDir, "pwned")}`;

        await client.backup({
            paths: [injectedPath],
        });

        const entries = await readInvocationLog(logPath);
        expect(entries[0].args).toContain(injectedPath);

        await expect(fs.access(path.join(tempDir, "pwned"))).rejects.toThrow();
    });

    it("rejects with rich command details when restic fails", async () => {
        const { client } = await createClient({
            FAKE_RESTIC_FAIL_SUBCOMMAND: "backup",
            FAKE_RESTIC_FAIL_CODE: "3",
        });

        await expect(client.backup({ paths: ["/workspace"] })).rejects.toMatchObject({
            name: "ResticCommandError",
            exitCode: 3,
            kind: "exit",
            phase: "backup",
        });

        try {
            await client.backup({ paths: ["/workspace"] });
        } catch (error) {
            expect(error).toBeInstanceOf(ResticCommandError);
            const resticError = error as ResticCommandError;
            expect(resticError.stderr).toContain("forced failure for backup");
            expect(resticError.args).toEqual(["backup", "--json", "/workspace"]);
            expect(resticError.kind).toBe("exit");
            expect(resticError.phase).toBe("backup");
        }
    });

    it("rejects timed out commands", async () => {
        const { client } = await createClient({ FAKE_RESTIC_DELAY_MS: "100" });
        const fastClient = new ResticClient({
            binary: process.execPath,
            binaryArgs: [path.join(process.cwd(), "tests/fixtures/fake-restic.cjs")],
            repository: "/tmp/repo",
            password: "secret",
            timeoutMs: 20,
            env: {
                FAKE_RESTIC_DELAY_MS: "100",
            },
        });

        await expect(fastClient.initRepo()).rejects.toMatchObject({
            name: "ResticCommandError",
            exitCode: -1,
            message: "restic command timed out",
            kind: "timeout",
            phase: "init",
        });

        await client.initRepo();
    });

    it("raises a parse error when snapshots output is malformed", async () => {
        const { client } = await createClient({
            FAKE_RESTIC_MALFORMED_SUBCOMMAND: "snapshots",
        });

        await expect(client.snapshots()).rejects.toBeInstanceOf(ResticParseError);
    });

    it("raises a parse error when backup summary is missing", async () => {
        const { client } = await createClient({
            FAKE_RESTIC_MALFORMED_SUBCOMMAND: "backup",
        });

        await expect(client.backup({ paths: ["/workspace"] })).rejects.toBeInstanceOf(
            ResticParseError,
        );
    });

    it("rejects conflicting password sources early", async () => {
        expect(
            () =>
                new ResticClient({
                    password: "secret",
                    passwordFile: "/tmp/password.txt",
                }),
        ).toThrow("Only one restic password source can be configured at a time");
    });
});
