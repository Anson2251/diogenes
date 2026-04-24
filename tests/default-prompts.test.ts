import { describe, expect, it } from "vitest";

import {
    generateSystemPrompt,
    NATIVE_TOOL_CALL_SYSTEM_PROMPT,
    getContextWindowForModel,
} from "../src/config/default-prompts";

describe("default prompts", () => {
    describe("text-based tool calling (JSON mode)", () => {
        const systemPrompt = generateSystemPrompt(false);

        it("keeps the Diogenes tool protocol and task completion requirements", () => {
            expect(systemPrompt).toContain("```tool-call");
            expect(systemPrompt).toContain("end explicitly with `task.end`");
            expect(systemPrompt).toContain("Plain text by itself DOES NOT end the loop");
        });

        it("includes upgraded intent, efficiency, and safety guidance", () => {
            expect(systemPrompt).toContain("## Intent & Proactiveness");
            expect(systemPrompt).toContain("## Workspace & Context");
            expect(systemPrompt).toContain("### Engineering Standards");
            expect(systemPrompt).toContain(
                "stage, commit, or revert changes unless the user explicitly asks",
            );
            expect(systemPrompt).toContain("expose, print, or store secrets");
        });

        it("includes tool calling instructions", () => {
            expect(systemPrompt).toContain("## Tool Calling");
            expect(systemPrompt).toContain("CRITICAL: Do NOT use XML tags");
        });

        it("includes the heredoc delimiter boundary rule", () => {
            expect(systemPrompt).toContain("### Heredoc");
            expect(systemPrompt).toContain("$heredoc");
        });

        it("includes the operationalized retry rule with conversation history tracking", () => {
            expect(systemPrompt).toContain("review the immediate conversation history");
            expect(systemPrompt).toContain("exact same tool call fail 3 consecutive times");
        });

        it("includes output paradox resolution for conversational vs action responses", () => {
            expect(systemPrompt).toContain(
                "If actions are required, use the appropriate tools available to you",
            );
            expect(systemPrompt).toContain(
                "Decision rule: if the request can be answered reliably from existing conversation/context",
            );
        });

        it("keeps termination quality gate for task.end summaries", () => {
            expect(systemPrompt).toContain(
                "`summary` must clearly contain one of: outcome, blocker, or the exact next question for the user",
            );
        });
    });

    describe("native tool calling mode", () => {
        it("does NOT include JSON tool calling instructions", () => {
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).not.toContain("## Tool Calling");
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).not.toContain("```tool-call");
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).not.toContain("$heredoc");
        });

        it("includes base system prompt content", () => {
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).toContain("## Intent & Proactiveness");
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).toContain("## Workspace & Context");
            expect(NATIVE_TOOL_CALL_SYSTEM_PROMPT).toContain("## Working Lifecycle");
        });
    });

    describe("generateSystemPrompt function", () => {
        it("returns text-based prompt when useNativeToolCalls is false", () => {
            const prompt = generateSystemPrompt(false);
            expect(prompt).toContain("## Tool Calling");
            expect(prompt).toContain("```tool-call");
        });

        it("returns native prompt when useNativeToolCalls is true", () => {
            const prompt = generateSystemPrompt(true);
            expect(prompt).not.toContain("## Tool Calling");
            expect(prompt).not.toContain("```tool-call");
        });
    });

    it("matches model names case-insensitively and by substring", () => {
        expect(getContextWindowForModel("GPT-4O")).toBe(128000);
        expect(getContextWindowForModel("claude-3-5-sonnet-latest")).toBe(200000);
        expect(getContextWindowForModel("unknown-model")).toBeUndefined();
    });
});
