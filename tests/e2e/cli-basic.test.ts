import { afterEach, describe, expect, it } from "vitest";
import * as yaml from "yaml";
import * as path from "path";
import * as fs from "fs/promises";
import {
    setupTestHome,
    teardownTestHome,
    runCLI,
    type TestContext,
} from "./helpers";

describe("bundled CLI basic commands", () => {
    let testCtx: TestContext;

    afterEach(async () => {
        if (testCtx?.homeDir) {
            await teardownTestHome(testCtx.homeDir);
        }
    });

    describe("version and help", () => {
        it("should display version", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runCLI(["--version"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
        });

        it("should display help", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runCLI(["--help"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Usage: diogenes");
            expect(stdout).toContain("Options:");
            expect(stdout).toContain("Commands:");
            expect(stdout).toContain("run");
            expect(stdout).toContain("init");
            expect(stdout).toContain("doctor");
            expect(stdout).toContain("session");
            expect(stdout).toContain("model");
        });
    });

    describe("init command", () => {
        it("should create config files on first run", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runCLI(["init"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Diogenes Init");
            expect(stdout).toContain("Config file:");
            expect(stdout).toContain("Models file:");

            // Verify files were created
            const configPath = path.join(testCtx.homeDir, ".config", "diogenes", "config.yaml");
            const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");

            const configExists = await fs.access(configPath).then(() => true).catch(() => false);
            const modelsExists = await fs.access(modelsPath).then(() => true).catch(() => false);

            expect(configExists).toBe(true);
            expect(modelsExists).toBe(true);
        });

        it("should include provider info in init output", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runCLI(["init"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Set one provider API key");
            expect(stdout).toContain("OPENAI_API_KEY");
        });
    });

    describe("doctor command", () => {
        it("should show detailed diagnostics", async () => {
            testCtx = await setupTestHome();
            runCLI(["init"], testCtx.env); // First init to create files

            const { stdout, exitCode } = runCLI(["doctor"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Diogenes Doctor");
            expect(stdout).toContain("Config Dir:");
            expect(stdout).toContain("Data Dir:");
            expect(stdout).toContain("Config File:");
            expect(stdout).toContain("Models File:");
            expect(stdout).toContain("Providers:");
            expect(stdout).toContain("openai:");
            expect(stdout).toContain("anthropic:");
            expect(stdout).toContain("Snapshots:");
        });

        it("should show config file status (auto-creates on first run)", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runCLI(["doctor"], testCtx.env);
            expect(exitCode).toBe(0);
            // Doctor auto-creates config files, so they should be present
            expect(stdout).toContain("Config File: present");
            expect(stdout).toContain("Models File: present");
        });
    });
});

describe("config file structure", () => {
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

    it("should create valid config.yaml structure", async () => {
        const configPath = path.join(testCtx.homeDir, ".config", "diogenes", "config.yaml");
        const configContent = await fs.readFile(configPath, "utf-8");
        const config = yaml.parse(configContent);

        // Config should have security settings but no LLM apiKey
        expect(config).toHaveProperty("security");
        // Security should have snapshot settings
        expect(config.security).toHaveProperty("snapshot");
        expect(config.security.snapshot).toHaveProperty("enabled");

        // LLM should not have apiKey (it's resolved from env)
        if (config.llm) {
            expect(config.llm.apiKey).toBeUndefined();
        }
    });

    it("should create valid models.yaml structure", async () => {
        const modelsPath = path.join(testCtx.homeDir, ".config", "diogenes", "models.yaml");
        const modelsContent = await fs.readFile(modelsPath, "utf-8");
        const models = yaml.parse(modelsContent);

        // Should have providers
        expect(models).toHaveProperty("providers");
        expect(models.providers).toHaveProperty("openai");
        expect(models.providers).toHaveProperty("anthropic");
        expect(models.providers).toHaveProperty("openrouter");

        // Each provider should have models
        expect(models.providers.openai).toHaveProperty("models");
        expect(models.providers.openai.models).toHaveProperty("gpt-4o");

        // Each model should have required fields
        const gpt4o = models.providers.openai.models["gpt-4o"];
        expect(gpt4o).toHaveProperty("name");
        expect(gpt4o).toHaveProperty("contextWindow");
    });
});
