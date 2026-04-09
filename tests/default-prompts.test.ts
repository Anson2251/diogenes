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

    it("keeps tool-calling guidance concise and tool-specific", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("Tool-specific constraints live in each tool definition");
        expect(DEFAULT_SYSTEM_PROMPT).not.toContain(
            "Before emitting a `tool-call` block, write 1-2 sentences of your reasoning",
        );
    });

    it("includes the heredoc delimiter boundary rule", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "For multi-line content, prefer heredoc and keep it in the same `tool-call` block.",
        );
    });

    it("includes the operationalized retry rule with conversation history tracking", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("review the immediate conversation history");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("exact same tool call fail 3 consecutive times");
    });

    it("includes output paradox resolution for conversational vs action responses", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "If actions are required, your response MUST contain a `tool-call` block",
        );
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "Decision rule: if the request can be answered reliably",
        );
    });

    it("keeps termination quality gate for task.end summaries", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "`summary` must clearly contain one of: outcome, blocker, or the exact next question for the user",
        );
    });

    it("matches model names case-insensitively and by substring", () => {
        expect(getContextWindowForModel("GPT-4O")).toBe(128000);
        expect(getContextWindowForModel("claude-3-5-sonnet-latest")).toBe(200000);
        expect(getContextWindowForModel("unknown-model")).toBeUndefined();
    });
});
