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

export interface SnapshotSummary {
    snapshotId: string;
    createdAt: string;
    trigger: SnapshotTrigger;
    turn: number;
    label?: string;
}

export interface PersistedDiogenesStatePlaceholder {
    version: 1;
    kind: "placeholder";
    sessionId: string;
    cwd: string;
    createdAt: string;
    updatedAt: string;
    note: string;
}
