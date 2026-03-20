import { describe, it, expect } from "vitest";
import { parseToolCalls } from "../src/utils/tool-parser";

describe("parseToolCalls", () => {
    describe("basic parsing", () => {
        it("should return empty array for text without tool calls", () => {
            const result = parseToolCalls("Hello, this is regular text.");
            expect(result.success).toBe(true);
            expect(result.toolCalls).toEqual([]);
        });

        it("should parse single tool call", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "src/main.ts"}}]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0]).toEqual({
                tool: "file.load",
                params: { path: "src/main.ts" },
            });
        });

        it("should parse multiple tool calls", () => {
            const text = `\`\`\`tool-call
[{"tool": "dir.list", "params": {"path": "src"}}, {"tool": "task.end", "params": {"reason": "done"}}]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
        });
    });

    describe("heredoc parsing", () => {
        it("should parse heredoc content", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"path": "test.ts", "edits": [{"content": {"$heredoc": "EOF"}}]}}]
<<<EOF
line 1
line 2
line 3
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "line 1",
                "line 2",
                "line 3",
            ]);
        });

        it("should handle special characters without escaping", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"path": "test.ts", "edits": [{"content": {"$heredoc": "END"}}]}}]
<<<END
const x = "hello \\"world\\"";
const y = 'test\\n';
const z = \`backtick \${var}\`;
END
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                'const x = "hello \\"world\\"";',
                "const y = 'test\\n';",
                "const z = `backtick ${var}`;",
            ]);
        });

        it("should handle multiple heredocs with different delimiters", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": {"$heredoc": "FIRST"}}, {"content": {"$heredoc": "SECOND"}}]}}]
<<<FIRST
content A
FIRST
<<<SECOND
content B
SECOND
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual(["content A"]);
            expect(result.toolCalls![0].params.edits[1].content).toEqual(["content B"]);
        });

        it("should handle empty heredoc content", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": {"$heredoc": "EMPTY"}}]}}]
<<<EMPTY
EMPTY
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([]);
        });

        it("should handle heredoc with JSON in content", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": {"$heredoc": "JSON"}}]}}]
<<<JSON
{"key": "value", "nested": {"arr": [1, 2, 3]}}
JSON
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                '{"key": "value", "nested": {"arr": [1, 2, 3]}}',
            ]);
        });

        it("should handle heredoc with delimiter-like content", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": {"$heredoc": "EOF"}}]}}]
<<<EOF
This line has EOF in it: EOF
But this is still content
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "This line has EOF in it: EOF",
                "But this is still content",
            ]);
        });
    });

    describe("mixed content", () => {
        it("should handle regular content array alongside heredoc", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": ["regular", "array"]}, {"content": {"$heredoc": "HEREDOC"}}]}}]
<<<HEREDOC
heredoc content
HEREDOC
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual(["regular", "array"]);
            expect(result.toolCalls![0].params.edits[1].content).toEqual(["heredoc content"]);
        });
    });
});
