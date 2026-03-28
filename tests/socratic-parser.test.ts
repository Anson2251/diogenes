import { describe, it, expect } from "vitest";

import { parseSocraticToolInput } from "../src/utils/socratic-parser";

describe("parseSocraticToolInput", () => {
    it("should parse shorthand single-line tool call", () => {
        const result = parseSocraticToolInput(`dir.list { "path": "src" }`);

        expect(result.success).toBe(true);
        expect(result.toolCalls).toEqual([
            {
                tool: "dir.list",
                params: { path: "src" },
            },
        ]);
    });

    it("should parse shorthand multi-line params", () => {
        const result = parseSocraticToolInput(`file.load {
  "path": "src/cli.ts",
  "start": 1,
  "end": 20
}`);

        expect(result.success).toBe(true);
        expect(result.toolCalls).toEqual([
            {
                tool: "file.load",
                params: {
                    path: "src/cli.ts",
                    start: 1,
                    end: 20,
                },
            },
        ]);
    });

    it("should preserve normal tool-call parsing", () => {
        const result = parseSocraticToolInput(`\`\`\`tool-call
[
  {"tool":"dir.list","params":{"path":"src"}}
]
\`\`\``);

        expect(result.success).toBe(true);
        expect(result.toolCalls?.[0]?.tool).toBe("dir.list");
    });
});
