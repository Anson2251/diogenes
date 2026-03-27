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

export interface ACPPromptResult {
    stopReason: TaskStopReason;
}
