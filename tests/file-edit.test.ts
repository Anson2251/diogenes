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
    const duplicateFilePath = path.join(testDir, "duplicate.txt");
    const fullDocFilePath = path.join(testDir, "full-doc.txt");

    beforeEach(() => {
        fs.mkdirSync(testDir, { recursive: true });
        fs.writeFileSync(testFilePath, "Hello World\n");
        fs.writeFileSync(
            multiLineFilePath,
            "line 1\nline 2\nline 3\nline 4\nline 5\n",
        );
        fs.writeFileSync(
            duplicateFilePath,
            "alpha\nrepeat\nbeta\nrepeat\ngamma\n",
        );
        fs.writeFileSync(
            fullDocFilePath,
            "# Diogenes\n\nA minimal LLM-controlled agent framework with explicit context management, implemented in TypeScript.\n\n## License\n\nDiogenes is released under the MIT License. See the [LICENSE](LICENSE) file for details.\n\nCopyright (c) 2024\n\n",
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

    describe("execute - multiple edits", () => {
        it("should apply multiple edits in sequence", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "line 1",
                                before: [],
                                after: ["line 2"],
                            },
                        },
                        content: ["LINE ONE"],
                    },
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 3,
                                text: "line 3",
                                before: ["line 2"],
                                after: ["line 4"],
                            },
                        },
                        content: ["LINE THREE"],
                    },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.data?.applied).toHaveLength(2);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toContain("LINE ONE");
            expect(content).toContain("LINE THREE");
        });

        it("should apply insert_before and insert_after in sequence", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                edits: [
                    {
                        mode: "insert_before",
                        anchor: {
                            start: {
                                line: 1,
                                text: "line 1",
                                before: [],
                                after: ["line 2"],
                            },
                        },
                        content: ["inserted before line 1"],
                    },
                    {
                        mode: "insert_after",
                        anchor: {
                            start: {
                                line: 5,
                                text: "line 5",
                                before: ["line 4"],
                                after: [],
                            },
                        },
                        content: ["inserted after line 5"],
                    },
                ],
            });

            expect(result.success).toBe(true);
            expect(result.data?.applied).toHaveLength(2);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toContain("inserted before line 1");
            expect(content).toContain("inserted after line 5");
        });

        it("should handle multiple edits with overlapping line hints adjusted", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                edits: [
                    {
                        mode: "delete",
                        anchor: {
                            start: {
                                line: 2,
                                text: "line 2",
                                before: ["line 1"],
                                after: ["line 3"],
                            },
                        },
                    },
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 4,
                                text: "line 4",
                                before: ["line 3"],
                                after: ["line 5"],
                            },
                        },
                        content: ["REPLACED LINE 4"],
                    },
                ],
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).not.toContain("line 2");
            expect(content).toContain("REPLACED LINE 4");
        });

        it("should apply multiple edits with multi-line content", async () => {
            const result = await tool.execute({
                path: testFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "Hello World",
                                before: [],
                                after: [],
                            },
                        },
                        content: [
                            "Line A",
                            "Line B",
                            "Line C",
                        ],
                    },
                ],
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(testFilePath, "utf-8");
            expect(content).toBe("Line A\nLine B\nLine C\n");
        });

        it("should support virtual EOF matching for empty end anchors", async () => {
            const result = await tool.execute({
                path: fullDocFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "# Diogenes",
                                before: [],
                                after: [
                                    "",
                                    "A minimal LLM-controlled agent framework with explicit context management, implemented in TypeScript.",
                                ],
                            },
                            end: {
                                line: 11,
                                text: "",
                                before: [
                                    "## License",
                                    "",
                                    "Diogenes is released under the MIT License. See the [LICENSE](LICENSE) file for details.",
                                    "",
                                    "Copyright (c) 2024",
                                    "",
                                ],
                                after: [],
                            },
                        },
                        content: [
                            "# Rewritten",
                            "",
                            "replacement text",
                        ],
                    },
                ],
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(fullDocFilePath, "utf-8");
            expect(content).toContain("# Rewritten");
            expect(content).toContain("replacement text");
            expect(content).not.toContain("## License");
        });

        it("should respect single-line context instead of falling back to line_hint", async () => {
            const result = await tool.execute({
                path: duplicateFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 4,
                                text: "repeat",
                                before: ["beta"],
                                after: ["gamma"],
                            },
                        },
                        content: ["REPLACED SECOND"],
                    },
                ],
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(duplicateFilePath, "utf-8");
            expect(content).toContain("alpha\nrepeat\nbeta\nREPLACED SECOND\ngamma\n");
        });

        it("should report ambiguity when duplicate text has no disambiguating context", async () => {
            const originalContent = fs.readFileSync(duplicateFilePath, "utf-8");

            const result = await tool.execute({
                path: duplicateFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 2,
                                text: "repeat",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("ATOMIC_FAILURE");
            expect(fs.readFileSync(duplicateFilePath, "utf-8")).toBe(originalContent);
        });

        it("should include ±5 line windows for each ambiguous match in suggestion", async () => {
            const result = await tool.execute({
                path: duplicateFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 2,
                                text: "repeat",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("ATOMIC_FAILURE");
            expect(result.error?.suggestion).toContain("Match 1 at line");
            expect(result.error?.suggestion).toContain("Match 2 at line");
            expect(result.error?.suggestion).toContain("1 | alpha");
            expect(result.error?.suggestion).toContain("2 | repeat");
            expect(result.error?.suggestion).toContain("4 | repeat");
        });

        it("should reject conflicting context instead of silently matching by line hint", async () => {
            const originalContent = fs.readFileSync(duplicateFilePath, "utf-8");

            const result = await tool.execute({
                path: duplicateFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 4,
                                text: "repeat",
                                before: ["wrong before"],
                                after: ["gamma"],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(fs.readFileSync(duplicateFilePath, "utf-8")).toBe(originalContent);
        });

        it("should include anchor hint ±5 lines in suggestion when no match", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 3,
                                text: "line 3 but wrong",
                                before: ["line 2"],
                                after: ["line 4"],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("ATOMIC_FAILURE");
            expect(result.error?.suggestion).toContain("Anchor hint window around line 3 (±5):");
            expect(result.error?.suggestion).toContain("1 | line 1");
            expect(result.error?.suggestion).toContain("3 | line 3");
            expect(result.error?.suggestion).toContain("5 | line 5");
            expect(result.error?.suggestion).toContain("Expected anchor context:");
        });

        it("should avoid duplicate windows for same-line single-candidate mismatch", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 3,
                                text: "line 3",
                                before: ["wrong before"],
                                after: ["line 4"],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("ATOMIC_FAILURE");
            expect(result.error?.suggestion).toContain("Closest match window around line 3 (±5):");
            expect(result.error?.suggestion).not.toContain("Anchor hint window around line 3 (±5):");
            expect(result.error?.suggestion).toContain("Mismatch details:");
            expect(result.error?.suggestion).toContain("before[0] expected: wrong before");
            expect(result.error?.suggestion).toContain("before[0] actual:   line 2");
        });

        it("should rollback all edits if one fails in atomic mode", async () => {
            const originalContent = fs.readFileSync(multiLineFilePath, "utf-8");

            const result = await tool.execute({
                path: multiLineFilePath,
                options: { atomic: true },
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "line 1",
                                before: [],
                                after: ["line 2"],
                            },
                        },
                        content: ["REPLACED"],
                    },
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 99,
                                text: "non-existent",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.success).toBe(false);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toBe(originalContent);
        });

        it("should apply partial edits when atomic: false", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                options: { atomic: false },
                edits: [
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 1,
                                text: "line 1",
                                before: [],
                                after: ["line 2"],
                            },
                        },
                        content: ["REPLACED"],
                    },
                    {
                        mode: "replace",
                        anchor: {
                            start: {
                                line: 99,
                                text: "non-existent",
                                before: [],
                                after: [],
                            },
                        },
                        content: ["SHOULD NOT APPLY"],
                    },
                ],
            });

            expect(result.data?.applied).toHaveLength(1);
            expect(result.data?.errors).toHaveLength(1);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toContain("REPLACED");
        });
    });
});
