import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        globals: true,
        environment: "node",
        include: ["tests/**/*.test.ts"],
        globalSetup: ["./tests/e2e/setup.ts"],
        testTimeout: 30000,
        coverage: {
            provider: "v8",
            reporter: ["text", "json", "html"],
        },
    },
});
