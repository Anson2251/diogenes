import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs/promises";
import {
    setupTestHome,
    teardownTestHome,
    runCLI,
    type TestContext,
} from "./helpers";

describe("bundled CLI model commands", () => {
    let testCtx: TestContext;

    beforeEach(async () => {
        testCtx = await setupTestHome();
        runCLI(["init"], testCtx.env);
    });

    afterEach(async () => {
        if (testCtx?.homeDir) {
            await teardownTestHome(testCtx.homeDir);
        }
    });

    describe("list and show", () => {
        it("should list available models", async () => {
            const { stdout, exitCode } = runCLI(["model", "list"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Available Models");
            expect(stdout).toContain("openai/gpt-4o");
            expect(stdout).toContain("openai");
            expect(stdout).toContain("GPT-4o");
            expect(stdout).toContain("anthropic/claude");
        });

        it("should show models.yaml path", async () => {
            const { stdout, exitCode } = runCLI(["model", "path"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("models.yaml");
            expect(stdout).toContain(testCtx.homeDir);
        });

        it("should list configured providers", async () => {
            const { stdout, exitCode } = runCLI(["model", "providers"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Configured Providers");
            expect(stdout).toContain("openai");
            expect(stdout).toContain("anthropic");
            expect(stdout).toContain("openrouter");
            expect(stdout).toContain("OPENAI_API_KEY");
            expect(stdout).toContain("ANTHROPIC_API_KEY");
            expect(stdout).toContain("OPENROUTER_API_KEY");
        });

        it("should show specific model details", async () => {
            const { stdout, exitCode } = runCLI(["model", "show", "openai/gpt-4o"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("openai/gpt-4o");
            expect(stdout).toContain("provider: openai");
            expect(stdout).toContain("GPT-4o");
            expect(stdout).toContain("context window:");
            expect(stdout).toContain("128000");
        });

        it("should show error for unknown model", async () => {
            const { stderr, exitCode } = runCLI(["model", "show", "unknown/model"], testCtx.env);
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain("not found");
            expect(stderr).toContain("Available models:");
        });
    });

    describe("default model management", () => {
        it("should get default model (unset initially)", async () => {
            const { stdout, exitCode } = runCLI(["model", "default"], testCtx.env);
            expect(exitCode).toBe(0);
        });

        it("should set and get default model", async () => {
            // Set default
            const { exitCode: setExit } = runCLI(["model", "default", "anthropic/claude-sonnet-4-20250514"], testCtx.env);
            expect(setExit).toBe(0);

            // Verify by reading models.yaml
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.default).toBe("anthropic/claude-sonnet-4-20250514");
        });

        it("should clear default model", async () => {
            // First set a default
            runCLI(["model", "default", "anthropic/claude-sonnet-4-20250514"], testCtx.env);

            // Clear it
            const { exitCode } = runCLI(["model", "default", "--clear"], testCtx.env);
            expect(exitCode).toBe(0);

            // Verify by reading models.yaml
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.default).toBeUndefined();
        });
    });

    describe("active model management (use command)", () => {
        it("should set and get active model", async () => {
            // Set active model
            const { exitCode: setExit } = runCLI(["model", "use", "openai/gpt-4o-mini"], testCtx.env);
            expect(setExit).toBe(0);

            // Verify by reading config.yaml
            const configPath = path.join(testCtx.homeDir, ".config", "diogenes", "config.yaml");
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = yaml.parse(configContent);
            expect(config.llm?.model).toBe("openai/gpt-4o-mini");
        });

        it("should clear active model", async () => {
            // First set an active model
            runCLI(["model", "use", "openai/gpt-4o-mini"], testCtx.env);

            // Clear it
            const { exitCode } = runCLI(["model", "use", "--clear"], testCtx.env);
            expect(exitCode).toBe(0);

            // Verify by reading config.yaml
            const configPath = path.join(testCtx.homeDir, ".config", "diogenes", "config.yaml");
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = yaml.parse(configContent);
            expect(config.llm?.model).toBeUndefined();
        });
    });

    describe("add provider and model", () => {
        it("should add a new provider", async () => {
            const { exitCode } = runCLI(
                ["model", "add-provider", "custom-provider", "--style", "openai", "--base-url", "https://api.custom.com/v1"],
                testCtx.env
            );
            expect(exitCode).toBe(0);

            // Verify by reading models.yaml
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers["custom-provider"]).toBeDefined();
            expect(models.providers["custom-provider"].style).toBe("openai");
            expect(models.providers["custom-provider"].baseURL).toBe("https://api.custom.com/v1");
        });

        it("should add a new model", async () => {
            // First add a provider
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);

            // Add a model
            const { exitCode } = runCLI(
                ["model", "add", "custom/my-model", "--name", "My Custom Model", "--context-window", "100000", "--max-tokens", "4000"],
                testCtx.env
            );
            expect(exitCode).toBe(0);

            // Verify by reading models.yaml
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers["custom"].models["my-model"]).toBeDefined();
            expect(models.providers["custom"].models["my-model"].name).toBe("My Custom Model");
            expect(models.providers["custom"].models["my-model"].contextWindow).toBe(100000);
            expect(models.providers["custom"].models["my-model"].maxTokens).toBe(4000);
        });
    });
});
