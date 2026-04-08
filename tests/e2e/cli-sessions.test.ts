import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    setupTestHome,
    teardownTestHome,
    runCLI,
    type TestContext,
} from "./helpers";

describe("bundled CLI session commands", () => {
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

    describe("session list", () => {
        it("should list sessions (empty)", async () => {
            const { stdout, exitCode } = runCLI(["session", "list"], testCtx.env);
            expect(exitCode).toBe(0);
            expect(stdout).toContain("No stored sessions");
        });
    });

    describe("session get errors", () => {
        it("should show error for unknown session", async () => {
            const { stderr, exitCode } = runCLI(["session", "get", "unknown-session-id"], testCtx.env);
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain("Unknown managed session");
        });

        it("should show error for unknown session snapshots", async () => {
            const { stderr, exitCode } = runCLI(["session", "snapshots", "unknown-session-id"], testCtx.env);
            expect(exitCode).not.toBe(0);
            expect(stderr).toContain("Unknown managed session");
        });
    });
});

describe("bundled CLI error handling without API key", () => {
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

    it("should error when running task without API key", async () => {
        const { stderr, exitCode } = runCLI(["run", "hello world"], testCtx.env);
        expect(exitCode).not.toBe(0);
        expect(stderr).toContain("API key is required");
        expect(stderr).toContain("OPENAI_API_KEY");
        expect(stderr).toContain("Troubleshooting tips");
    });
});
