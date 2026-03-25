import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceManager } from "../src/context/workspace";
import { FilePeekTool } from "../src/tools/file/file-peek";

describe("FilePeekTool", () => {
    const testDir = path.join(__dirname, "test-file-peek-workspace");
    const testFilePath = path.join(testDir, "peek.txt");
    let workspace: WorkspaceManager;
    let tool: FilePeekTool;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(
            testFilePath,
            Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
            "utf-8",
        );
        workspace = new WorkspaceManager(testDir);
        tool = new FilePeekTool(workspace);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it("should preview up to 30 lines by default without loading the file", async () => {
        const result = await tool.execute({ path: "peek.txt" });

        expect(result.success).toBe(true);
        expect(result.data?.preview_range).toEqual([1, 30]);
        expect(result.data?.lines).toHaveLength(30);
        expect(result.data?._note).toContain("not loaded into workspace");
        expect(workspace.getFileEntry("peek.txt")).toBeUndefined();
    });

    it("should clamp explicit end to a 30-line window from start", async () => {
        const result = await tool.execute({
            path: "peek.txt",
            start: 10,
            end: 100,
        });

        expect(result.success).toBe(true);
        expect(result.data?.preview_range).toEqual([10, 39]);
        expect(result.data?.lines).toHaveLength(30);
    });

    it("should return out of range when start exceeds total lines", async () => {
        const result = await tool.execute({
            path: "peek.txt",
            start: 999,
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("OUT_OF_RANGE");
        expect(result.error?.details?.total_lines).toBe(40);
    });

    it("should support absolute file paths inside the workspace", async () => {
        const result = await tool.execute({ path: testFilePath });

        expect(result.success).toBe(true);
        expect(result.data?.preview_range).toEqual([1, 30]);
    });
});
