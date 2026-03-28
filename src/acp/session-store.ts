import { randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import { z } from "zod";

import type { PersistedDiogenesState, SessionSnapshotManifest } from "../snapshot/types";
import type { SnapshotSummary } from "../snapshot/types";
import type { StoredSessionMetadata } from "./types";

import { resolveDiogenesAppPaths } from "../utils/app-paths";
import { StoredSessionMetadataSchema } from "./types";

// Zod schemas for persisted state
const PersistedDiogenesMessageSchema = z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
});

const PersistedDiogenesLoadedFileSchema = z.object({
    path: z.string(),
    ranges: z.array(
        z.object({
            start: z.number(),
            end: z.number(),
        }),
    ),
});

const PersistedDiogenesTodoItemSchema = z.object({
    text: z.string(),
    state: z.enum(["done", "active", "pending"]),
});

const PersistedDiogenesStateSchema = z.object({
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
    messageHistory: z.array(PersistedDiogenesMessageSchema),
    workspace: z.object({
        loadedDirectories: z.array(z.string()),
        loadedFiles: z.array(PersistedDiogenesLoadedFileSchema),
        todo: z.array(PersistedDiogenesTodoItemSchema),
        notepad: z.array(z.string()),
    }),
});

const SessionSnapshotEntrySchema = z.object({
    snapshotId: z.string(),
    createdAt: z.string(),
    trigger: z.enum(["before_prompt", "llm_manual", "system_manual"]),
    turn: z.number(),
    label: z.string().optional(),
    reason: z.string().optional(),
    resticSnapshotId: z.string(),
    diogenesStatePath: z.string().nullable().optional(),
});

const SessionSnapshotManifestSchema = z.object({
    sessionId: z.string(),
    cwd: z.string(),
    createdAt: z.string(),
    snapshots: z.array(SessionSnapshotEntrySchema),
});

const METADATA_FILE_NAME = "metadata.json";
const STATE_FILE_NAME = "state.json";
const SNAPSHOTS_DIR_NAME = "snapshots";
const SNAPSHOT_MANIFEST_FILE_NAME = "manifest.json";
const LEGACY_SNAPSHOT_MANIFEST_FILE_NAME = "manifest.json";

export interface SessionPruneResult {
    deletedSessionIds: string[];
    keptSessionIds: string[];
    reasonsBySessionId: Record<string, string>;
}

export class SessionStore {
    constructor(private readonly sessionsRoot = resolveDiogenesAppPaths().sessionsDir) {}

    getSessionsRoot(): string {
        return this.sessionsRoot;
    }

    getSessionDir(sessionId: string): string {
        return path.join(this.sessionsRoot, sessionId);
    }

    getSnapshotsDir(sessionId: string): string {
        return path.join(this.getSessionDir(sessionId), SNAPSHOTS_DIR_NAME);
    }

    async ensureSessionDir(sessionId: string): Promise<string> {
        const sessionDir = this.getSessionDir(sessionId);
        await fs.mkdir(sessionDir, { recursive: true });
        return sessionDir;
    }

    async writeMetadata(metadata: StoredSessionMetadata): Promise<void> {
        const sessionDir = await this.ensureSessionDir(metadata.sessionId);
        const metadataPath = path.join(sessionDir, METADATA_FILE_NAME);
        const tempPath = `${metadataPath}.${randomUUID()}.tmp`;

        await fs.writeFile(tempPath, JSON.stringify(metadata, null, 2), "utf8");
        await fs.mkdir(path.dirname(metadataPath), { recursive: true });
        await fs.rename(tempPath, metadataPath);
    }

    async writeState(sessionId: string, state: PersistedDiogenesState): Promise<void> {
        const sessionDir = await this.ensureSessionDir(sessionId);
        const statePath = path.join(sessionDir, STATE_FILE_NAME);
        const tempPath = `${statePath}.${randomUUID()}.tmp`;

        await fs.writeFile(tempPath, JSON.stringify(state, null, 2), "utf8");
        await fs.rename(tempPath, statePath);
    }

