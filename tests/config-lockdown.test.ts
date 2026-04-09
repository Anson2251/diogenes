import { afterEach, describe, expect, it, vi } from "vitest";

import { parseArgs as parseCliArgs } from "../src/cli";

function withArgv(argv: string[], run: () => void): void {
    const originalArgv = process.argv;
    process.argv = argv;

    try {
        run();
    } finally {
        process.argv = originalArgv;
    }
}

describe("config path lockdown", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rejects --config in the main CLI", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code?: string | number | null,
        ) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        withArgv(["node", "diogenes", "--config", "/tmp/custom.yaml"], () => {
            expect(() => parseCliArgs()).toThrow("process.exit:1");
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it("rejects --config-file for ACP command", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code?: string | number | null,
        ) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        withArgv(["node", "diogenes", "acp", "--config-file", "/tmp/custom.yaml"], () => {
            expect(() => parseCliArgs()).toThrow("process.exit:1");
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalled();
    });

    it("rejects --config for ACP command", () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
            code?: string | number | null,
        ) => {
            throw new Error(`process.exit:${code ?? 0}`);
        }) as never);
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        withArgv(["node", "diogenes", "acp", "--config", "/tmp/custom.yaml"], () => {
            expect(() => parseCliArgs()).toThrow("process.exit:1");
        });

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(errorSpy).toHaveBeenCalled();
    });
});
