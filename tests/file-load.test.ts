import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileLoadTool } from "../src/tools/file/file-load";
import { WorkspaceManager } from "../src/context/workspace";
import * as fs from "fs";
import * as path from "path";

describe("FileLoadTool", () => {
    let workspace: WorkspaceManager;
    let tool: FileLoadTool;
    const testDir = path.join(__dirname, "test-file-load-workspace");
    const testFilePath = path.join(testDir, "test.txt");
    const multiLineFilePath = path.join(testDir, "multi-line.txt");
    const nestedFilePath = path.join(testDir, "nested.txt");

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(testFilePath, "single line");
        fs.writeFileSync(multiLineFilePath, "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10");
        fs.writeFileSync(nestedFilePath, "nested content");
        workspace = new WorkspaceManager(testDir);
        tool = new FileLoadTool(workspace);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("file");
            expect(def.name).toBe("load");
            expect(def.description).toBe("Load file content into workspace");
            expect(def.params.path.type).toBe("string");
            expect(def.params.start.optional).toBe(true);
            expect(def.params.end.optional).toBe(true);
        });
    });

    describe("execute", () => {
        it("should load file successfully", async () => {
            const result = await tool.execute({ path: "test.txt" });

            expect(result.success).toBe(true);
            expect(result.data?.total_lines).toBe(1);
            expect(result.data?.loaded_range).toEqual([[1, 1]]);
        });

        it("should load multi-line file", async () => {
            const result = await tool.execute({ path: "multi-line.txt" });

            expect(result.success).toBe(true);
            expect(result.data?.total_lines).toBe(10);
            expect(result.data?.loaded_range).toEqual([[1, 10]]);
        });

        it("should load partial file with start and end", async () => {
            const result = await tool.execute({
                path: "multi-line.txt",
                start: 2,
                end: 5,
            });

            expect(result.success).toBe(true);
            expect(result.data?.loaded_range).toEqual([[2, 5]]);
        });

        it("should load single line range", async () => {
            const result = await tool.execute({
                path: "multi-line.txt",
                start: 3,
                end: 3,
            });

            expect(result.success).toBe(true);
            expect(result.data?.loaded_range).toEqual([[3, 3]]);
        });

        it("should load file with only start parameter", async () => {
            const result = await tool.execute({
                path: "multi-line.txt",
                start: 5,
            });

            expect(result.success).toBe(true);
            expect(result.data?.loaded_range).toEqual([[5, 10]]);
        });

        it("should return error for non-existent file", async () => {
            const result = await tool.execute({ path: "non-existent.txt" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_ERROR");
        });

        it("should return error when path is a directory", async () => {
            const result = await tool.execute({ path: "nested" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_ERROR");
        });

        it("should add file to workspace", async () => {
            await tool.execute({ path: "test.txt" });

            const entry = workspace.getFileEntry("test.txt");
            expect(entry).toBeDefined();
            expect(entry?.content).toContain("single line");
        });

        it("should handle nested file paths", async () => {
            fs.mkdirSync(path.join(testDir, "subdir"), { recursive: true });
            fs.writeFileSync(path.join(testDir, "subdir", "nested.txt"), "nested content");

            const result = await tool.execute({ path: "subdir/nested.txt" });

            expect(result.success).toBe(true);
        });

        it("should handle path outside workspace", async () => {
            const result = await tool.execute({ path: "../outside.txt" });

            expect(result.success).toBe(false);
        });

        it("should clamp out-of-bounds start line to 1", async () => {
            const result = await tool.execute({
                path: "multi-line.txt",
                start: -5,
                end: 3,
            });

            expect(result.success).toBe(true);
            expect(result.data?.loaded_range).toEqual([[1, 3]]);
        });

        it("should clamp out-of-bounds end line to total lines", async () => {
            const result = await tool.execute({
                path: "multi-line.txt",
                start: 8,
                end: 100,
            });

            expect(result.success).toBe(true);
            expect(result.data?.loaded_range).toEqual([[8, 10]]);
        });
    });

    describe("validateParams", () => {
        it("should validate missing path parameter", () => {
            const result = tool.validateParams({});

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should validate non-string path parameter", () => {
            const result = tool.validateParams({ path: 123 });

            expect(result.valid).toBe(false);
        });

        it("should validate optional start parameter", () => {
            const result = tool.validateParams({
                path: "test.txt",
                start: 1,
            });

            expect(result.valid).toBe(true);
        });

        it("should validate optional end parameter", () => {
            const result = tool.validateParams({
                path: "test.txt",
                end: 10,
            });

            expect(result.valid).toBe(true);
        });

        it("should validate non-number start parameter", () => {
            const result = tool.validateParams({
                path: "test.txt",
                start: "not a number",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-number end parameter", () => {
            const result = tool.validateParams({
                path: "test.txt",
                end: "not a number",
            });

            expect(result.valid).toBe(false);
        });
    });
});
