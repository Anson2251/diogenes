import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { createDiogenes } from "../src/create-diogenes";
import { DiogenesStateSerializer } from "../src/snapshot/state-serializer";

describe("DiogenesStateSerializer", () => {
    const tempDirs: string[] = [];

    afterEach(async () => {
        await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
        tempDirs.length = 0;
    });

    it("serializes workspace selections, todos, notepad, and message history", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "state-serializer-"));
        tempDirs.push(root);

        const workspaceDir = path.join(root, "workspace");
        const stateDir = path.join(root, "state");
        await fs.mkdir(workspaceDir, { recursive: true });
        await fs.writeFile(path.join(workspaceDir, "alpha.txt"), "a\nb\nc\n", "utf8");

        const diogenes = createDiogenes({
            security: {
                workspaceRoot: workspaceDir,
            },
        });
        const workspace = diogenes.getWorkspaceManager();
        await workspace.loadDirectory(".");
        await workspace.loadFile("alpha.txt", 2, 3);
        workspace.setTodoItems([
            { text: "first", state: "pending" },
            { text: "second", state: "done" },
        ]);
        workspace.setNotepadLines(["note one", "note two"]);

        const serializer = new DiogenesStateSerializer(stateDir);
        const { statePath } = await serializer.serialize({
            snapshotId: "snapshot-1",
            sessionId: "session-1",
            cwd: workspaceDir,
            stateProvider: {
                getWorkspaceManager: () => workspace,
                getMessageHistory: () => [
                    { role: "user", content: "please inspect" },
                    { role: "assistant", content: "working on it" },
                ],
                getCreatedAt: () => "2026-03-27T00:00:00.000Z",
                getUpdatedAt: () => "2026-03-27T00:05:00.000Z",
            },
        });

        const persisted = await serializer.deserialize(statePath);
        expect(persisted).toEqual({
            version: 1,
            kind: "diogenes_state",
            sessionId: "session-1",
            cwd: workspaceDir,
            createdAt: "2026-03-27T00:00:00.000Z",
            updatedAt: "2026-03-27T00:05:00.000Z",
            messageHistory: [
                { role: "user", content: "please inspect" },
                { role: "assistant", content: "working on it" },
            ],
            workspace: {
                loadedDirectories: ["."],
                loadedFiles: [
                    {
                        path: "alpha.txt",
                        ranges: [
                            { start: 2, end: 3 },
                        ],
                    },
                ],
                todo: [
                    { text: "first", state: "pending" },
                    { text: "second", state: "done" },
                ],
                notepad: ["note one", "note two"],
            },
        });
    });
});
