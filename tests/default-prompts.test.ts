import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PROMPT, getContextWindowForModel } from "../src/config/default-prompts";

describe("default prompts", () => {
    it("keeps the Diogenes tool protocol and task completion requirements", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("```tool-call");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("end explicitly with `task.end`");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("Do not stop silently");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("Plain text does not end the loop");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Execution & Output Discipline");
    });

    it("includes upgraded intent, efficiency, and safety guidance", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Intent & Proactiveness");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Workspace & Context");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("### Engineering Standards");
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "stage, commit, or revert changes unless the user explicitly asks",
        );
        expect(DEFAULT_SYSTEM_PROMPT).toContain("expose, print, or store secrets");
    });

    it("includes the thinking/cognitive scaffolding rule", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("Think first:");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("Before emitting a `tool-call` block, write 1-2 sentences of your reasoning");
    });

    it("includes the heredoc delimiter boundary rule", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("The line containing the closing `DELIM` must be the absolute final line");
    });

    it("includes the operationalized retry rule with conversation history tracking", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("review the immediate conversation history");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("exact same tool call fail 3 consecutive times");
    });

    it("includes output paradox resolution for conversational vs action responses", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("If no tools or actions are needed, you may respond with standard text");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("If actions are required, your response MUST contain a `tool-call` block");
    });

    it("matches model names case-insensitively and by substring", () => {
        expect(getContextWindowForModel("GPT-4O")).toBe(128000);
        expect(getContextWindowForModel("claude-3-5-sonnet-latest")).toBe(200000);
        expect(getContextWindowForModel("unknown-model")).toBeUndefined();
    });
});
