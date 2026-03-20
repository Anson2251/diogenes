import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WorkspaceManager } from "../src/context/workspace";
import * as fs from "fs";
import * as path from "path";

describe("WorkspaceManager", () => {
    let workspace: WorkspaceManager;
    const testDir = path.join(__dirname, "test-workspace");
    const testFilePath = path.join(testDir, "test-file.txt");
    const multiLineFilePath = path.join(testDir, "multi-line.txt");
    const nestedDir = path.join(testDir, "nested");
    const nestedFilePath = path.join(nestedDir, "nested-file.txt");

    beforeEach(async () => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.mkdirSync(nestedDir, { recursive: true });
        fs.writeFileSync(testFilePath, "line1\nline2\nline3\nline4\nline5");
        fs.writeFileSync(multiLineFilePath, "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10");
        fs.writeFileSync(nestedFilePath, "nested content");
        workspace = new WorkspaceManager(testDir);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe("loadDirectory", () => {
        it("should load directory contents", async () => {
            const entries = await workspace.loadDirectory(".");

            expect(entries.length).toBeGreaterThanOrEqual(2);
            expect(entries.find(e => e.name === "test-file.txt")?.type).toBe("FILE");
            expect(entries.find(e => e.name === "multi-line.txt")?.type).toBe("FILE");
            expect(entries.find(e => e.name === "nested")?.type).toBe("DIR");
        });

        it("should sort directories before files", async () => {
            const entries = await workspace.loadDirectory(".");

            expect(entries[0].type).toBe("DIR");
            expect(entries[1].type).toBe("FILE");
        });

        it("should throw error for non-existent directory", async () => {
            await expect(workspace.loadDirectory("non-existent")).rejects.toThrow();
        });

        it("should throw error when path is outside workspace", async () => {
            await expect(workspace.loadDirectory("../outside")).rejects.toThrow();
        });

        it("should throw error when path is a file", async () => {
            await expect(workspace.loadDirectory("test-file.txt")).rejects.toThrow();
        });
    });

    describe("unloadDirectory", () => {
        it("should remove directory from workspace", async () => {
            await workspace.loadDirectory(".");
            const result = workspace.unloadDirectory(".");

            expect(result).toBe(true);
            expect(workspace.getDirectoryWorkspace()).toEqual({});
        });

        it("should return false for non-existent directory", () => {
            const result = workspace.unloadDirectory("non-existent");

            expect(result).toBe(false);
        });
    });

    describe("loadFile", () => {
        it("should load file content", async () => {
            const entry = await workspace.loadFile("test-file.txt");

            expect(entry.path).toBe("test-file.txt");
            expect(entry.totalLines).toBe(5);
            expect(entry.content).toHaveLength(5);
            expect(entry.ranges).toEqual([{ start: 1, end: 5 }]);
        });

        it("should load partial file content with line range", async () => {
            const entry = await workspace.loadFile("test-file.txt", 2, 3);

            expect(entry.content).toEqual(["line2", "line3"]);
            expect(entry.ranges).toEqual([{ start: 2, end: 3 }]);
        });

        it("should load single line", async () => {
            const entry = await workspace.loadFile("test-file.txt", 3, 3);

            expect(entry.content).toEqual(["line3"]);
            expect(entry.ranges).toEqual([{ start: 3, end: 3 }]);
        });

        it("should merge overlapping ranges", async () => {
            await workspace.loadFile("test-file.txt", 1, 2);
            const entry = await workspace.loadFile("test-file.txt", 3, 4);

            expect(entry.ranges.length).toBeLessThanOrEqual(2);
            expect(entry.content.length).toBe(4);
        });

        it("should throw error for non-existent file", async () => {
            await expect(workspace.loadFile("non-existent.txt")).rejects.toThrow();
        });

        it("should throw error when path is a directory", async () => {
            await expect(workspace.loadFile("nested")).rejects.toThrow();
        });

        it("should handle negative start line by clamping to 1", async () => {
            const entry = await workspace.loadFile("multi-line.txt", -5, 3);

            expect(entry.content).toHaveLength(3);
            expect(entry.ranges).toEqual([{ start: 1, end: 3 }]);
        });

        it("should handle out-of-bounds end line", async () => {
            const entry = await workspace.loadFile("test-file.txt", 1, 100);

            expect(entry.content).toHaveLength(5);
            expect(entry.ranges).toEqual([{ start: 1, end: 5 }]);
        });
    });

    describe("unloadFile", () => {
        it("should remove file from workspace", async () => {
            await workspace.loadFile("test-file.txt");
            const result = workspace.unloadFile("test-file.txt");

            expect(result).toBe(true);
            expect(workspace.getFileWorkspace()).toEqual({});
        });

        it("should return false for non-existent file", () => {
            const result = workspace.unloadFile("non-existent.txt");

            expect(result).toBe(false);
        });
    });

    describe("updateFileContent", () => {
        it("should update file content in workspace", async () => {
            await workspace.loadFile("test-file.txt");
            workspace.updateFileContent("test-file.txt", ["new line 1", "new line 2"]);

            const entry = workspace.getFileEntry("test-file.txt");
            expect(entry?.content).toEqual(["new line 1", "new line 2"]);
            expect(entry?.totalLines).toBe(2);
        });
    });

    describe("Todo Workspace Methods", () => {
        it("should set todo items", () => {
            workspace.setTodoItems([
                { text: "Task 1", state: "done" },
                { text: "Task 2", state: "pending" },
            ]);

            const todo = workspace.getTodoWorkspace();
            expect(todo.items).toHaveLength(2);
            expect(todo.items[0].text).toBe("Task 1");
            expect(todo.items[0].state).toBe("done");
        });

        it("should update todo item state", () => {
            workspace.setTodoItems([
                { text: "Task 1", state: "pending" },
            ]);

            const result = workspace.updateTodoItem("Task 1", "done");
            expect(result).toBe(true);

            const todo = workspace.getTodoWorkspace();
            expect(todo.items[0].state).toBe("done");
        });

        it("should return false when updating non-existent todo item", () => {
            const result = workspace.updateTodoItem("Non-existent", "done");

            expect(result).toBe(false);
        });

        it("should append todo items", () => {
            workspace.setTodoItems([{ text: "Task 1", state: "pending" }]);
            const count = workspace.appendTodoItems(["Task 2", "Task 3"]);

            expect(count).toBe(3);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items).toHaveLength(3);
        });
    });

    describe("getStatistics", () => {
        it("should return correct statistics", async () => {
            await workspace.loadDirectory(".");
            await workspace.loadFile("test-file.txt");

            const stats = workspace.getStatistics();

            expect(stats.directoryCount).toBe(1);
            expect(stats.fileCount).toBe(1);
            expect(stats.totalLines).toBe(5);
        });

        it("should return zero for empty workspace", () => {
            const stats = workspace.getStatistics();

            expect(stats.directoryCount).toBe(0);
            expect(stats.fileCount).toBe(0);
            expect(stats.totalLines).toBe(0);
        });
    });

    describe("clearAll", () => {
        it("should clear all workspaces", async () => {
            await workspace.loadDirectory(".");
            await workspace.loadFile("test-file.txt");
            workspace.setTodoItems([{ text: "Task", state: "pending" }]);

            workspace.clearAll();

            expect(workspace.getDirectoryWorkspace()).toEqual({});
            expect(workspace.getFileWorkspace()).toEqual({});
            expect(workspace.getTodoWorkspace().items).toHaveLength(0);
        });
    });

    describe("path handling", () => {
        it("should handle absolute paths", async () => {
            const entry = await workspace.loadFile(testFilePath);

            expect(entry.path).toBe(testFilePath);
        });

        it("should handle nested directories", async () => {
            const entry = await workspace.loadFile("nested/nested-file.txt");

            expect(entry.path).toBe("nested/nested-file.txt");
        });
    });
});
