import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DirListTool } from "../src/tools/dir/dir-list";
import { WorkspaceManager } from "../src/context/workspace";
import * as fs from "fs";
import * as path from "path";

describe("DirListTool", () => {
    let workspace: WorkspaceManager;
    let tool: DirListTool;
    const testDir = path.join(__dirname, "test-dir-workspace");
    const subDir = path.join(testDir, "subdir");
    const testFile = path.join(testDir, "test.txt");

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(testFile, "test content");
        fs.writeFileSync(path.join(subDir, "nested.txt"), "nested content");
        workspace = new WorkspaceManager(testDir);
        tool = new DirListTool(workspace);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("dir");
            expect(def.name).toBe("list");
            expect(def.description).toBe("List directory contents and load into workspace");
            expect(def.params.path.type).toBe("string");
            expect(def.params.path.optional).toBeUndefined();
        });
    });

    describe("execute", () => {
        it("should list directory contents successfully", async () => {
            const result = await tool.execute({ path: "." });

            expect(result.success).toBe(true);
            expect(result.data?.count).toBe(2);
            expect(result.data?.files).toBe(1);
            expect(result.data?.dirs).toBe(1);
            const entries = workspace.getDirectoryWorkspace()["."];
            expect(entries).toBeDefined();
            expect(entries.length).toBe(2);
        });

        it("should list subdirectory contents", async () => {
            const result = await tool.execute({ path: "subdir" });

            expect(result.success).toBe(true);
            const entries = workspace.getDirectoryWorkspace()["subdir"];
            expect(entries).toHaveLength(1);
            expect(entries[0].name).toBe("nested.txt");
            expect(entries[0].type).toBe("FILE");
        });

        it("should return error for non-existent directory", async () => {
            const result = await tool.execute({ path: "non-existent" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PATH_NOT_FOUND");
        });

        it("should return error when path is a file", async () => {
            const result = await tool.execute({ path: "test.txt" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PATH_NOT_FOUND");
        });

        it("should handle path outside workspace", async () => {
            const result = await tool.execute({ path: "../outside" });

            expect(result.success).toBe(false);
        });

        it("should add directory to workspace", async () => {
            await tool.execute({ path: "." });

            const workspaceState = workspace.getDirectoryWorkspace();
            expect(Object.keys(workspaceState)).toContain(".");
        });

        it("should sort directories before files", async () => {
            fs.writeFileSync(path.join(testDir, "a-file.txt"), "content");
            fs.mkdirSync(path.join(testDir, "b-dir"), { recursive: true });

            await tool.execute({ path: "." });

            const entries = workspace.getDirectoryWorkspace()["."];
            expect(entries[0].type).toBe("DIR");
            expect(entries[0].name).toBe("b-dir");
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

        it("should validate valid path parameter", () => {
            const result = tool.validateParams({ path: "." });

            expect(result.valid).toBe(true);
        });
    });
});
