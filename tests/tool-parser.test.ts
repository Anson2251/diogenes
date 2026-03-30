import { describe, it, expect } from "vitest";

import { parseToolCalls, tryParsePartialToolCalls } from "../src/utils/tool-parser";

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

        it("should parse task.ask and task.choose", () => {
            const text = `\`\`\`tool-call
[
    {"tool":"task.ask","params":{"question":"Need more info?"}},
    {"tool":"task.choose","params":{"question":"Pick one","options":["a","b"]}}
]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
            expect(result.toolCalls![0].tool).toBe("task.ask");
            expect(result.toolCalls![1].tool).toBe("task.choose");
        });

        it("should parse task.notepad", () => {
            const text = `\`\`\`tool-call
[
    {"tool":"task.notepad","params":{"mode":"append","content":{"$heredoc":"NOTE"}}}
]
<<<NOTE
summary line 1
summary line 2
NOTE
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0].tool).toBe("task.notepad");
            expect(result.toolCalls![0].params.content).toEqual([
                "summary line 1",
                "summary line 2",
            ]);
        });

        it("should parse todo.set with multiple items", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "todo.set",
        "params": {
            "items": [
                {"text": "Explore src structure and main files", "state": "active"},
                {"text": "Check examples for consistency", "state": "pending"},
                {"text": "Identify discrepancies between README and codebase", "state": "pending"},
                {"text": "Update README accordingly", "state": "pending"}
            ]
        }
    }
]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0].tool).toBe("todo.set");
            expect(result.toolCalls![0].params.items).toHaveLength(4);
        });

        it("should parse ```tool as alias for ```tool-call", () => {
            const text = `\`\`\`tool
[{"tool": "file.load", "params": {"path": "test.ts"}}]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
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

        it("should accept file.create and file.overwrite tool names", () => {
            const text = `\`\`\`tool-call
[
    {"tool":"file.create","params":{"path":"a.txt","content":{"$heredoc":"CREATE"}}},
    {"tool":"file.overwrite","params":{"path":"b.txt","content":{"$heredoc":"OVERWRITE"}}}
]
<<<CREATE
hello
CREATE
<<<OVERWRITE
world
OVERWRITE
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
            expect(result.toolCalls![0].tool).toBe("file.create");
            expect(result.toolCalls![1].tool).toBe("file.overwrite");
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

        it("should handle heredoc with markdown code blocks containing triple backticks", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"path": "README.md", "edits": [{"mode": "replace", "anchor": {"start": {"line": 1, "text": "old"}}, "content": {"$heredoc": "EOF"}}]}}]
<<<EOF
\`\`\`json
[
  {
    "tool": "dir.list",
    "params": {
      "path": "src"
    }
  }
]
\`\`\`
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "```json",
                "[",
                "  {",
                '    "tool": "dir.list",',
                '    "params": {',
                '      "path": "src"',
                "    }",
                "  }",
                "]",
                "```",
            ]);
        });

        it("should handle complex heredoc with nested markdown code blocks and tool-call markers", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"path": "README.md", "edits": [{"mode": "replace", "anchor": {"start": {"line": 1, "text": "old"}}, "content": {"$heredoc": "EOF"}}]}}]
<<<EOF
## Example Session

