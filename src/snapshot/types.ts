export type SnapshotTrigger = "before_prompt" | "llm_manual" | "system_manual";

export interface SessionSnapshotManifest {
    sessionId: string;
    cwd: string;
    createdAt: string;
    snapshots: SessionSnapshotEntry[];
}

export interface SessionSnapshotEntry {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    turn: number;
    label?: string;
    reason?: string;
    resticSnapshotId: string;
    diogenesStatePath?: string | null;
}

export interface SnapshotCreateInput {
    trigger: SnapshotTrigger;
    turn: number;
    label?: string;
    reason?: string;
}

export interface SnapshotCreateResult {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    turn: number;
    label?: string;
    resticSnapshotId: string;
    diogenesStatePath?: string | null;
}

export interface SnapshotRestoreInput {
    snapshotId: string;
}

export interface SnapshotSummary {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    turn: number;
    label?: string;
}

export interface PersistedDiogenesMessage {
    role: "user" | "assistant" | "tool";
    content: string;
}

export interface PersistedDiogenesLoadedFile {
    path: string;
    ranges: Array<{
        start: number;
        end: number;
    }>;
}

export interface PersistedDiogenesTodoItem {
    text: string;
    state: "done" | "active" | "pending";
}

export type PersistedACPUpdate = Record<string, unknown>;

export interface PersistedDiogenesState {
    version: 1;
    kind: "diogenes_state";
    sessionId: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    metadata?: {
        title: string | null;
        description: string | null;
    };
    acpReplayLog: PersistedACPUpdate[];
    messageHistory: PersistedDiogenesMessage[];
    workspace: {
        loadedDirectories: string[];
        loadedFiles: PersistedDiogenesLoadedFile[];
        todo: PersistedDiogenesTodoItem[];
        notepad: string[];
    };
}
