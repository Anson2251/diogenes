import { afterEach, describe, expect, it } from "vitest";

import { setupTestHome, teardownTestHome, runACP, type TestContext } from "./helpers";

describe("bundled ACP CLI e2e", () => {
    let testCtx: TestContext;

    afterEach(async () => {
        if (testCtx?.homeDir) {
            await teardownTestHome(testCtx.homeDir);
        }
    });

    describe("basic ACP CLI commands", () => {
        it("should display version", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runACP(["--version"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
        });

        it("should display help", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runACP(["--help"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Usage: diogenes-acp");
            expect(stdout).toContain("init");
            expect(stdout).toContain("doctor");
            expect(stdout).toContain("Environment Variables:");
            expect(stdout).toContain("API Key Rule:");
        });
    });

    describe("ACP init command", () => {
        it("should create config files and show ACP config", async () => {
            testCtx = await setupTestHome();
            const { stdout, exitCode } = runACP(["init"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Diogenes ACP Init");
            expect(stdout).toContain("Config file:");
            expect(stdout).toContain("Models file:");
            expect(stdout).toContain("ACP command:");
            expect(stdout).toContain("ACP config example:");
            expect(stdout).toContain("command");
            expect(stdout).toContain("args");
            expect(stdout).toContain("env");
        });
    });

    describe("ACP doctor command", () => {
        it("should show detailed diagnostics", async () => {
            testCtx = await setupTestHome();
            runACP(["init"], testCtx.env);

            const { stdout, exitCode } = runACP(["doctor"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("Diogenes ACP Doctor");
            expect(stdout).toContain("Config Dir:");
            expect(stdout).toContain("Data Dir:");
            expect(stdout).toContain("ACP Logs Dir:");
            expect(stdout).toContain("Providers:");
            expect(stdout).toContain("Snapshots:");
        });
    });
});