**LLM Response 1:**
\`\`\`
I'll start by exploring the project structure.

\`\`\`tool-call
[
  {
    "tool": "dir.list",
    "params": {
      "path": "src"
    }
  }
]
\`\`\`
\`\`\`

**LLM Response 2:**
\`\`\`
Task completed.

\`\`\`tool-call
[
  {
    "tool": "task.end",
    "params": {
      "reason": "Done"
    }
  }
]
\`\`\`
\`\`\`
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toContain("## Example Session");
            expect(result.toolCalls![0].params.edits[0].content).toContain("```tool-call");
            expect(result.toolCalls![0].params.edits[0].content).toContain(
                '    "tool": "dir.list",',
            );
            expect(result.toolCalls![0].params.edits[0].content).toContain(
                '    "tool": "task.end",',
            );
        });

        it("should fail when referenced heredoc delimiter is missing", () => {
            const text = `\`\`\`tool-call
[{"tool":"file.edit","params":{"path":"a.ts","edits":[{"content":{"$heredoc":"MISSING"}}]}}]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Heredoc parse error");
            expect(result.error?.message).toContain("not found");
        });

        it("should fail when heredoc is not closed", () => {
            const text = `\`\`\`tool-call
[{"tool":"file.edit","params":{"path":"a.ts","edits":[{"content":{"$heredoc":"EOF"}}]}}]
<<<EOF
line 1
line 2
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Unclosed heredoc");
        });

        it("should fail on duplicate heredoc delimiters in one block", () => {
            const text = `\`\`\`tool-call
[{"tool":"file.edit","params":{"path":"a.ts","edits":[{"content":{"$heredoc":"EOF"}}]}}]
<<<EOF
first
EOF
<<<EOF
second
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("Duplicate heredoc delimiter");
        });

        it("should fail when heredoc is defined but not referenced", () => {
            const text = `\`\`\`tool-call
[{"tool":"file.load","params":{"path":"a.ts"}}]
<<<EOF
unused
EOF
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(false);
            expect(result.error?.message).toContain("defined but not referenced");
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

        it("should parse complex edit with anchor and replace mode", () => {
            const text = `\`\`\`tool-call
[
    {"tool": "file.edit", "params": {"path": "README.md", "edits": [
        {
            "mode": "replace",
            "anchor": {
                "start": {
                    "line": 135,
                    "text": "### File Tools\\n- \`file.load\` - Load file content into workspace\\n- \`file.unload\` - Remove file from workspace\\n- \`file.edit\` - Apply structured edits to a file (complex anchor-based editing)\\n- \`file.file_create\` - Create a new file with content\\n- \`file.file_overwrite\` - Overwrite entire file content\\n- \`file.file_append\` - Append content to end of file"
                }
            },
            "content": [
                "### File Tools",
                "- \`file.load\` - Load file content into workspace",
                "- \`file.unload\` - Remove file from workspace",
                "- \`file.edit\` - Apply structured edits to a file (complex anchor-based editing) **(currently in testing, may contain bugs)**",
                "- \`file.create\` - Create a new file with content",
                "- \`file.overwrite\` - Overwrite entire file content",
                "- \`file.append\` - Append content to end of file"
            ]
        }
    ]}}
]
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0].tool).toBe("file.edit");
            expect(result.toolCalls![0].params.path).toBe("README.md");
            expect(result.toolCalls![0].params.edits[0].mode).toBe("replace");
            expect(result.toolCalls![0].params.edits[0].anchor.start.line).toBe(135);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "### File Tools",
                "- `file.load` - Load file content into workspace",
                "- `file.unload` - Remove file from workspace",
                "- `file.edit` - Apply structured edits to a file (complex anchor-based editing) **(currently in testing, may contain bugs)**",
                "- `file.create` - Create a new file with content",
                "- `file.overwrite` - Overwrite entire file content",
                "- `file.append` - Append content to end of file",
            ]);
        });
    });

    describe("multiple edits with heredocs", () => {
        it("should parse multiple edits each with their own heredoc", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "file.edit",
        "params": {
            "path": "test.ts",
            "edits": [
                {
                    "mode": "replace",
                    "anchor": {"start": {"line": 1, "text": "old line 1"}},
                    "content": {"$heredoc": "EDIT1"}
                },
                {
                    "mode": "replace",
                    "anchor": {"start": {"line": 5, "text": "old line 5"}},
                    "content": {"$heredoc": "EDIT2"}
                }
            ]
        }
    }
]
<<<EDIT1
new content for line 1
another line
EDIT1
<<<EDIT2
new content for line 5
yet another line
EDIT2
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(1);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "new content for line 1",
                "another line",
            ]);
            expect(result.toolCalls![0].params.edits[1].content).toEqual([
                "new content for line 5",
                "yet another line",
            ]);
        });

        it("should parse three edits with heredocs", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "file.edit",
        "params": {
            "path": "src/main.ts",
            "edits": [
                {"mode": "insert_before", "anchor": {"start": {"line": 1, "text": "import"}}, "content": {"$heredoc": "A"}},
                {"mode": "replace", "anchor": {"start": {"line": 10, "text": "const x = 1;"}}, "content": {"$heredoc": "B"}},
                {"mode": "insert_after", "anchor": {"start": {"line": 20, "text": "export"}}, "content": {"$heredoc": "C"}}
            ]
        }
    }
]
<<<A
// Header comment
// Author: test
A
<<<B
const x = 42;
const y = 100;
B
<<<C

// End of file
C
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "// Header comment",
                "// Author: test",
            ]);
            expect(result.toolCalls![0].params.edits[1].content).toEqual([
                "const x = 42;",
                "const y = 100;",
            ]);
            expect(result.toolCalls![0].params.edits[2].content).toEqual(["", "// End of file"]);
        });

        it("should handle multiple edits with mixed content types", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "file.edit",
        "params": {
            "path": "mixed.ts",
            "edits": [
                {"mode": "replace", "anchor": {"start": {"line": 1, "text": "old"}}, "content": ["simple", "array"]},
                {"mode": "replace", "anchor": {"start": {"line": 5, "text": "old2"}}, "content": {"$heredoc": "HEREDOC"}},
                {"mode": "delete", "anchor": {"start": {"line": 10, "text": "delete me"}}}
            ]
        }
    }
]
<<<HEREDOC
heredoc content here
with multiple lines
HEREDOC
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual(["simple", "array"]);
            expect(result.toolCalls![0].params.edits[1].content).toEqual([
                "heredoc content here",
                "with multiple lines",
            ]);
            expect(result.toolCalls![0].params.edits[2].mode).toBe("delete");
            expect(result.toolCalls![0].params.edits[2].content).toBeUndefined();
        });

        it("should parse multiple file.edit tool calls with heredocs", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "file.edit",
        "params": {
            "path": "file1.ts",
            "edits": [{"mode": "replace", "anchor": {"start": {"line": 1, "text": "old"}}, "content": {"$heredoc": "FILE1"}}]
        }
    },
    {
        "tool": "file.edit",
        "params": {
            "path": "file2.ts",
            "edits": [{"mode": "replace", "anchor": {"start": {"line": 1, "text": "old"}}, "content": {"$heredoc": "FILE2"}}]
        }
    }
]
<<<FILE1
content for file1
FILE1
<<<FILE2
content for file2
FILE2
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls).toHaveLength(2);
            expect(result.toolCalls![0].params.path).toBe("file1.ts");
            expect(result.toolCalls![0].params.edits[0].content).toEqual(["content for file1"]);
            expect(result.toolCalls![1].params.path).toBe("file2.ts");
            expect(result.toolCalls![1].params.edits[0].content).toEqual(["content for file2"]);
        });

        it("should handle heredocs with complex content including code", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "file.edit",
        "params": {
            "path": "code.ts",
            "edits": [
                {
                    "mode": "replace",
                    "anchor": {"start": {"line": 10, "text": "function old() {"}},
                    "content": {"$heredoc": "NEWFUNC"}
                }
            ]
        }
    }
]
<<<NEWFUNC
function newFunction(arg1: string, arg2: number): void {
    const x = "test with \\"quotes\\"";
    const y = \`template \${literal}\`;
    console.log(arg1, arg2, x, y);
}
NEWFUNC
\`\`\``;
            const result = parseToolCalls(text);
            expect(result.success).toBe(true);
            expect(result.toolCalls![0].params.edits[0].content).toEqual([
                "function newFunction(arg1: string, arg2: number): void {",
                '    const x = "test with \\"quotes\\"";',
                "    const y = `template ${literal}`;",
                "    console.log(arg1, arg2, x, y);",
                "}",
            ]);
        });
    });
});

