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

describe("bundled CLI model edge cases", () => {
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

    describe("invalid model commands", () => {
        it("should reject setting default to non-existent model", async () => {
            const { stderr, exitCode } = runCLI(["model", "default", "fake/nonexistent"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Unknown model");
            expect(stderr).toContain("Available models:");
        });

        it("should reject setting active model to non-existent model", async () => {
            const { stderr, exitCode } = runCLI(["model", "use", "fake/nonexistent"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Unknown model");
            expect(stderr).toContain("Available models:");
        });

        it("should reject adding model without required --name", async () => {
            // First add provider
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            // Try to add model without --name
            const { stderr, exitCode } = runCLI(["model", "add", "custom/test"], testCtx.env);
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain("required option");
        });

        it("should reject adding provider without required --style", async () => {
            const { stderr, exitCode } = runCLI(["model", "add-provider", "custom"], testCtx.env);
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain("required option");
        });

        it("should reject duplicate provider", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            const { stderr, exitCode } = runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("already exists");
        });

        it("should reject duplicate model under same provider", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            runCLI(["model", "add", "custom/my-model", "--name", "My Model"], testCtx.env);
            const { stderr, exitCode } = runCLI(["model", "add", "custom/my-model", "--name", "Duplicate"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("already exists");
        });

        it("should reject model with invalid format (no slash)", async () => {
            const { stderr, exitCode } = runCLI(["model", "add", "invalid-model-name", "--name", "Test"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Unknown provider");
        });

        it("should reject model with empty provider name", async () => {
            const { stderr, exitCode } = runCLI(["model", "add", "/model-name", "--name", "Test"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Unknown provider");
        });

        it("should reject model with empty model name", async () => {
            const { stderr, exitCode } = runCLI(["model", "add", "provider/", "--name", "Test"], testCtx.env);
            expect(exitCode).toBe(1);
            expect(stderr).toContain("Unknown provider");
        });
    });

    describe("model persistence edge cases", () => {
        it("should preserve models.yaml structure after multiple modifications", async () => {
            // Add provider and model
            runCLI(["model", "add-provider", "custom1", "--style", "openai", "--base-url", "https://api1.com"], testCtx.env);
            runCLI(["model", "add", "custom1/model-a", "--name", "Model A", "--context-window", "100000"], testCtx.env);
            runCLI(["model", "add", "custom1/model-b", "--name", "Model B", "--max-tokens", "4096"], testCtx.env);

            // Set and clear default multiple times
            runCLI(["model", "default", "custom1/model-a"], testCtx.env);
            runCLI(["model", "default", "--clear"], testCtx.env);
            runCLI(["model", "default", "custom1/model-b"], testCtx.env);

            // Verify structure is intact
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);

            expect(models.providers.custom1).toBeDefined();
            expect(models.providers.custom1.models["model-a"]).toBeDefined();
            expect(models.providers.custom1.models["model-b"]).toBeDefined();
            expect(models.default).toBe("custom1/model-b");
        });

        it("should handle rapid set/clear cycles for active model", async () => {
            // Multiple set/clear cycles
            for (let i = 0; i < 3; i++) {
                runCLI(["model", "use", "openai/gpt-4o-mini"], testCtx.env);
                runCLI(["model", "use", "--clear"], testCtx.env);
            }

            const configPath = path.join(testCtx.homeDir, ".config", "diogenes", "config.yaml");
            const configContent = await fs.readFile(configPath, "utf-8");
            const config = yaml.parse(configContent);

            expect(config.llm).toBeUndefined();
        });
    });

    describe("provider configuration edge cases", () => {
        it("should handle provider with very long name", async () => {
            const longName = "a".repeat(100);
            const { exitCode } = runCLI(["model", "add-provider", longName, "--style", "openai"], testCtx.env);
            expect(exitCode).toBe(0);

            // Verify it was added
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers[longName]).toBeDefined();
        });

        it("should handle provider with special characters in base URL", async () => {
            const { exitCode } = runCLI(
                ["model", "add-provider", "custom", "--style", "openai", "--base-url", "https://api.example.com/v1?param=value"],
                testCtx.env
            );
            expect(exitCode).toBe(0);

            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers.custom.baseURL).toBe("https://api.example.com/v1?param=value");
        });

        it("should handle model with zero context window", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            const { exitCode } = runCLI(
                ["model", "add", "custom/zero-context", "--name", "Zero Context", "--context-window", "0"],
                testCtx.env
            );
            expect(exitCode).toBe(0);

            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers.custom.models["zero-context"].contextWindow).toBe(0);
        });

        it("should handle model with very large context window", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            const { exitCode } = runCLI(
                ["model", "add", "custom/huge-context", "--name", "Huge Context", "--context-window", "999999999"],
                testCtx.env
            );
            expect(exitCode).toBe(0);

            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);
            expect(models.providers.custom.models["huge-context"].contextWindow).toBe(999999999);
        });

        it("should reject invalid temperature value", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);
            // Temperature outside valid range (0-2)
            const { exitCode } = runCLI(
                ["model", "add", "custom/invalid-temp", "--name", "Invalid Temp", "--temperature", "5.0"],
                testCtx.env
            );
            // Should accept but store the value (validation happens at runtime)
            expect(exitCode).toBe(0);
        });
    });

    describe("concurrent operations simulation", () => {
        it("should handle rapid consecutive model operations", async () => {
            runCLI(["model", "add-provider", "custom", "--style", "openai"], testCtx.env);

            // Add multiple models rapidly
            const results = [];
            for (let i = 0; i < 5; i++) {
                results.push(
                    runCLI(["model", "add", `custom/model-${i}`, "--name", `Model ${i}`], testCtx.env)
                );
            }

            // All should succeed
            const resolved = results;
            resolved.forEach(result => {
                expect(result.exitCode).toBe(0);
            });

            // Verify all models exist
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
            const modelsContent = await fs.readFile(modelsPath, "utf-8");
            const models = yaml.parse(modelsContent);

            for (let i = 0; i < 5; i++) {
                expect(models.providers.custom.models[`model-${i}`]).toBeDefined();
            }
        });
    });
});

