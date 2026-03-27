import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { PersistedDiogenesState, SessionSnapshotManifest } from "../snapshot/types";
import type { SnapshotSummary } from "../snapshot/types";
import { resolveDiogenesAppPaths } from "../utils/app-paths";
import type { StoredSessionMetadata } from "./types";

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
            return JSON.parse(content) as StoredSessionMetadata;
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
                .map((entry) => this.readMetadata(entry.name)),
        );

        return sessions
            .filter((entry): entry is StoredSessionMetadata => entry !== null)
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    }

    async readState(sessionId: string): Promise<PersistedDiogenesState | null> {
        const statePath = path.join(this.getSessionDir(sessionId), STATE_FILE_NAME);
        try {
            const content = await fs.readFile(statePath, "utf8");
            return JSON.parse(content) as PersistedDiogenesState;
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
                return JSON.parse(content) as SessionSnapshotManifest;
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
            const metadata = await this.readMetadata(sessionId).catch(() => null);
            const state = await this.readState(sessionId).catch(() => null);
            const snapshotManifest = await this.readSnapshotManifest(sessionId).catch(() => null);
            const reason = getPruneReason({ sessionId, metadata, state, snapshotManifest });

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
    metadata: StoredSessionMetadata | null;
    state: PersistedDiogenesState | null;
    snapshotManifest: SessionSnapshotManifest | null;
}): string | null {
    if (!input.metadata && !input.state && input.snapshotManifest) {
        return "orphaned_snapshot_artifacts";
    }
    if (!input.metadata) {
        return "missing_metadata";
    }
    if (!input.state) {
        return "missing_state";
    }
    if (input.metadata.sessionId !== input.sessionId) {
        return "metadata_session_id_mismatch";
    }
    if (input.state.sessionId !== input.sessionId) {
        return "state_session_id_mismatch";
    }
    if (input.snapshotManifest && input.snapshotManifest.sessionId !== input.sessionId) {
        return "snapshot_manifest_session_id_mismatch";
    }

    return null;
}

function isNotFoundError(error: unknown): boolean {
    return typeof error === "object"
        && error !== null
        && "code" in error
        && (error as NodeJS.ErrnoException).code === "ENOENT";
}
