import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileEditTool } from "../src/tools/file/file-edit";
import { WorkspaceManager } from "../src/context/workspace";
import * as fs from "fs";
import * as path from "path";

describe("FileEditTool", () => {
    let workspace: WorkspaceManager;
    let tool: FileEditTool;
    const testDir = path.join(__dirname, "test-file-edit-workspace");
    const testFilePath = path.join(testDir, "test.txt");
    const multiLineFilePath = path.join(testDir, "multi-line.txt");

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(testFilePath, "Hello World\n");
        fs.writeFileSync(
            multiLineFilePath,
            "line 1\nline 2\nline 3\nline 4\nline 5\n",
        );
        workspace = new WorkspaceManager(testDir);
        tool = new FileEditTool(workspace);
    });

    afterEach(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("file");
            expect(def.name).toBe("edit");
            expect(def.description).toContain("Apply structured edits to a file");
            expect(def.params.path.type).toBe("string");
            expect(def.params.edits.type).toBe("array");
            expect(def.params.options.optional).toBe(true);
        });
    });

    describe("execute - error handling", () => {
        it("should return error for non-existent file", async () => {
            const result = await tool.execute({
                path: path.join(testDir, "non-existent.txt"),
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "text",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["new content"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_EDIT_ERROR");
        });

        it("should return error for directory path", async () => {
            const result = await tool.execute({
                path: testDir,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "text",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["new content"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_EDIT_ERROR");
        });

        it("should reject path outside workspace", async () => {
            const result = await tool.execute({
                path: path.join(__dirname, "outside.txt"),
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "text",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["new content"],
                    },
                ],
            });

            expect(result.success).toBe(false);
        });

        it("should return error when anchor not found", async () => {
            const result = await tool.execute({
                path: testFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "non-existent-text-xyz",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["new content"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it("should handle atomic: false with some invalid edits", async () => {
            const result = await tool.execute({
                path: testFilePath,
                options: { atomic: false },
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "non-existent-text-xyz",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["should not apply"],
                    },
                ],
            });

            // With atomic: false, the result structure is different
            expect(result.data?.applied).toBeDefined();
            expect(Array.isArray(result.data?.applied)).toBe(true);
        });
    });

    describe("validateParams", () => {
        it("should validate missing path parameter", () => {
            const result = tool.validateParams({
                edits: [],
            });

            expect(result.valid).toBe(false);
        });

        it("should validate missing edits parameter", () => {
            const result = tool.validateParams({
                path: testFilePath,
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-array edits parameter", () => {
            const result = tool.validateParams({
                path: testFilePath,
                edits: "not an array",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate valid parameters", () => {
            const result = tool.validateParams({
                path: testFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "text",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["new content"],
                    },
                ],
            });

            expect(result.valid).toBe(true);
        });
    });
});
