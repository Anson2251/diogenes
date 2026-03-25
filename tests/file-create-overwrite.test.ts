import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceManager } from "../src/context/workspace";
import { FileCreateTool } from "../src/tools/file/file-create";
import { FileOverwriteTool } from "../src/tools/file/file-overwrite";

describe("FileCreateTool and FileOverwriteTool", () => {
    const testDir = path.join(__dirname, "test-file-write-workspace");
    const existingFilePath = path.join(testDir, "existing.txt");
    let workspace: WorkspaceManager;
    let createTool: FileCreateTool;
    let overwriteTool: FileOverwriteTool;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(existingFilePath, "old line 1\nold line 2\n", "utf-8");
        workspace = new WorkspaceManager(testDir);
        createTool = new FileCreateTool(workspace);
        overwriteTool = new FileOverwriteTool(workspace);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should create a new file with array content", async () => {
        const result = await createTool.execute({
            path: "created.txt",
            content: ["line 1", "line 2"],
        });

        expect(result.success).toBe(true);
        expect(fs.readFileSync(path.join(testDir, "created.txt"), "utf-8")).toBe("line 1\nline 2");
    });

    it("should reject file.create when file already exists", async () => {
        const result = await createTool.execute({
            path: "existing.txt",
            content: ["new content"],
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_EXISTS");
        expect(fs.readFileSync(existingFilePath, "utf-8")).toBe("old line 1\nold line 2\n");
    });

    it("should overwrite an existing file and refresh loaded workspace ranges", async () => {
        await workspace.loadFile("existing.txt", 1, 2);

        const result = await overwriteTool.execute({
            path: "existing.txt",
            content: ["new line 1", "new line 2", "new line 3"],
        });

        expect(result.success).toBe(true);
        expect(fs.readFileSync(existingFilePath, "utf-8")).toBe("new line 1\nnew line 2\nnew line 3");
        expect(result.data?.workspace_update).toBeDefined();

        const entry = workspace.getFileEntry("existing.txt");
        expect(entry?.content).toEqual(["new line 1", "new line 2"]);
        expect(entry?.ranges).toEqual([{ start: 1, end: 2 }]);
    });

    it("should reject file.overwrite when file does not exist", async () => {
        const result = await overwriteTool.execute({
            path: "missing.txt",
            content: ["new content"],
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_OVERWRITE_ERROR");
    });
});
