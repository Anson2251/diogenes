import { Readable, Writable } from "stream";

import type { ACPServerOptions } from "./types";

import { ACPServer } from "./server";
import { JsonRpcRequestSchema } from "./types";

export interface ACPStdioOptions extends ACPServerOptions {
    input?: NodeJS.ReadStream | Readable;
    output?: NodeJS.WriteStream | Writable;
    error?: NodeJS.WriteStream | Writable;
}

export function startACPServer(options: ACPStdioOptions = {}): ACPServer {
    const input = options.input || process.stdin;
    const output = options.output || process.stdout;
    const error = options.error || process.stderr;

    const server = new ACPServer({
        ...options,
        notify: (method, params) => {
            output.write(
                `${JSON.stringify({ jsonrpc: "2.0", method, params: params as unknown })}\n`,
            );
        },
        respond: (response) => {
            output.write(`${JSON.stringify(response)}\n`);
        },
    });

    let buffer = "";
    let disposeStarted = false;

    const disposeServer = () => {
        if (disposeStarted) {
            return;
        }

        disposeStarted = true;
        void server.dispose().catch((disposeError: unknown) => {
            error.write(
                `ACP transport dispose error: ${disposeError instanceof Error ? disposeError.message : String(disposeError)}\n`,
            );
        });
    };

    input.setEncoding("utf-8");
    input.on("data", (chunk: string) => {
        buffer += chunk;

        let newlineIndex = buffer.indexOf("\n");
        while (newlineIndex !== -1) {
            const rawLine = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);

            if (rawLine.length === 0) {
                newlineIndex = buffer.indexOf("\n");
                continue;
            }

            void (async () => {
                try {
                    const rawMessage: unknown = JSON.parse(rawLine);
                    const parseResult = JsonRpcRequestSchema.safeParse(rawMessage);
                    if (!parseResult.success) {
                        error.write(`ACP transport parse error: Invalid JSON-RPC message format\n`);
                        return;
                    }
                    const response = await server.handleMessage(parseResult.data);
                    if (response) {
                        output.write(`${JSON.stringify(response)}\n`);
                    }
                } catch (parseError: unknown) {
                    error.write(
                        `ACP transport parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}\n`,
                    );
                }
            })();

            newlineIndex = buffer.indexOf("\n");
        }
    });
    input.on("end", disposeServer);
    input.on("close", disposeServer);

    return server;
}