    async readMetadata(sessionId: string): Promise<StoredSessionMetadata | null> {
        const metadataPath = path.join(this.getSessionDir(sessionId), METADATA_FILE_NAME);
        try {
            const content = await fs.readFile(metadataPath, "utf8");
            const parsed: unknown = JSON.parse(content);
            const result = StoredSessionMetadataSchema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
            return null;
        } catch (error) {
            if (isNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }

    async listMetadata(): Promise<StoredSessionMetadata[]> {
        await fs.mkdir(this.sessionsRoot, { recursive: true });
        const entries = await fs.readdir(this.sessionsRoot, { withFileTypes: true });
        const sessions = await Promise.all(
            entries
                .filter((entry) => entry.isDirectory())
                .map(async (entry) => this.readMetadata(entry.name)),
        );

        return sessions
            .filter((entry): entry is StoredSessionMetadata => entry !== null)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async readState(sessionId: string): Promise<PersistedDiogenesState | null> {
        const statePath = path.join(this.getSessionDir(sessionId), STATE_FILE_NAME);
        try {
            const content = await fs.readFile(statePath, "utf8");
            const parsed: unknown = JSON.parse(content);
            const result = PersistedDiogenesStateSchema.safeParse(parsed);
            if (result.success) {
                return result.data;
            }
            return null;
        } catch (error) {
            if (isNotFoundError(error)) {
                return null;
            }
            throw error;
        }
    }

    async readSnapshotManifest(sessionId: string): Promise<SessionSnapshotManifest | null> {
        for (const manifestPath of this.getSnapshotManifestCandidates(sessionId)) {
            try {
                const content = await fs.readFile(manifestPath, "utf8");
                const parsed: unknown = JSON.parse(content);
                const result = SessionSnapshotManifestSchema.safeParse(parsed);
                if (result.success) {
                    return result.data;
                }
                return null;
            } catch (error) {
                if (isNotFoundError(error)) {
                    continue;
                }
                throw error;
            }
        }

        return null;
    }

    async listSnapshots(sessionId: string): Promise<SnapshotSummary[]> {
        const manifest = await this.readSnapshotManifest(sessionId);
        return Array.isArray(manifest?.snapshots)
            ? manifest.snapshots.map((snapshot) => ({
                  snapshotId: snapshot.snapshotId,
                  createdAt: snapshot.createdAt,
                  trigger: snapshot.trigger,
                  turn: snapshot.turn,
                  label: snapshot.label,
              }))
            : [];
    }

    async removeSession(sessionId: string): Promise<void> {
        await fs.rm(this.getSessionDir(sessionId), { recursive: true, force: true });
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.access(filePath);
            return true;
        } catch {
            return false;
        }
    }

    async pruneSessions(options: { dryRun?: boolean } = {}): Promise<SessionPruneResult> {
        await fs.mkdir(this.sessionsRoot, { recursive: true });
        const entries = await fs.readdir(this.sessionsRoot, { withFileTypes: true });
        const deletedSessionIds: string[] = [];
        const keptSessionIds: string[] = [];
        const reasonsBySessionId: Record<string, string> = {};

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const sessionId = entry.name;
            const metadataPath = path.join(this.getSessionDir(sessionId), METADATA_FILE_NAME);
            const statePath = path.join(this.getSessionDir(sessionId), STATE_FILE_NAME);
            const hasMetadataFile = await this.fileExists(metadataPath);
            const hasStateFile = await this.fileExists(statePath);
            const metadata = await this.readMetadata(sessionId).catch(() => null);
            const snapshotManifest = await this.readSnapshotManifest(sessionId).catch(() => null);
            const reason = getPruneReason({
                sessionId,
                hasMetadataFile,
                hasStateFile,
                metadata,
                snapshotManifest,
            });

            if (reason) {
                deletedSessionIds.push(sessionId);
                reasonsBySessionId[sessionId] = reason;
                if (!options.dryRun) {
                    await this.removeSession(sessionId);
                }
                continue;
            }

            keptSessionIds.push(sessionId);
        }

        deletedSessionIds.sort();
        keptSessionIds.sort();
        return { deletedSessionIds, keptSessionIds, reasonsBySessionId };
    }

    private getSnapshotManifestCandidates(sessionId: string): string[] {
        return [
            path.join(this.getSnapshotsDir(sessionId), SNAPSHOT_MANIFEST_FILE_NAME),
            path.join(this.getSessionDir(sessionId), LEGACY_SNAPSHOT_MANIFEST_FILE_NAME),
        ];
    }
}

function getPruneReason(input: {
    sessionId: string;
    hasMetadataFile: boolean;
    hasStateFile: boolean;
    metadata: StoredSessionMetadata | null;
    snapshotManifest: SessionSnapshotManifest | null;
}): string | null {
    if (!input.hasMetadataFile && !input.hasStateFile && input.snapshotManifest) {
        return "orphaned_snapshot_artifacts";
    }
    if (!input.hasMetadataFile) {
        return "missing_metadata";
    }
    if (!input.hasStateFile) {
        return "missing_state";
    }
    if (input.metadata && input.metadata.sessionId !== input.sessionId) {
        return "metadata_session_id_mismatch";
    }
    if (input.metadata && input.metadata.sessionId !== input.sessionId) {
        return "state_session_id_mismatch";
    }
    if (input.snapshotManifest && input.snapshotManifest.sessionId !== input.sessionId) {
        return "snapshot_manifest_session_id_mismatch";
    }

    return null;
}

function isNotFoundError(error: unknown): boolean {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof (error as Record<string, unknown>).code === "string" &&
        (error as Record<string, unknown>).code === "ENOENT"
    );
}
