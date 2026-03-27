import type { TaskStopReason } from "../runtime/task-runner";

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: string | number | null;
    method: string;
    params?: any;
}

export interface JsonRpcSuccessResponse {
    jsonrpc: "2.0";
    id: string | number | null;
    result: any;
}

export interface JsonRpcErrorResponse {
    jsonrpc: "2.0";
    id: string | number | null;
    error: {
        code: number;
        message: string;
        data?: any;
    };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

export interface ACPServerOptions {
    config?: import("../types").DiogenesConfig;
    maxIterations?: number;
    notify?: (method: string, params: any) => void;
    respond?: (response: JsonRpcResponse) => void;
}

export interface InitializeParams {
    protocolVersion: number;
    clientCapabilities?: {
        fs?: {
            readTextFile?: boolean;
            writeTextFile?: boolean;
        };
        terminal?: boolean;
    };
    clientInfo?: {
        name: string;
        title?: string | null;
        version: string;
    };
}

export interface NewSessionParams {
    cwd: string;
    mcpServers?: any[];
}

export interface LoadSessionParams extends NewSessionParams {
    sessionId: string;
}

export interface PromptTextBlock {
    type: "text";
    text: string;
}

export interface PromptResourceLinkBlock {
    type: "resource_link";
    uri: string;
    name: string;
    title?: string | null;
    description?: string | null;
    mimeType?: string | null;
    size?: number | null;
}

export interface PromptEmbeddedResourceBlock {
    type: "resource";
    resource: {
        uri: string;
        text?: string;
        blob?: string;
        mimeType?: string | null;
    };
}

export type PromptBlock =
    | PromptTextBlock
    | PromptResourceLinkBlock
    | PromptEmbeddedResourceBlock;

export interface PromptSessionParams {
    sessionId: string;
    prompt: PromptBlock[];
}

export interface CancelSessionParams {
    sessionId: string;
}

export interface RestoreSessionParams {
    sessionId: string;
    snapshotId: string;
}

export interface ListSessionsParams {
    cwd?: string;
    cursor?: string;
    pageSize?: number;
}

export interface DiogenesGetSessionParams {
    sessionId: string;
    includeSnapshots?: boolean;
}

export interface DiogenesDisposeSessionParams {
    sessionId: string;
}

export interface DiogenesDeleteSessionParams {
    sessionId: string;
}

export interface DiogenesPruneSessionsParams {
    dryRun?: boolean;
}

export interface DiogenesRestoreSessionParams {
    sessionId: string;
    snapshotId: string;
}

export interface SessionUpdateNotification {
    sessionId: string;
    update: any;
}

export interface AvailableCommandInput {
    hint: string;
}

export interface AvailableCommand {
    name: string;
    description: string;
    input?: AvailableCommandInput;
}

export type SessionLifecycleState =
    | "active"
    | "running"
    | "disposing"
    | "disposed";

export interface SessionMetadata {
    sessionId: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    title: string | null;
    description: string | null;
    state: SessionLifecycleState;
    hasActiveRun: boolean;
}

export interface StoredSessionMetadata extends SessionMetadata {
    availableCommands: AvailableCommand[];
    snapshotEnabled: boolean;
}

export interface ACPPromptResult {
    stopReason: TaskStopReason;
}
