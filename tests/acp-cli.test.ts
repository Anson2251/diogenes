import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { PassThrough } from "stream";
import { afterEach, describe, expect, it } from "vitest";

import { createDebugStdio } from "../src/acp-cli";

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
