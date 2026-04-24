import { describe, expect, it } from "vitest";

import { ToolCallManager } from "../src/utils/tool-call-manager";

describe("ToolCallManager edge cases", () => {
    describe("malformed inputs", () => {
        const manager = new ToolCallManager({
            preferNative: false,
            enableTextFallback: true,
            validateToolNames: true,
        });

        it("should handle invalid JSON in text mode", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "dir.list", "params": {invalid json here}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.toolCalls).toEqual([]);
        });

        it("should handle non-array JSON in tool-call block", () => {
            const response = {
                content: `
\`\`\`tool-call
{"tool": "dir.list", "params": {}}
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PARSE_ERROR");
        });

        it("should handle missing tool field", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"params": {"path": "src"}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PARSE_ERROR");
        });

        it("should handle empty tool-call blocks", () => {
            const response = {
                content: `
\`\`\`tool-call
[]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
        });

        it("should handle completely empty content", () => {
            const response = {
                content: "",
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
        });

        it("should handle whitespace-only content", () => {
            const response = {
                content: "   \n\t  \n  ",
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
        });
    });

    describe("native tool call edge cases", () => {
        const manager = new ToolCallManager({
            preferNative: true,
            enableTextFallback: true,
        });

        it("should handle empty native tool calls array", () => {
            const response = {
                content: "Some response",
                toolCalls: [],
            };

            const result = manager.processResponse(response);

            // Should fallback to text parsing
            expect(result.success).toBe(true);
            expect(result.source).toBe("text");
        });

        it("should handle native tool calls with empty arguments", () => {
            const response = {
                content: "",
                toolCalls: [
                    {
                        id: "call_1",
                        type: "function" as const,
                        function: {
                            name: "task.end",
                            arguments: "",
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("task.end");
            expect(result.toolCalls[0].params).toEqual({});
        });

        it("should handle native tool calls with invalid JSON arguments", () => {
            const response = {
                content: "",
                toolCalls: [
                    {
                        id: "call_1",
                        type: "function" as const,
                        function: {
                            name: "dir.list",
                            arguments: "not valid json",
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("dir.list");
            // Should have empty params when JSON parsing fails
            expect(result.toolCalls[0].params).toEqual({});
        });

        it("should handle native tool calls with complex nested params", () => {
            const response = {
                content: "",
                toolCalls: [
                    {
                        id: "call_1",
                        type: "function" as const,
                        function: {
                            name: "file.edit",
                            arguments: JSON.stringify({
                                path: "test.ts",
                                search: "function foo() {\n  return 1;\n}",
                                replace: "function foo() {\n  return 2;\n}",
                            }),
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls[0].params.search).toContain("function foo");
        });
    });

    describe("mixed content edge cases", () => {
        const manager = new ToolCallManager({
            preferNative: false,
            enableTextFallback: true,
        });

        it("should handle multiple tool-call blocks", () => {
            const response = {
                content: `
First action:
\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`

Second action:
\`\`\`tool-call
[{"tool": "file.peek", "params": {"path": "src/index.ts"}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
            expect(result.toolCalls[0].tool).toBe("dir.list");
            expect(result.toolCalls[1].tool).toBe("file.peek");
        });

        it("should handle tool-call block with text after closing", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "task.end", "params": {"reason": "done"}}]
\`\`\`

Some additional text that should be ignored for tool parsing.
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("task.end");
        });

        it("should handle incomplete tool-call block", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}
`,
            };

            const result = manager.processResponse(response);

            // Should fail due to unclosed block
            expect(result.success).toBe(false);
        });

        it("should handle code blocks that look like tool calls but aren't", () => {
            const response = {
                content: `
Here's an example of a code block:
\`\`\`json
{"tool": "example", "params": {}}
\`\`\`

And here's an actual tool call:
\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            // Should only parse the tool-call block, not the json block
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("dir.list");
        });
    });

    describe("heredoc edge cases", () => {
        const manager = new ToolCallManager({
            preferNative: false,
            enableTextFallback: true,
        });

        it("should handle heredoc with special characters", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "file.overwrite", "params": {"path": "test.txt", "content": {"$heredoc": "EOF"}}}]
<<<EOF
Line with "quotes" and 'apostrophes'
Line with <html> & special chars
Line with\\backslashes
EOF
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            // Heredoc content is returned as array of lines
            const content = result.toolCalls[0].params.content;
            const contentStr = Array.isArray(content) ? content.join("\n") : content;
            expect(contentStr).toContain('"quotes"');
            expect(contentStr).toContain("'apostrophes'");
            expect(contentStr).toContain("<html>");
        });

        it("should handle heredoc with empty content", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "file.overwrite", "params": {"path": "empty.txt", "content": {"$heredoc": "EOF"}}}]
<<<EOF
EOF
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
        });

        it("should handle mismatched heredoc delimiter", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "file.overwrite", "params": {"path": "test.txt", "content": {"$heredoc": "EOF"}}}]
<<<EOF
Some content
WRONG_DELIMITER
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            // Should fail due to mismatched delimiter
            expect(result.success).toBe(false);
        });
    });

    describe("configuration edge cases", () => {
        it("should work with text fallback disabled", () => {
            const manager = new ToolCallManager({
                preferNative: true,
                enableTextFallback: false,
            });

            const response = {
                content: `
\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`
`,
                toolCalls: [],
            };

            const result = manager.processResponse(response);

            // No native tool calls and text fallback disabled
            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
        });

        it("should prefer native over text when both present", () => {
            const manager = new ToolCallManager({
                preferNative: true,
                enableTextFallback: true,
            });

            const response = {
                content: `
\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`
`,
                toolCalls: [
                    {
                        id: "call_1",
                        type: "function" as const,
                        function: {
                            name: "file.peek",
                            arguments: '{"path": "test.ts"}',
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.source).toBe("native");
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("file.peek");
        });
    });
});
