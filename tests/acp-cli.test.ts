import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createConfig,
    createDebugStdio,
    formatACPCLIHelp,
    formatACPDoctorSummary,
    formatACPInitSummary,
    parseArgs,
} from "../src/acp-cli";
import * as resticManager from "../src/utils/restic-manager";
import { collectSetupDiagnostics } from "../src/utils/setup-diagnostics";

describe("acp-cli arg parsing", () => {
    it("parses restic binary option", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes-acp", "--restic-binary", "/tmp/restic"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toBe("server");
            expect(parsed.options.resticBinary).toBe("/tmp/restic");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses init command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes-acp", "init"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toBe("init");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("parses doctor command", () => {
        const originalArgv = process.argv;
        process.argv = ["node", "diogenes-acp", "doctor"];

        try {
            const parsed = parseArgs();
            expect(parsed.command).toBe("doctor");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("creates config with restic binary from environment", () => {
        const originalValue = process.env.DIOGENES_RESTIC_BINARY;
        process.env.DIOGENES_RESTIC_BINARY = "relative/restic";

        try {
            const config = createConfig({});
            expect(config.security?.snapshot?.resticBinary).toBe(path.resolve("relative/restic"));
        } finally {
            if (originalValue === undefined) {
                delete process.env.DIOGENES_RESTIC_BINARY;
            } else {
                process.env.DIOGENES_RESTIC_BINARY = originalValue;
            }
        }
    });

    it("creates config with restic binary from CLI option", () => {
        const config = createConfig({ resticBinary: "relative/restic" });
        expect(config.security?.snapshot?.resticBinary).toBe(path.resolve("relative/restic"));
    });
});

describe("acp-cli setup summaries", () => {
    it("formats help output with model management guidance", () => {
        const output = formatACPCLIHelp();

        expect(output).toContain("No subcommand starts the ACP stdio server.");
        expect(output).toContain("Model Management:");
        expect(output).toContain("<PROVIDER>_API_KEY");
        expect(output).toContain("claude-proxy -> CLAUDE_PROXY_API_KEY");
        expect(output).toContain("diogenes model add-provider <provider>");
        expect(output).toContain("diogenes model add <provider/model> --name <name>");
    });

    it("formats init output with ACP config example", async () => {
        const originalArgv = process.argv;
        process.argv = ["node", path.join(process.cwd(), "dist", "acp-cli.js"), "init"];
        vi.spyOn(resticManager, "ensureSnapshotResticConfigured").mockImplementation(
            async (config) => {
                config.security = {
                    ...(config.security || {}),
                    snapshot: {
                        ...(config.security?.snapshot || {}),
                        enabled: false,
                    },
                };
                return { enabled: false, reason: "snapshots disabled" };
            },
        );

        try {
            const config = createConfig({});
            await resticManager.ensureSnapshotResticConfigured(config, {
                configPath: path.join(process.cwd(), "config.yaml"),
            });
            const output = formatACPInitSummary(collectSetupDiagnostics(config));

            expect(output).toContain("Diogenes ACP Init");
            expect(output).toContain("ACP config example:");
            expect(output).toContain('"command": "node"');
            expect(output).toContain("node ");
        } finally {
            process.argv = originalArgv;
        }
    });

    it("formats doctor output with degraded snapshot state", () => {
        const config = createConfig({});
        config.security = {
            ...(config.security || {}),
            snapshot: {
                ...(config.security?.snapshot || {}),
                requestedEnabled: true,
                enabled: false,
                unavailableReason: "init:timeout: restic command timed out",
                resticBinary: "/tmp/restic-managed",
            },
        };

        const output = formatACPDoctorSummary(collectSetupDiagnostics(config));

        expect(output).toContain("Diogenes ACP Doctor");
        expect(output).toContain("ACP Logs Dir:");
        expect(output).toContain("ACP Current Log:");
        expect(output).toContain("mode: degraded");
        expect(output).toContain("phase: init");
        expect(output).toContain("kind: timeout");
        expect(output).toContain("init:timeout: restic command timed out");
    });
});

describe("createDebugStdio", () => {
    const createdFiles: string[] = [];

    afterEach(() => {
        for (const filePath of createdFiles) {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        createdFiles.length = 0;
    });

    it("mirrors ACP stdin, stdout, and stderr into the debug log file", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const error = new PassThrough();
        const outputChunks: string[] = [];
        const errorChunks: string[] = [];
        const debugFile = path.join(
            os.tmpdir(),
            `diogenes-acp-debug-${Date.now()}-${Math.random().toString(16).slice(2)}.log`,
        );

        createdFiles.push(debugFile);

        output.setEncoding("utf-8");
        output.on("data", (chunk: string) => outputChunks.push(chunk));
        error.setEncoding("utf-8");
        error.on("data", (chunk: string) => errorChunks.push(chunk));

        const debugStdio = createDebugStdio(
            debugFile,
            input as NodeJS.ReadStream,
            output as NodeJS.WriteStream,
            error as NodeJS.WriteStream,
        );

        const mirroredInputChunks: string[] = [];
        debugStdio.input.setEncoding("utf-8");
        debugStdio.input.on("data", (chunk: string) => mirroredInputChunks.push(chunk));

        input.write('{"jsonrpc":"2.0","id":1}\n');
        await new Promise((resolve) => setTimeout(resolve, 0));

        debugStdio.output.write('{"jsonrpc":"2.0","result":{"ok":true}}\n');
        debugStdio.error.write("transport warning\n");
        await new Promise((resolve) => setTimeout(resolve, 0));

        debugStdio.debugLog.end();
        await new Promise((resolve) => debugStdio.debugLog.on("finish", resolve));

        const debugContent = fs.readFileSync(debugFile, "utf-8");

        expect(mirroredInputChunks.join("")).toContain('{"jsonrpc":"2.0","id":1}');
        expect(outputChunks.join("")).toContain('{"jsonrpc":"2.0","result":{"ok":true}}');
        expect(errorChunks.join("")).toContain("transport warning");
        expect(debugContent).toContain("debug session started");
        expect(debugContent).toContain("stdin");
        expect(debugContent).toContain("stdout");
        expect(debugContent).toContain("stderr");
        expect(debugContent).toContain('{"jsonrpc":"2.0","id":1}');
        expect(debugContent).toContain('{"jsonrpc":"2.0","result":{"ok":true}}');
        expect(debugContent).toContain("transport warning");
    });
});
