import { describe, expect, it } from "vitest";

import { DEFAULT_SYSTEM_PROMPT, getContextWindowForModel } from "../src/config/default-prompts";

describe("default prompts", () => {
    it("keeps the Diogenes tool protocol and task completion requirements", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("```tool-call");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("end explicitly with `task.end`");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("When finished or blocked, use `task.end`");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("plain text by itself does not end the loop");
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "include `task.end` in the final `tool-call` block",
        );
    });

    it("includes upgraded intent, efficiency, and safety guidance", () => {
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Intent First");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Context Efficiency");
        expect(DEFAULT_SYSTEM_PROMPT).toContain("## Engineering Standards");
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "stage, commit, or revert changes unless the user explicitly asks",
        );
        expect(DEFAULT_SYSTEM_PROMPT).toContain("expose, print, or store secrets");
        expect(DEFAULT_SYSTEM_PROMPT).toContain(
            "the final `task.end.summary` should contain the substantive answer itself",
        );
    });

    it("matches model names case-insensitively and by substring", () => {
        expect(getContextWindowForModel("GPT-4O")).toBe(128000);
        expect(getContextWindowForModel("claude-3-5-sonnet-latest")).toBe(200000);
        expect(getContextWindowForModel("unknown-model")).toBeUndefined();
    });
});
