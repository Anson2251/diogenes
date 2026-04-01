import { z } from "zod";

import type { TaskStopReason } from "../runtime/task-runner";
import type { ACPLogger } from "./logger";

// Zod schemas for RPC params validation
export const InitializeParamsSchema = z.object({
    protocolVersion: z.number(),
    clientCapabilities: z
        .object({
            fs: z
                .object({
                    readTextFile: z.boolean().optional(),
                    writeTextFile: z.boolean().optional(),
                })
                .optional(),
            terminal: z.boolean().optional(),
        })
        .optional(),
    clientInfo: z
        .object({
            name: z.string(),
            title: z.string().nullable().optional(),
            version: z.string(),
        })
        .optional(),
});

export const NewSessionParamsSchema = z.object({
    cwd: z.string(),
    mcpServers: z.array(z.any()).optional(),
});

export const LoadSessionParamsSchema = NewSessionParamsSchema.extend({
    sessionId: z.string(),
});

export const PromptTextBlockSchema = z.object({
    type: z.literal("text"),
    text: z.string(),
});

export const PromptResourceLinkBlockSchema = z.object({
    type: z.literal("resource_link"),
    uri: z.string(),
    name: z.string(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    size: z.number().nullable().optional(),
});

export const PromptEmbeddedResourceBlockSchema = z.object({
    type: z.literal("resource"),
    resource: z.object({
        uri: z.string(),
        text: z.string().optional(),
        blob: z.string().optional(),
        mimeType: z.string().nullable().optional(),
    }),
});

export const PromptBlockSchema = z.union([
    PromptTextBlockSchema,
    PromptResourceLinkBlockSchema,
    PromptEmbeddedResourceBlockSchema,
]);

export const PromptSessionParamsSchema = z.object({
    sessionId: z.string(),
    prompt: z.array(PromptBlockSchema),
});

export const CancelSessionParamsSchema = z.object({
    sessionId: z.string(),
});

export const SetSessionConfigOptionParamsSchema = z.object({
    sessionId: z.string(),
    configId: z.string(),
    value: z.string(),
});

export const RestoreSessionParamsSchema = z.object({
    sessionId: z.string(),
    snapshotId: z.string(),
});

export const ListSessionsParamsSchema = z.object({
    cwd: z.string().optional(),
    cursor: z.string().optional(),
    pageSize: z.number().optional(),
});

export const DiogenesGetSessionParamsSchema = z.object({
    sessionId: z.string(),
    includeSnapshots: z.boolean().optional(),
});

export const DiogenesDisposeSessionParamsSchema = z.object({
    sessionId: z.string(),
});

export const DiogenesDeleteSessionParamsSchema = z.object({
    sessionId: z.string(),
});

export const DiogenesPruneSessionsParamsSchema = z.object({
    dryRun: z.boolean().optional(),
});

export const DiogenesRestoreSessionParamsSchema = z.object({
    sessionId: z.string(),
    snapshotId: z.string(),
});

// Schemas for session store types
export const SessionLifecycleStateSchema = z.enum(["active", "running", "disposing", "disposed"]);

export const SessionMetadataSchema = z.object({
    sessionId: z.string(),
    cwd: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    state: SessionLifecycleStateSchema,
    hasActiveRun: z.boolean(),
});

export const AvailableCommandInputSchema = z.object({
    hint: z.string(),
});

export const AvailableCommandSchema = z.object({
    name: z.string(),
    description: z.string(),
    input: AvailableCommandInputSchema.optional(),
    _meta: z
        .object({
            diogenes: z
                .object({
                    kind: z.string().optional(),
                    invocations: z.array(z.string()).optional(),
                    example: z.string().optional(),
                })
                .optional(),
        })
        .optional(),
});

export const StoredSessionMetadataSchema = SessionMetadataSchema.extend({
    availableCommands: z.array(AvailableCommandSchema),
    snapshotEnabled: z.boolean(),
});

// JSON-RPC schemas
export const JsonRpcRequestSchema = z.object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    method: z.string(),
    params: z.unknown().optional(),
});

export interface JsonRpcRequest {
    jsonrpc: "2.0";
    id?: string | number | null;
    method: string;
    params?: unknown;
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
    logger?: ACPLogger;
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

export type PromptBlock = PromptTextBlock | PromptResourceLinkBlock | PromptEmbeddedResourceBlock;

export interface PromptSessionParams {
    sessionId: string;
    prompt: PromptBlock[];
}

export interface CancelSessionParams {
    sessionId: string;
}

export interface SetSessionConfigOptionParams {
    sessionId: string;
    configId: string;
    value: string;
}

export interface SessionConfigSelectOption {
    value: string;
    name: string;
    description?: string | null;
}

export interface SessionConfigOption {
    id: string;
    name: string;
    description?: string | null;
    category?: "mode" | "model" | "thought_level" | "other";
    type: "select";
    currentValue: string;
    options: SessionConfigSelectOption[];
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
    _meta?: {
        diogenes?: {
            kind?: string;
            invocations?: string[];
            example?: string;
        };
    };
}

export type SessionLifecycleState = "active" | "running" | "disposing" | "disposed";

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
