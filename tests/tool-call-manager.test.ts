import { describe, expect, it } from "vitest";

import { ToolCallManager } from "../src/utils/tool-call-manager";

describe("ToolCallManager", () => {
    describe("text-based tool calling", () => {
        const manager = new ToolCallManager({
            preferNative: false,
            enableTextFallback: true,
        });

        it("should parse tool calls from markdown code blocks", () => {
            const response = {
                content: `
I'll check the directory structure for you.

\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0]).toEqual({
                tool: "dir.list",
                params: { path: "src" },
            });
            expect(result.source).toBe("text");
        });

        it("should parse multiple tool calls", () => {
            const response = {
                content: `
\`\`\`tool-call
[
  {"tool": "file.peek", "params": {"path": "src/index.ts"}},
  {"tool": "dir.list", "params": {"path": "src/utils"}}
]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
            expect(result.toolCalls[0].tool).toBe("file.peek");
            expect(result.toolCalls[1].tool).toBe("dir.list");
        });

        it("should return empty array for content without tool calls", () => {
            const response = {
                content: "Hello, this is just a regular message.",
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
            expect(result.source).toBe("text");
        });

        it("should parse heredoc format", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "file.overwrite", "params": {"path": "test.txt", "content": {"$heredoc": "EOF"}}}]
<<<EOF
Hello World
EOF
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            // Heredoc content is returned as array of lines
            expect(result.toolCalls[0].params.content).toContain("Hello World");
        });
    });

    describe("native tool calling", () => {
        const manager = new ToolCallManager({
            preferNative: true,
            enableTextFallback: true,
        });

        it("should convert native API tool calls", () => {
            const response = {
                content: "I'll list the directory for you.",
                toolCalls: [
                    {
                        id: "call_123",
                        type: "function" as const,
                        function: {
                            name: "dir.list",
                            arguments: '{"path": "src"}',
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0]).toEqual({
                tool: "dir.list",
                params: { path: "src" },
            });
            expect(result.source).toBe("native");
        });

        it("should parse JSON arguments in native tool calls", () => {
            const response = {
                content: "",
                toolCalls: [
                    {
                        id: "call_456",
                        type: "function" as const,
                        function: {
                            name: "file.edit",
                            arguments: '{"path": "test.ts", "search": "foo", "replace": "bar"}',
                        },
                    },
                ],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls[0].params).toEqual({
                path: "test.ts",
                search: "foo",
                replace: "bar",
            });
        });

        it("should fallback to text parsing when no native tool calls", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"tool": "task.end", "params": {"reason": "done", "status": "success"}}]
\`\`\`
`,
                toolCalls: [],
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("task.end");
            expect(result.source).toBe("text");
        });
    });

    describe("formatting tool results", () => {
        const manager = new ToolCallManager();

        it("should format successful tool results", () => {
            const toolCalls = [{ tool: "dir.list", params: { path: "src" } }];
            const results = [
                {
                    success: true,
                    data: { files: ["index.ts"], dirs: ["utils"] },
                },
            ];

            const formatted = manager.formatResults(toolCalls, results);

            expect(formatted).toContain("dir.list");
            expect(formatted).toContain("OK");
        });

        it("should format failed tool results", () => {
            const toolCalls = [{ tool: "file.load", params: { path: "nonexistent.ts" } }];
            const results = [
                {
                    success: false,
                    error: {
                        code: "FILE_NOT_FOUND",
                        message: "File not found",
                    },
                },
            ];

            const formatted = manager.formatResults(toolCalls, results);

            expect(formatted).toContain("file.load");
            expect(formatted).toContain("File not found");
        });
    });

    describe("error handling", () => {
        const manager = new ToolCallManager({
            preferNative: false,
            enableTextFallback: true,
        });

        it("should handle invalid JSON in tool calls", () => {
            const response = {
                content: `
\`\`\`tool-call
[invalid json here]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.toolCalls).toEqual([]);
        });

        it("should handle missing tool name", () => {
            const response = {
                content: `
\`\`\`tool-call
[{"params": {"path": "test"}}]
\`\`\`
`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it("should handle XML format error", () => {
            const response = {
                content: `<tool-call>{"tool": "dir.list"}</tool-call>`,
            };

            const result = manager.processResponse(response);

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("PARSE_ERROR");
        });
    });

    describe("interleaved thinking support", () => {
        it("should handle content with thinking blocks in text mode", () => {
            const manager = new ToolCallManager({
                supportsInterleavedThinking: false,
                preferNative: false,
                enableTextFallback: true,
            });

            const response = {
                content: `
<think>
Let me analyze the directory structure first.
</think>

\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}]
\`\`\`
`,
            };

            // Thinking blocks are not stripped in text mode, but tool calls should still parse
            const result = manager.processResponse(response);

            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls[0].tool).toBe("dir.list");
        });
    });
});