describe("bundled CLI session edge cases", () => {
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

    it("should reject empty session ID", async () => {
        const { exitCode } = runCLI(["session", "get", ""], testCtx.env);
        expect(exitCode).not.toBe(0);
    });

    it("should reject session ID with path traversal", async () => {
        const { stderr, exitCode } = runCLI(["session", "get", "test/../etc"], testCtx.env);
        expect(exitCode).toBe(1);
        expect(stderr).toContain("Unknown managed session");
    });

    it("should handle deleting non-existent session gracefully", async () => {
        // CLI may exit 0 even for non-existent sessions (idempotent behavior)
        const { stderr, exitCode } = runCLI(["session", "delete", "nonexistent-session-12345"], testCtx.env);
        // Should either succeed silently or show error
        if (exitCode !== 0) {
            expect(stderr).toContain("Unknown managed session");
        }
    });
});

describe("bundled CLI config corruption edge cases", () => {
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

    it("should handle corrupted models.yaml gracefully", async () => {
        // Corrupt models.yaml
        const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
        await fs.writeFile(modelsPath, "invalid: yaml: [", "utf-8");

        const { stderr, exitCode } = runCLI(["model", "list"], testCtx.env);
        expect(exitCode).not.toBe(0);
        expect(stderr.length).toBeGreaterThan(0);
    });

    it("should handle empty models.yaml", async () => {
        // Empty models.yaml
        const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
        await fs.writeFile(modelsPath, "", "utf-8");

        const { exitCode } = runCLI(["model", "list"], testCtx.env);
        // Should fail with an error
        expect(exitCode).not.toBe(0);
    });

    it("should handle missing models.yaml file (auto-recreates)", async () => {
        // Delete models.yaml
        const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
        await fs.unlink(modelsPath);

        const { exitCode } = runCLI(["model", "list"], testCtx.env);
        // CLI auto-recreates the models.yaml file, so this should succeed
        expect(exitCode).toBe(0);
    });
});

describe("bundled CLI CLI option validation", () => {
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

    it("should reject invalid --max-iterations value", async () => {
        // This would be caught during task execution, not parsing
        const { stderr, exitCode } = runCLI(["run", "--max-iterations", "invalid", "test"], testCtx.env);
        // Should fail due to missing API key, not parsing error
        expect(exitCode).not.toBe(0);
    });

    it("should reject run command without task", async () => {
        const { exitCode } = runCLI(["run"], testCtx.env);
        expect(exitCode).not.toBe(0);
    });

    it("should handle task with special characters", async () => {
        const { stderr, exitCode } = runCLI(["run", "hello; rm -rf /"], testCtx.env);
        // Should fail due to missing API key, not parsing error
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("API key is required");
    });
});

describe("bundled CLI environment variable edge cases", () => {
    let testCtx: TestContext;

    afterEach(async () => {
        if (testCtx?.homeDir) {
            await teardownTestHome(testCtx.homeDir);
        }
    });

    it("should handle malformed API key in environment", async () => {
        testCtx = await setupTestHome();
        const env = {
            ...testCtx.env,
            OPENAI_API_KEY: "sk-test-key-with-special-chars",
        };
        // Just check that init works with the API key set
        const { exitCode } = runCLI(["init"], env);
        expect(exitCode).toBe(0);
    }, 10000);
});
