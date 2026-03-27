import * as fs from "fs/promises";
import * as path from "path";
import type { ConversationMessage } from "../runtime/task-runner";
import type { WorkspaceManager } from "../context/workspace";
import type { PersistedACPUpdate, PersistedDiogenesState } from "./types";

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
        return JSON.parse(content) as PersistedDiogenesState;
    }
}
