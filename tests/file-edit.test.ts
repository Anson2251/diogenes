import * as fs from "fs";
import * as path from "path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { WorkspaceManager } from "../src/context/workspace";
import { FileEditTool } from "../src/tools/file/file-edit";

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
        fs.writeFileSync(multiLineFilePath, "line 1\nline 2\nline 3\nline 4\nline 5\n");
        fs.writeFileSync(duplicateFilePath, "alpha\nrepeat\nbeta\nrepeat\ngamma\n");
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
            expect(def.description).toContain("Find and replace text in a file");
            expect(def.params.path.type).toBe("string");
            expect(def.params.oldString.type).toBe("string");
            expect(def.params.newString.type).toBe("string");
            expect(def.params.approxLineNumber.optional).toBe(true);
        });
    });

    describe("execute - error handling", () => {
        it("should return error for non-existent file", async () => {
            const result = await tool.execute({
                path: path.join(testDir, "non-existent.txt"),
                oldString: "Hello",
                newString: "Goodbye",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_EDIT_ERROR");
        });

        it("should return error for directory path", async () => {
            const result = await tool.execute({
                path: testDir,
                oldString: "Hello",
                newString: "Goodbye",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("FILE_EDIT_ERROR");
        });

        it("should reject path outside workspace", async () => {
            const result = await tool.execute({
                path: path.join(__dirname, "outside.txt"),
                oldString: "Hello",
                newString: "Goodbye",
            });

            expect(result.success).toBe(false);
        });

        it("should return error when oldString not found", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "non-existent-text-xyz",
                newString: "replacement",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("NO_MATCH");
        });
    });

    describe("parameter validation via execute", () => {
        it("should validate missing path parameter", async () => {
            const result = await tool.execute({
                oldString: "Hello",
                newString: "Goodbye",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate missing oldString parameter", async () => {
            const result = await tool.execute({
                path: testFilePath,
                newString: "Goodbye",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate missing newString parameter", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate valid parameters", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello World",
                newString: "Hello There",
            });

            expect(result.success).toBe(true);
        });
    });

    describe("execute - replacement", () => {
        it("should replace exact text in a file", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello World",
                newString: "Hello There",
            });

            expect(result.success).toBe(true);
            expect(fs.readFileSync(testFilePath, "utf-8")).toBe("Hello There\n");
        });

        it("should include diff metadata after a successful edit", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello World",
                newString: "Hello There",
            });

            expect(result.success).toBe(true);
            expect(result.data?._diff?.path).toBe(testFilePath);
            expect(result.data?._diff?.oldText).toBe("Hello World\n");
            expect(result.data?._diff?.newText).toBe("Hello There\n");
            expect(result.data?._diff?.hunks).toEqual([
                {
                    oldStart: 1,
                    oldEnd: 1,
                    newStart: 1,
                    newEnd: 1,
                },
            ]);
        });

        it("should replace multi-line oldString with multi-line newString", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                oldString: "line 2\nline 3",
                newString: "LINE TWO\nLINE THREE",
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toBe("line 1\nLINE TWO\nLINE THREE\nline 4\nline 5\n");
        });

        it("should replace last line of file", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                oldString: "line 5",
                newString: "LINE FIVE",
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(multiLineFilePath, "utf-8");
            expect(content).toBe("line 1\nline 2\nline 3\nline 4\nLINE FIVE\n");
        });

        it("should report match_line and match_count in result", async () => {
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello World",
                newString: "Hello There",
            });

            expect(result.success).toBe(true);
            expect(result.data?.match_line).toBe(1);
            expect(result.data?.match_count).toBe(1);
        });

        it("should report file_state in result", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                oldString: "line 3",
                newString: "LINE THREE",
            });

            expect(result.success).toBe(true);
            expect(result.data?.file_state).toEqual({
                total_lines: 6,
                modified_regions: [[3, 3]],
            });
        });

        it("should include workspace_update after edit when file is loaded", async () => {
            await workspace.loadFile(testFilePath);
            const result = await tool.execute({
                path: testFilePath,
                oldString: "Hello World",
                newString: "Hello There",
            });

            expect(result.success).toBe(true);
            expect(result.data?.workspace_update).toBeDefined();
            expect(result.data?.workspace_update).toHaveProperty("loaded_ranges");
            expect(result.data?.workspace_update).toHaveProperty("total_lines_in_workspace");
        });
    });

    describe("execute - duplicate handling", () => {
        const farDuplicateFilePath = path.join(testDir, "far-duplicate.txt");

        beforeEach(() => {
            const lines: string[] = ["line 1", "repeat"];
            for (let i = 3; i <= 29; i++) {
                lines.push(`line ${i}`);
            }
            lines.push("repeat", "line 31");
            fs.writeFileSync(farDuplicateFilePath, lines.join("\n") + "\n");
        });

        it("should return error when oldString has multiple matches and no approxLineNumber", async () => {
            const originalContent = fs.readFileSync(duplicateFilePath, "utf-8");

            const result = await tool.execute({
                path: duplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("AMBIGUOUS_MATCH");
            expect(result.error?.details?.matchCount).toBe(2);
            expect(result.error?.details?.matchLines).toEqual([2, 4]);
            expect(fs.readFileSync(duplicateFilePath, "utf-8")).toBe(originalContent);
        });

        it("should return error when multiple matches are within ±10 lines of approxLineNumber", async () => {
            const originalContent = fs.readFileSync(duplicateFilePath, "utf-8");

            const result = await tool.execute({
                path: duplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
                approxLineNumber: 2,
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("AMBIGUOUS_MATCH");
            expect(result.error?.details?.nearMatchLines).toEqual([2, 4]);
            expect(fs.readFileSync(duplicateFilePath, "utf-8")).toBe(originalContent);
        });

        it("should use approxLineNumber to disambiguate when only one match is within ±10 lines", async () => {
            const result = await tool.execute({
                path: farDuplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
                approxLineNumber: 2,
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(farDuplicateFilePath, "utf-8");
            expect(content).toContain("REPLACED");
            expect(content).toContain("line 21");
            const repeatCount = content.split("\n").filter((l) => l === "repeat").length;
            expect(repeatCount).toBe(1);
        });

        it("should use approxLineNumber to target second match when only one is within ±10 lines", async () => {
            const result = await tool.execute({
                path: farDuplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
                approxLineNumber: 20,
            });

            expect(result.success).toBe(true);
            const content = fs.readFileSync(farDuplicateFilePath, "utf-8");
            expect(content).toContain("REPLACED");
            const repeatCount = content.split("\n").filter((l) => l === "repeat").length;
            expect(repeatCount).toBe(1);
        });

        it("should report match_line and match_count for ambiguous matches resolved", async () => {
            const result = await tool.execute({
                path: farDuplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
                approxLineNumber: 2,
            });

            expect(result.success).toBe(true);
            expect(result.data?.match_line).toBe(2);
            expect(result.data?.match_count).toBe(2);
        });

        it("should return error when approxLineNumber is between two far-apart matches but neither is within ±10", async () => {
            const originalContent = fs.readFileSync(farDuplicateFilePath, "utf-8");

            const result = await tool.execute({
                path: farDuplicateFilePath,
                oldString: "repeat",
                newString: "REPLACED",
                approxLineNumber: 16,
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("AMBIGUOUS_MATCH");
            expect(result.error?.details?.nearMatchLines).toEqual([]);
            expect(fs.readFileSync(farDuplicateFilePath, "utf-8")).toBe(originalContent);
        });
    });

    describe("execute - no match context", () => {
        it("should include surrounding context when oldString not found with approxLineNumber", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                oldString: "line 3 but wrong",
                newString: "SHOULD NOT APPLY",
                approxLineNumber: 3,
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("NO_MATCH");
            expect(result.error?.details?.surrounding_context).toBeDefined();
            expect(result.error?.details?.surrounding_context).toContain("1: line 1");
            expect(result.error?.details?.surrounding_context).toContain("3: line 3");
            expect(result.error?.details?.surrounding_context).toContain("5: line 5");
        });

        it("should not include surrounding context when no approxLineNumber", async () => {
            const result = await tool.execute({
                path: multiLineFilePath,
                oldString: "non-existent text",
                newString: "SHOULD NOT APPLY",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("NO_MATCH");
            expect(result.error?.details?.surrounding_context).toBeUndefined();
        });
    });
});
