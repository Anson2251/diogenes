import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";

import type { WorkspaceManager } from "../context/workspace";
import type { ConversationMessage } from "../runtime/task-runner";
import type { PersistedACPUpdate, PersistedDiogenesState } from "./types";

// Zod schema for runtime validation
const PersistedDiogenesStateSchema: z.ZodType<PersistedDiogenesState> = z.object({
    version: z.literal(1),
    kind: z.literal("diogenes_state"),
    sessionId: z.string(),
    cwd: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
    metadata: z
        .object({
            title: z.string().nullable(),
            description: z.string().nullable(),
        })
        .optional(),
    acpReplayLog: z.array(z.record(z.string(), z.unknown())),
    messageHistory: z.array(
        z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string(),
        }),
    ),
    workspace: z.object({
        loadedDirectories: z.array(z.string()),
        loadedFiles: z.array(
            z.object({
                path: z.string(),
                ranges: z.array(
                    z.object({
                        start: z.number(),
                        end: z.number(),
                    }),
                ),
            }),
        ),
        todo: z.array(
            z.object({
                text: z.string(),
                state: z.enum(["done", "active", "pending"]),
            }),
        ),
        notepad: z.array(z.string()),
    }),
});

export interface SnapshotStateProvider {
    getWorkspaceManager(): WorkspaceManager;
    getMessageHistory(): ConversationMessage[];
    getACPReplayLog?(): PersistedACPUpdate[];
    getCreatedAt(): string;
    getUpdatedAt(): string;
    getSnapshotMetadata?(): {
        title: string | null;
        description: string | null;
    };
}

export interface SnapshotStateRestorer {
    restorePersistedState(state: PersistedDiogenesState): Promise<void> | void;
}

export interface SnapshotStateSerializer {
    serialize(params: {
        snapshotId: string;
        sessionId: string;
        cwd: string;
        stateProvider: SnapshotStateProvider;
    }): Promise<{ statePath: string }>;
    deserialize(statePath: string): Promise<PersistedDiogenesState>;
}

export class DiogenesStateSerializer implements SnapshotStateSerializer {
    constructor(private readonly stateDir: string) {}

    async serialize(params: {
        snapshotId: string;
        sessionId: string;
        cwd: string;
        stateProvider: SnapshotStateProvider;
    }): Promise<{ statePath: string }> {
        await fs.mkdir(this.stateDir, { recursive: true });

        const statePath = path.join(this.stateDir, `${params.snapshotId}.json`);
        const workspace = params.stateProvider.getWorkspaceManager();
        const directoryWorkspace = workspace.getDirectoryWorkspace();
        const fileWorkspace = workspace.getFileWorkspace();
        const todoWorkspace = workspace.getTodoWorkspace();
        const notepadWorkspace = workspace.getNotepadWorkspace();
        const payload: PersistedDiogenesState = {
            version: 1,
            kind: "diogenes_state",
            sessionId: params.sessionId,
            cwd: params.cwd,
            createdAt: params.stateProvider.getCreatedAt(),
            updatedAt: params.stateProvider.getUpdatedAt(),
            metadata: params.stateProvider.getSnapshotMetadata?.(),
            acpReplayLog: params.stateProvider.getACPReplayLog?.() ?? [],
            messageHistory: params.stateProvider.getMessageHistory().map((message) => ({
                role: message.role,
                content: message.content,
            })),
            workspace: {
                loadedDirectories: Object.keys(directoryWorkspace),
                loadedFiles: Object.values(fileWorkspace).map((entry) => ({
                    path: entry.path,
                    ranges: entry.ranges.map((range) => ({
                        start: range.start,
                        end: range.end,
                    })),
                })),
                todo: todoWorkspace.items.map((item) => ({
                    text: item.text,
                    state: item.state,
                })),
                notepad: [...notepadWorkspace.lines],
            },
        };

        await fs.writeFile(statePath, JSON.stringify(payload, null, 2), "utf8");
        return { statePath };
    }

    async deserialize(statePath: string): Promise<PersistedDiogenesState> {
        const content = await fs.readFile(statePath, "utf8");
        const parsed: unknown = JSON.parse(content);
        const result = PersistedDiogenesStateSchema.safeParse(parsed);
        if (!result.success) {
            throw new Error(`Invalid state format: ${result.error.message}`);
        }
        return result.data;
    }
}
