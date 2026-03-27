import * as path from "path";
import type { DiogenesConfig } from "../types";
import { SessionManager } from "./session-manager";
import type {
    ACPServerOptions,
    CancelSessionParams,
    DiogenesDeleteSessionParams,
    DiogenesPruneSessionsParams,
    DiogenesDisposeSessionParams,
    DiogenesGetSessionParams,
    DiogenesRestoreSessionParams,
    InitializeParams,
    JsonRpcErrorResponse,
    JsonRpcRequest,
    JsonRpcResponse,
    JsonRpcSuccessResponse,
    ListSessionsParams,
    LoadSessionParams,
    NewSessionParams,
    PromptSessionParams,
    RestoreSessionParams,
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
            options.maxIterations,
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
                    {
                        const session = await this.handleNewSession(message.params as NewSessionParams);
                        const response = this.success(
                            message.id ?? null,
                            { sessionId: session.sessionId },
                        );
                        setTimeout(() => {
                            session.emitAvailableCommandsUpdate();
                        }, 0);
                        return response;
                    }
                case "session/load":
                    this.ensureInitialized(message.id ?? null);
                    await this.handleLoadSession(message.params as LoadSessionParams | undefined);
                    return this.success(message.id ?? null, null);
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
                case "session/restore":
                case "_diogenes/session/restore":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleRestore(message.params as RestoreSessionParams | DiogenesRestoreSessionParams),
                    );
                case "session/list":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleListSessions(message.params as ListSessionsParams | undefined),
                    );
                case "session/get":
                case "_diogenes/session/get":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleGetSession(message.params as DiogenesGetSessionParams | undefined),
                    );
                case "session/snapshots":
                case "_diogenes/session/snapshots":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleSessionSnapshots(message.params as DiogenesGetSessionParams | undefined),
                    );
                case "session/dispose":
                case "_diogenes/session/dispose":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleDisposeSession(message.params as DiogenesDisposeSessionParams | undefined),
                    );
                case "_diogenes/session/delete":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handleDeleteSession(message.params as DiogenesDeleteSessionParams | undefined),
                    );
                case "_diogenes/session/prune":
                    this.ensureInitialized(message.id ?? null);
                    return this.success(
                        message.id ?? null,
                        await this.handlePruneSessions(message.params as DiogenesPruneSessionsParams | undefined),
                    );
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

    async dispose(): Promise<void> {
        await this.sessionManager.disposeAllSessions();
    }

    private handleInitialize(params: InitializeParams | undefined) {
        const requestedVersion = params?.protocolVersion || ACP_PROTOCOL_VERSION;
        this.initialized = true;

        return {
            protocolVersion: Math.min(requestedVersion, ACP_PROTOCOL_VERSION),
            agentCapabilities: {
                loadSession: true,
                promptCapabilities: {
                    audio: false,
                    embeddedContext: false,
                    image: false,
                },
                mcpCapabilities: {
                    http: false,
                    sse: false,
                },
                sessionCapabilities: {
                    list: {},
                    _meta: {
                        "diogenes": {
                            getSession: true,
                            disposeSession: true,
                            deleteSession: true,
                            pruneSessions: true,
                            listSnapshots: true,
                            restoreSnapshot: true,
                            sessionDetailsInMeta: true,
                        },
                    },
                },
                _meta: {
                    "diogenes": {
                        extensionMethods: {
                            getSession: "_diogenes/session/get",
                            listSnapshots: "_diogenes/session/snapshots",
                            disposeSession: "_diogenes/session/dispose",
                            deleteSession: "_diogenes/session/delete",
                            pruneSessions: "_diogenes/session/prune",
                            restoreSnapshot: "_diogenes/session/restore",
                        },
                    },
                },
            },
            agentInfo: {
                name: "diogenes",
                title: "Diogenes",
                version: "0.1.0",
            },
            authMethods: [],
        };
    }

    private async handleNewSession(params: NewSessionParams | undefined) {
        if (!params?.cwd || !path.isAbsolute(params.cwd)) {
            throw new ACPServerError(-32602, "session/new requires an absolute cwd");
        }

        return this.sessionManager.createSession(params.cwd);
    }

    private async handleLoadSession(params: LoadSessionParams | undefined): Promise<void> {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/load requires sessionId");
        }
        if (!params.cwd || !path.isAbsolute(params.cwd)) {
            throw new ACPServerError(-32602, "session/load requires an absolute cwd");
        }

        const session = await this.sessionManager.loadSession(params);
        for (const update of session.getReplayUpdates()) {
            this.options.notify?.("session/update", {
                sessionId: session.sessionId,
                update,
            });
        }

        session.emitHydratedStateUpdates();
        session.emitAvailableCommandsUpdate();
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
        const state = session.getLifecycleState();
        if (state === "disposing" || state === "disposed") {
            throw new ACPServerError(-32003, `Session is not available: ${params.sessionId}`);
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

    private async handleRestore(params: RestoreSessionParams | undefined) {
        if (!params?.sessionId || !params.snapshotId) {
            throw new ACPServerError(-32602, "session/restore requires sessionId and snapshotId");
        }

        const session = this.sessionManager.getSession(params.sessionId);
        if (!session) {
            throw new ACPServerError(-32001, `Unknown session: ${params.sessionId}`);
        }
        if (session.isBusy()) {
            throw new ACPServerError(-32002, `Session is busy: ${params.sessionId}`);
        }

        const restoreResult = await session.restoreSnapshotWithNotifications(params.snapshotId);

        return {
            restored: true,
            metadata: session.getMetadata(),
            _meta: {
                diogenes: {
                    safetySnapshotId: restoreResult.safetySnapshotId,
                },
            },
        };
    }

    private async handleListSessions(params: ListSessionsParams | undefined) {
        if (params?.cwd && !path.isAbsolute(params.cwd)) {
            throw new ACPServerError(-32602, "session/list cwd must be an absolute path");
        }
        if (params?.pageSize !== undefined && (!Number.isInteger(params.pageSize) || params.pageSize <= 0)) {
            throw new ACPServerError(-32602, "session/list pageSize must be a positive integer");
        }

        const result = await this.sessionManager.listSessionMetadata({
            cwd: params?.cwd,
            cursor: params?.cursor,
            pageSize: params?.pageSize,
        });

        return {
            sessions: result.sessions.map((session) => this.createSessionSummary(session)),
            nextCursor: result.nextCursor,
            _meta: {
                diogenes: {
                    pageSize: result.pageSize,
                    supportsCursorPagination: true,
                },
            },
        };
    }

    private async handleGetSession(params: DiogenesGetSessionParams | undefined) {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/get requires sessionId");
        }

        const session = this.sessionManager.getSession(params.sessionId);
        const storedSession = await this.sessionManager.getSessionMetadata(params.sessionId, {
            includeSnapshots: params.includeSnapshots,
        });
        if (!storedSession) {
            throw new ACPServerError(-32001, `Unknown session: ${params.sessionId}`);
        }

        return {
            session: this.createSessionDetail(storedSession, session !== undefined),
            ...(params.includeSnapshots ? { snapshots: storedSession.snapshots ?? [] } : {}),
        };
    }

    private async handleSessionSnapshots(params: DiogenesGetSessionParams | undefined) {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/snapshots requires sessionId");
        }

        const session = this.sessionManager.getSession(params.sessionId);
        const snapshots = await this.sessionManager.listSnapshots(params.sessionId);
        if (!session && snapshots === null) {
            throw new ACPServerError(-32001, `Unknown session: ${params.sessionId}`);
        }

        return {
            sessionId: params.sessionId,
            snapshots: snapshots ?? [],
            liveSession: session !== undefined,
        };
    }

    private async handleDisposeSession(params: DiogenesDisposeSessionParams | undefined) {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/dispose requires sessionId");
        }

        const disposed = await this.sessionManager.closeSession(params.sessionId);
        if (!disposed) {
            throw new ACPServerError(-32001, `Unknown live session: ${params.sessionId}`);
        }

        return {
            disposed: true,
            sessionId: params.sessionId,
        };
    }

    private async handleDeleteSession(params: DiogenesDeleteSessionParams | undefined) {
        if (!params?.sessionId) {
            throw new ACPServerError(-32602, "session/delete requires sessionId");
        }

        const deleted = await this.sessionManager.deleteSession(params.sessionId);
        if (!deleted) {
            throw new ACPServerError(-32001, `Unknown session: ${params.sessionId}`);
        }

        return {
            deleted: true,
            sessionId: params.sessionId,
        };
    }

    private async handlePruneSessions(params: DiogenesPruneSessionsParams | undefined) {
        const result = await this.sessionManager.pruneSessions({ dryRun: params?.dryRun });
        return {
            deletedSessionIds: result.deletedSessionIds,
            keptSessionIds: result.keptSessionIds,
            reasonsBySessionId: result.reasonsBySessionId,
            dryRun: params?.dryRun === true,
        };
    }

    private createSessionSummary(session: {
        sessionId: string;
        cwd: string;
        title: string | null;
        description: string | null;
        createdAt: string;
        updatedAt: string;
        state: string;
        hasActiveRun: boolean;
        snapshotEnabled: boolean;
        snapshotCount: number;
        availableCommands: unknown[];
    }) {
        return {
            sessionId: session.sessionId,
            cwd: session.cwd,
            title: session.title,
            updatedAt: session.updatedAt,
            _meta: {
                diogenes: {
                    description: session.description,
                    createdAt: session.createdAt,
                    state: session.state,
                    hasActiveRun: session.hasActiveRun,
                    liveSession: this.sessionManager.getSession(session.sessionId) !== undefined,
                    snapshotEnabled: session.snapshotEnabled,
                    snapshotCount: session.snapshotCount,
                    availableCommands: session.availableCommands,
                },
            },
        };
    }

    private createSessionDetail(session: {
        sessionId: string;
        cwd: string;
        title: string | null;
        description: string | null;
        createdAt: string;
        updatedAt: string;
        state: string;
        hasActiveRun: boolean;
        snapshotEnabled: boolean;
        availableCommands: unknown[];
        snapshotCount?: number;
    }, liveSession: boolean) {
        return {
            ...this.createSessionSummary({
                ...session,
                snapshotCount: session.snapshotCount ?? 0,
            }),
            _meta: {
                diogenes: {
                    description: session.description,
                    createdAt: session.createdAt,
                    state: session.state,
                    hasActiveRun: session.hasActiveRun,
                    liveSession,
                    snapshotEnabled: session.snapshotEnabled,
                    availableCommands: session.availableCommands,
                    snapshotCount: session.snapshotCount ?? 0,
                },
            },
        };
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
