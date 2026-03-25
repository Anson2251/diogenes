import { describe, expect, it } from "vitest";
import { PromptBuilder } from "../src/context/prompt-builder";
import type { ContextStatus, DirectoryWorkspace, FileWorkspace, TodoWorkspace, NotepadWorkspace } from "../src/types";

describe("PromptBuilder", () => {
    const builder = new PromptBuilder("system prompt", 1000);

    const contextStatus: ContextStatus = {
        tokenUsage: {
            current: 128,
            limit: 1000,
            percentage: 12.8,
        },
        directoryWorkspace: {
            count: 1,
        },
        fileWorkspace: {
            count: 1,
            totalLines: 4,
        },
        notepadWorkspace: {
            lines: 2,
        },
    };

    const directoryWorkspace: DirectoryWorkspace = {
        src: [
            { name: "context", type: "DIR" },
            { name: "index.ts", type: "FILE" },
        ],
    };

    const fileWorkspace: FileWorkspace = {
        "README.md": {
            path: "README.md",
            totalLines: 6,
            content: ["# Title", "line 2", "line 5", "line 6"],
            ranges: [
                { start: 1, end: 2 },
                { start: 5, end: 6 },
            ],
            offsets: [],
        },
    };

    const todoWorkspace: TodoWorkspace = {
        items: [
            { text: "review tests", state: "active" },
            { text: "ship fix", state: "pending" },
        ],
    };

    const notepadWorkspace: NotepadWorkspace = {
        lines: ["Need to unload README after edit", "Watch for duplicate anchors"],
    };

    it("should render unloaded file gaps and the notepad section", () => {
        const sections = builder.buildContextSections(
            "dir.list\nfile.load",
            "## Task\nDo the thing\n--",
            contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
            notepadWorkspace,
            [],
        );

        expect(sections.fileWorkspace).toContain("[UNLOADED]");
        expect(sections.fileWorkspace).toContain("  1 | # Title");
        expect(sections.fileWorkspace).toContain("  5 | line 5");
        expect(sections.notepadWorkspace).toContain("## Notepad");
        expect(sections.notepadWorkspace).toContain("- Need to unload README after edit");
    });

    it("should omit the tool results section when no results exist", () => {
        const sections = builder.buildContextSections(
            "dir.list",
            "## Task\nTest\n--",
            contextStatus,
            {},
            {},
            { items: [] },
            { lines: [] },
            [],
        );

        const assembled = builder.assembleContextSections(sections);

        expect(sections.toolResults).toBe("");
        expect(assembled).not.toContain("## Tool Results");
        expect(assembled).toContain("## Directory Workspace\n(empty)");
        expect(assembled).toContain("## Notepad\n(empty)");
    });

    it("should include tool results and update token usage", () => {
        const sections = builder.buildContextSections(
            "file.edit",
            "## Task\nFinish\n--",
            contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
            notepadWorkspace,
            ["file.edit: success", "task.notepad: success"],
        );

        const prompt = builder.assemblePrompt(sections);
        const tokens = builder.updateTokenUsage(sections);

        expect(prompt).toContain("## Tool Results");
        expect(prompt).toContain("task.notepad: success");
        expect(tokens).toBeGreaterThan(0);
        expect(builder.getCurrentTokens()).toBe(tokens);
        expect(builder.getTokenPercentage()).toBeGreaterThan(0);
    });

    it("should format tool definitions with required and optional params", () => {
        const formatted = PromptBuilder.formatToolDefinitions([
            {
                namespace: "file",
                name: "peek",
                description: "Preview a file",
                params: {
                    path: { type: "string", description: "Target file" },
                    start: { type: "number", description: "Start line", optional: true },
                },
                returns: {
                    lines: "Preview lines",
                },
            },
        ]);

        expect(formatted).toContain("## file.peek");
        expect(formatted).toContain("path: string");
        expect(formatted).toContain("start (optional): number");
        expect(formatted).toContain("lines: Preview lines");
    });
});
