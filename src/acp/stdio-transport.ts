import { ACPServer } from "./server";
import type { ACPServerOptions, JsonRpcRequest } from "./types";

export interface ACPStdioOptions extends ACPServerOptions {
    input?: NodeJS.ReadStream;
    output?: NodeJS.WriteStream;
    error?: NodeJS.WriteStream;
}

export function startACPServer(options: ACPStdioOptions = {}): ACPServer {
    const input = options.input || process.stdin;
    const output = options.output || process.stdout;
    const error = options.error || process.stderr;

    const server = new ACPServer({
        ...options,
        notify: (method, params) => {
            output.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
        },
        respond: (response) => {
            output.write(`${JSON.stringify(response)}\n`);
        },
    });

    let buffer = "";
    input.setEncoding("utf-8");
    input.on("data", async (chunk: string) => {
        buffer += chunk;

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
            const rawLine = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (rawLine.length === 0) {
                newlineIndex = buffer.indexOf("\n");
                continue;
            }

            try {
                const message = JSON.parse(rawLine) as JsonRpcRequest;
                const response = await server.handleMessage(message);
                if (response) {
                    output.write(`${JSON.stringify(response)}\n`);
                }
            } catch (parseError) {
                error.write(
                    `ACP transport parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}\n`,
                );
            }

            newlineIndex = buffer.indexOf("\n");
        }
    });

    return server;
}
