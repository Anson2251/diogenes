import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WorkspaceManager } from "../src/context/workspace";
import { FileRemoveTool } from "../src/tools/file/file-remove";

describe("FileRemoveTool", () => {
    let workspace: WorkspaceManager;
    let tool: FileRemoveTool;
    const testDir = path.join(__dirname, "test-temp");
    const testFile = path.join(testDir, "test.txt");

    beforeEach(async () => {
        // Create test directory
        await fs.promises.mkdir(testDir, { recursive: true });

        // Create workspace with test directory as root
        workspace = new WorkspaceManager(testDir);
        tool = new FileRemoveTool(workspace);
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    it("should delete an existing file", async () => {
        // Create a test file
        await fs.promises.writeFile(testFile, "test content", "utf-8");

        // Delete the file
        const result = await tool.run({ path: "test.txt" });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
            path: "test.txt",
            existed: true,
            workspace_removed: false, // File wasn't loaded in workspace
        });

        // Verify file is deleted
        await expect(fs.promises.stat(testFile)).rejects.toThrow();
    });

    it("should fail when file doesn't exist and force is false", async () => {
        const result = await tool.run({ path: "nonexistent.txt", force: false });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_NOT_FOUND");
    });

    it("should succeed when file doesn't exist and force is true", async () => {
        const result = await tool.run({ path: "nonexistent.txt", force: true });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
            path: "nonexistent.txt",
            existed: false,
            workspace_removed: false,
        });
    });

    it("should remove file from workspace if loaded", async () => {
        // Create and load file into workspace
        await fs.promises.writeFile(testFile, "test content", "utf-8");
        await workspace.loadFile("test.txt");
        // Verify file is loaded in workspace
        expect(workspace.getFileEntry("test.txt")).toBeDefined();

        // Delete the file
        const result = await tool.run({ path: "test.txt" });

        expect(result.success).toBe(true);
        expect(result.data).toMatchObject({
            path: "test.txt",
            existed: true,
            workspace_removed: true,
        });

        // Verify file is not in workspace
        expect(workspace.getFileEntry("test.txt")).toBeUndefined();
    });

    it("should reject paths outside workspace", async () => {
        const result = await tool.run({ path: "../outside.txt" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_REMOVE_ERROR");
    });

    it("should fail when trying to remove a directory", async () => {
        // Create a file and open a read stream to keep it "in use"
        await fs.promises.writeFile(testFile, "test content", "utf-8");

        // On Unix-like systems, we can't easily simulate "file in use" for deletion
        // So we'll test with a directory instead (which should fail)
        const testDirPath = path.join(testDir, "subdir");
        await fs.promises.mkdir(testDirPath, { recursive: true });

        const result = await tool.run({ path: "subdir" });

        // Should fail because it's a directory, not a file
        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("FILE_REMOVE_ERROR");
    });
});
