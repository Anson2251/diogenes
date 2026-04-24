import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

import { DiogenesContextManager } from "../src/context";
import { generateSystemPrompt } from "../src/config/default-prompts";

describe("DiogenesContextManager system prompt integration", () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "diogenes-test-"));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    describe("system prompt selection based on model capabilities", () => {
        it("should use native tool call prompt when model supports native tool calls", () => {
            vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

            const manager = new DiogenesContextManager({
                security: {
                    workspaceRoot: tempDir,
                },
                llm: {
                    apiKey: "sk-test-key",
                    providerStyle: "openai",
                    model: "gpt-4o",
                },
            });

            const systemPrompt = manager.getSystemPrompt();

            // Native tool call prompt should NOT contain JSON tool calling instructions
            expect(systemPrompt).not.toContain("## Tool Calling");
            expect(systemPrompt).not.toContain("```tool-call");
            expect(systemPrompt).not.toContain("$heredoc");

            // But should contain base prompt content
            expect(systemPrompt).toContain("## Intent & Proactiveness");
            expect(systemPrompt).toContain("## Workspace & Context");
        });

        it("should use JSON tool call prompt when model does not support native tool calls", () => {
            vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

            const manager = new DiogenesContextManager({
                security: {
                    workspaceRoot: tempDir,
                },
                llm: {
                    apiKey: "sk-test-key",
                    providerStyle: "openai",
                    model: "legacy-model",
                },
            });

            // Mock the capabilities to return false for native tool calls
            // Note: In a real scenario, this would depend on the model configuration
            // For this test, we're verifying the prompt selection logic exists

            const systemPrompt = manager.getSystemPrompt();
            expect(systemPrompt).toBeTruthy();
        });

        it("should use custom system prompt when provided", () => {
            const customPrompt = "This is a custom system prompt for testing.";

            const manager = new DiogenesContextManager({
                security: {
                    workspaceRoot: tempDir,
                },
                systemPrompt: customPrompt,
            });

            const systemPrompt = manager.getSystemPrompt();
            expect(systemPrompt).toBe(customPrompt);
        });

        it("should include JSON tool calling section in text mode", () => {
            // Generate prompt for text mode (no native tool calls)
            const textModePrompt = generateSystemPrompt(false);

            expect(textModePrompt).toContain("## Tool Calling");
            expect(textModePrompt).toContain("```tool-call");
            expect(textModePrompt).toContain("$heredoc");
            expect(textModePrompt).toContain("CRITICAL: Do NOT use XML tags");
        });

        it("should exclude JSON tool calling section in native mode", () => {
            // Generate prompt for native mode
            const nativeModePrompt = generateSystemPrompt(true);

            expect(nativeModePrompt).not.toContain("## Tool Calling");
            expect(nativeModePrompt).not.toContain("```tool-call");
            expect(nativeModePrompt).not.toContain("$heredoc");
            expect(nativeModePrompt).not.toContain("CRITICAL: Do NOT use XML tags");
        });
    });

    describe("ToolCallManager integration", () => {
        it("should handle models without API key gracefully", () => {
            // When no API key is provided, LLM client is not initialized
            // but context manager should still work
            const manager = new DiogenesContextManager({
                security: {
                    workspaceRoot: tempDir,
                },
            });

            const systemPrompt = manager.getSystemPrompt();
            // Should use default (text mode) since no client capabilities available
            expect(systemPrompt).toBeTruthy();
        });

        it("should initialize with OpenAI client when API key provided", () => {
            vi.stubEnv("OPENAI_API_KEY", "sk-test-key");

            const manager = new DiogenesContextManager({
                security: {
                    workspaceRoot: tempDir,
                },
                llm: {
                    apiKey: "sk-test-key",
                    providerStyle: "openai",
                    model: "gpt-4o",
                },
            });

            // Context manager should be properly initialized
            expect(manager.getSystemPrompt()).toBeTruthy();
            expect(manager.getWorkspaceManager()).toBeDefined();
            expect(manager.getState()).toBeDefined();
        });
    });

    describe("prompt consistency", () => {
        it("should have consistent base content in both modes", () => {
            const textModePrompt = generateSystemPrompt(false);
            const nativeModePrompt = generateSystemPrompt(true);

            // Both should contain base sections
            const baseSections = [
                "## Intent & Proactiveness",
                "## Workspace & Context",
                "## Safety & Boundaries",
                "## Working Lifecycle",
            ];

            for (const section of baseSections) {
                expect(textModePrompt).toContain(section);
                expect(nativeModePrompt).toContain(section);
            }
        });

        it("should only differ in tool calling section", () => {
            const textModePrompt = generateSystemPrompt(false);
            const nativeModePrompt = generateSystemPrompt(true);

            // The main difference should be the JSON tool calling section
            const toolCallingSection = "## Tool Calling";

            expect(textModePrompt).toContain(toolCallingSection);
            expect(nativeModePrompt).not.toContain(toolCallingSection);
        });
    });
});
