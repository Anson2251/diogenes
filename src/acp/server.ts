import * as path from "path";
import type { DiogenesConfig } from "../types";
import { SessionManager } from "./session-manager";
import type {
    ACPServerOptions,
    CancelSessionParams,
    InitializeParams,
    JsonRpcErrorResponse,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcSuccessResponse,
    NewSessionParams,
    PromptSessionParams,
} from "./types";

const JSON_RPC_VERSION = "2.0";
const ACP_PROTOCOL_VERSION = 1;

export class ACPServer {
    private readonly sessionManager: SessionManager;
    private initialized = false;

    constructor(private readonly options: ACPServerOptions = {}) {
        const config: DiogenesConfig = options.config || {};
        this.sessionManager = new SessionManager(
            config,
            options.maxIterations || 20,
            (method, params) => this.options.notify?.(method, params),
        );
    }

    async handleMessage(message: JsonRpcRequest): Promise<JsonRpcResponse | null> {
        if (message.jsonrpc !== JSON_RPC_VERSION) {
            return this.error(message.id ?? null, -32600, "Invalid Request");
        }

        if (!message.method) {
            return this.error(message.id ?? null, -32600, "Invalid Request");
        }

        try {
            switch (message.method) {
                case "initialize":
                    return this.success(
                        message.id ?? null,
                        this.handleInitialize(message.params as InitializeParams),
                    );
                case "session/new":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        this.handleNewSession(message.params as NewSessionParams),
                    );
                case "session/prompt":
                    this.ensureInitialized(message.id ?? null);
                    if (this.options.respond) {
                        this.handlePromptInBackground(
                            message.id ?? null,
                            message.params as PromptSessionParams,
                        );
                        return null;
                    }
                    return this.success(
                        message.id ?? null,
                        await this.handlePrompt(message.params as PromptSessionParams),
                    );
                case "session/cancel":
                    this.ensureInitialized(message.id ?? null);
                    this.handleCancel(message.params as CancelSessionParams);
                    return null;
                default:
                    return this.error(message.id ?? null, -32601, `Method not found: ${message.method}`);
            }
        } catch (error) {
            if (error instanceof ACPServerError) {
                return this.error(message.id ?? null, error.code, error.message, error.data);
            }
            return this.error(
                message.id ?? null,
                -32000,
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    private handleInitialize(params: InitializeParams | undefined) {
        const requestedVersion = params?.protocolVersion || ACP_PROTOCOL_VERSION;
        this.initialized = true;

        return {
            protocolVersion: Math.min(requestedVersion, ACP_PROTOCOL_VERSION),
            agentCapabilities: {
                loadSession: false,
                promptCapabilities: {
                    audio: false,
                    embeddedContext: false,
                    image: false,
                },
                mcpCapabilities: {
                    http: false,
                    sse: false,
                },
                sessionCapabilities: {},
            },
            agentInfo: {
                name: "diogenes",
                title: "Diogenes",
                version: "0.1.0",
            },
            authMethods: [],
        };
    }

    private handleNewSession(params: NewSessionParams | undefined) {
        if (!params?.cwd || !path.isAbsolute(params.cwd)) {
            throw new ACPServerError(-32602, "session/new requires an absolute cwd");
        }

        const session = this.sessionManager.createSession(params.cwd);
        return {
            sessionId: session.sessionId,
        };
    }

    private async handlePrompt(params: PromptSessionParams | undefined) {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/prompt requires sessionId");
        }
        if (!Array.isArray(params.prompt)) {
            throw new ACPServerError(-32602, "session/prompt requires prompt blocks");
        }

        const session = this.sessionManager.getSession(params.sessionId);
        if (!session) {
            throw new ACPServerError(-32001, `Unknown session: ${params.sessionId}`);
        }
        if (session.isBusy()) {
            throw new ACPServerError(-32002, `Session is busy: ${params.sessionId}`);
        }

        const result = await session.prompt(params.prompt);
        return {
            stopReason: result.stopReason,
        };
    }

    private handlePromptInBackground(
        id: string | number | null,
        params: PromptSessionParams | undefined,
    ): void {
        void this.handlePrompt(params)
            .then((result) => {
                this.options.respond?.(this.success(id, result));
            })
            .catch((error) => {
                if (error instanceof ACPServerError) {
                    this.options.respond?.(this.error(id, error.code, error.message, error.data));
                    return;
                }

                this.options.respond?.(
                    this.error(
                        id,
                        -32000,
                        error instanceof Error ? error.message : String(error),
                    ),
                );
            });
    }

    private handleCancel(params: CancelSessionParams | undefined): void {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/cancel requires sessionId");
        }
        this.sessionManager.cancelSession(params.sessionId);
    }

    private ensureInitialized(_id: string | number | null): void {
        if (!this.initialized) {
            throw new ACPServerError(-32099, "Server not initialized");
        }
    }

    private success(id: string | number | null, result: any): JsonRpcSuccessResponse {
        return {
            jsonrpc: JSON_RPC_VERSION,
            id,
            result,
        };
    }

    private error(
        id: string | number | null,
        code: number,
        message: string,
        data?: any,
    ): JsonRpcErrorResponse {
        return {
            jsonrpc: JSON_RPC_VERSION,
            id,
            error: { code, message, data },
        };
    }
}

class ACPServerError extends Error {
    constructor(
        readonly code: number,
        message: string,
        readonly data?: any,
    ) {
        super(message);
    }
}