describe("tryParsePartialToolCalls", () => {
    describe("detecting tool call blocks", () => {
        it("should return empty when not in tool call block", () => {
            const result = tryParsePartialToolCalls("Some regular text");
            expect(result.isInToolCallBlock).toBe(false);
            expect(result.completeToolCalls).toEqual([]);
            expect(result.hasIncompleteToolCall).toBe(false);
        });

        it("should detect being inside tool-call block", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "test.ts"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
        });

        it("should detect being inside tool block (alias)", () => {
            const text = `\`\`\`tool
[{"tool": "dir.list", "params": {"path": "src"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
        });

        it("should return false after block is closed", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "test.ts"}}]
\`\`\`
Some text after`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(false);
        });
    });

    describe("parsing complete tool calls in partial JSON", () => {
        it("should extract complete tool call from partial array", () => {
            const text = `\`\`\`tool-call
[
    {"tool": "file.load", "params": {"path": "a.ts"}},
    {"tool": "file.load", "params": {"path": "b.ts"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
            expect(result.hasIncompleteToolCall).toBe(true);
            expect(result.completeToolCalls).toHaveLength(1);
            expect(result.completeToolCalls[0]).toEqual({
                tool: "file.load",
                params: { path: "a.ts" },
            });
        });

        it("should extract multiple complete tool calls", () => {
            const text = `\`\`\`tool-call
[
    {"tool": "dir.list", "params": {"path": "src"}},
    {"tool": "file.load", "params": {"path": "test.ts"}},
    {"tool": "task.end", "params": {"reason": "incomplete"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
            expect(result.hasIncompleteToolCall).toBe(true);
            expect(result.completeToolCalls).toHaveLength(2);
            expect(result.completeToolCalls[0].tool).toBe("dir.list");
            expect(result.completeToolCalls[1].tool).toBe("file.load");
        });

        it("should handle empty array start", () => {
            const text = `\`\`\`tool-call
[`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
            expect(result.hasIncompleteToolCall).toBe(true);
            expect(result.completeToolCalls).toEqual([]);
        });

        it("should handle complete array with no incomplete", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "test.ts"}}]`;
            const result = tryParsePartialToolCalls(text);
            expect(result.isInToolCallBlock).toBe(true);
            expect(result.hasIncompleteToolCall).toBe(false);
            expect(result.completeToolCalls).toHaveLength(1);
        });

        it("should handle tool call with nested objects", () => {
            const text = `\`\`\`tool-call
[
    {
        "tool": "todo.set",
        "params": {
            "items": [
                {"text": "Task 1", "state": "active"},
                {"text": "Task 2", "state": "pending"}
            ]
        }
    },
    {"tool": "file.edit", "params": {"path": "incomplete"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.completeToolCalls).toHaveLength(1);
            expect(result.completeToolCalls[0].tool).toBe("todo.set");
            expect(result.completeToolCalls[0].params.items).toHaveLength(2);
        });

        it("should skip invalid tool calls", () => {
            const text = `\`\`\`tool-call
[
    {"tool": "file.load", "params": {"path": "valid.ts"}},
    {"invalid": "object"},
    {"tool": "dir.list", "params": {"path": "src"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.completeToolCalls).toHaveLength(1);
            expect(result.completeToolCalls[0].tool).toBe("file.load");
        });

        it("should skip unknown tool names", () => {
            const text = `\`\`\`tool-call
[
    {"tool": "file.load", "params": {"path": "test.ts"}},
    {"tool": "unknown.tool", "params": {}},
    {"tool": "dir.list", "params": {"path": "src"`;
            const result = tryParsePartialToolCalls(text);
            expect(result.completeToolCalls).toHaveLength(1);
            expect(result.completeToolCalls[0].tool).toBe("file.load");
        });
    });

    describe("handling heredocs in partial parsing", () => {
        it("should handle incomplete heredoc", () => {
            const text = `\`\`\`tool-call
[{"tool": "file.edit", "params": {"edits": [{"content": {"$heredoc": "EOF"}}]}}]
<<<EOF
incomplete heredoc content`;
            const result = tryParsePartialToolCalls(text);
            expect(result.hasIncompleteToolCall).toBe(true);
        });
    });

    describe("incremental parsing simulation", () => {
        it("should correctly track new tool calls across incremental updates", () => {
            const texts = [
                `\`\`\`tool-call
[`,
                `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "a.ts"}}`,
                `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "a.ts"}},
 {"tool": "dir.list", "params": {"path": "src"`,
                `\`\`\`tool-call
[{"tool": "file.load", "params": {"path": "a.ts"}},
 {"tool": "dir.list", "params": {"path": "src"}}]`,
            ];

            const results = texts.map(tryParsePartialToolCalls);

            expect(results[0].completeToolCalls).toHaveLength(0);
            expect(results[1].completeToolCalls).toHaveLength(1);
            expect(results[2].completeToolCalls).toHaveLength(1);
            expect(results[3].completeToolCalls).toHaveLength(2);
        });
    });
});
