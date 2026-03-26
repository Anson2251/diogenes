import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { WorkspaceManager } from "../src/context/workspace";
import { FilePeekTool } from "../src/tools/file/file-peek";

describe("FilePeekTool", () => {
    const testDir = path.join(__dirname, "test-file-peek-workspace");
    const testFilePath = path.join(testDir, "peek.txt");
    const ignoredFilePath = path.join(testDir, "secret.txt");
    const ignoredDirPath = path.join(testDir, "ignored-dir");
    const ignoredNestedFilePath = path.join(ignoredDirPath, "hidden.txt");
    let workspace: WorkspaceManager;
    let tool: FilePeekTool;

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.mkdirSync(ignoredDirPath, { recursive: true });
        fs.writeFileSync(
            testFilePath,
            Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join("\n"),
            "utf-8",
        );
        fs.writeFileSync(ignoredFilePath, "top secret", "utf-8");
        fs.writeFileSync(ignoredNestedFilePath, "hidden content", "utf-8");
        fs.writeFileSync(
            path.join(testDir, ".gitignore"),
            "secret.txt\nignored-dir/\n",
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

    it("should reject files listed in .gitignore", async () => {
        const result = await tool.execute({ path: "secret.txt" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_ERROR");
        expect(result.error?.message).toContain("ignored by .gitignore");
    });

    it("should reject files inside ignored directories", async () => {
        const result = await tool.execute({ path: "ignored-dir/hidden.txt" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_ERROR");
        expect(result.error?.message).toContain("ignored by .gitignore");
    });

    it("should format peek results for LLM consumption", async () => {
        const result = await tool.execute({
            path: "peek.txt",
            start: 2,
            end: 4,
        });

        expect(result.success).toBe(true);
        expect(
            tool.formatResultForLLM(
                {
                    tool: "file.peek",
                    params: { path: "peek.txt", start: 2, end: 4 },
                },
                result,
            ),
        ).toContain("Peeked peek.txt");
        expect(
            tool.formatResultForLLM(
                {
                    tool: "file.peek",
                    params: { path: "peek.txt", start: 2, end: 4 },
                },
                result,
            ),
        ).toContain("Lines 2-4 of 40");
        expect(
            tool.formatResultForLLM(
                {
                    tool: "file.peek",
                    params: { path: "peek.txt", start: 2, end: 4 },
                },
                result,
            ),
        ).toContain("2 | line 2");
        expect(
            tool.formatResultForLLM(
                {
                    tool: "file.peek",
                    params: { path: "peek.txt", start: 2, end: 4 },
                },
                result,
            ),
        ).toContain("Peeked content not loaded into workspace.");
    });
});
