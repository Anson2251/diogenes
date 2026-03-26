import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { ResticClient } from "../src/utils/restic";

const hasRestic = spawnSync("restic", ["version"], {
    stdio: "ignore",
}).status === 0;

const describeRestic = hasRestic ? describe : describe.skip;

describeRestic("ResticClient integration", () => {
    const tempDirs: string[] = [];

    async function makeTempDir(): Promise<string> {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "restic-integration-"));
        tempDirs.push(dir);
        return dir;
    }

    afterAll(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    });

    it("runs init, backup, snapshots, and restore against a real restic binary", async () => {
        const rootDir = await makeTempDir();
        const repoDir = path.join(rootDir, "repo");
        const passwordFile = path.join(rootDir, "password.txt");
        const workspaceDir = path.join(rootDir, "workspace");
        const restoreDir = path.join(rootDir, "restore");

        await fs.mkdir(repoDir, { recursive: true });
        await fs.mkdir(workspaceDir, { recursive: true });
        await fs.mkdir(path.join(workspaceDir, "nested"), { recursive: true });
        await fs.writeFile(passwordFile, "integration-secret\n", "utf8");
        await fs.writeFile(path.join(workspaceDir, "hello.txt"), "hello restic\n", "utf8");
        await fs.writeFile(path.join(workspaceDir, "nested", "data.json"), JSON.stringify({ ok: true }), "utf8");

        const client = new ResticClient({
            repository: repoDir,
            passwordFile,
            timeoutMs: 30_000,
        });

        await client.initRepo();

        const backup = await client.backup({
            cwd: rootDir,
            paths: ["workspace"],
            tags: ["integration", "smoke"],
            skipIfUnchanged: false,
        });

        expect(backup.snapshotId).toMatch(/^[a-f0-9]+$/i);

        const snapshots = await client.snapshots({
            tags: ["integration"],
        });

        expect(snapshots.length).toBeGreaterThan(0);
        expect(snapshots.some((snapshot) => snapshot.id === backup.snapshotId)).toBe(true);

        await client.restore({
            snapshotId: backup.snapshotId,
            target: restoreDir,
        });

        const restoredHello = await fs.readFile(path.join(restoreDir, "workspace", "hello.txt"), "utf8");
        const restoredJson = await fs.readFile(path.join(restoreDir, "workspace", "nested", "data.json"), "utf8");

        expect(restoredHello).toBe("hello restic\n");
        expect(JSON.parse(restoredJson)).toEqual({ ok: true });
    }, 30_000);

    it("supports listing snapshots as JSON after multiple backups", async () => {
        const rootDir = await makeTempDir();
        const repoDir = path.join(rootDir, "repo");
        const passwordFile = path.join(rootDir, "password.txt");
        const workspaceDir = path.join(rootDir, "workspace");

        await fs.mkdir(repoDir, { recursive: true });
        await fs.mkdir(workspaceDir, { recursive: true });
        await fs.writeFile(passwordFile, "integration-secret\n", "utf8");
        await fs.writeFile(path.join(workspaceDir, "state.txt"), "v1\n", "utf8");

        const client = new ResticClient({
            repository: repoDir,
            passwordFile,
            timeoutMs: 30_000,
        });

        await client.initRepo();
        await client.backup({ cwd: rootDir, paths: ["workspace"], tags: ["multi"] });

        await fs.writeFile(path.join(workspaceDir, "state.txt"), "v2\n", "utf8");
        await client.backup({ cwd: rootDir, paths: ["workspace"], tags: ["multi"] });

        const snapshots = await client.snapshots({ tags: ["multi"] });

        expect(snapshots.length).toBeGreaterThanOrEqual(2);
        expect(snapshots.every((snapshot) => snapshot.tags?.includes("multi"))).toBe(true);
    }, 30_000);
});

describe.skipIf(hasRestic)("ResticClient integration skip notice", () => {
    it("skips integration tests when restic is unavailable", () => {
        expect(hasRestic).toBe(false);
    });
});
