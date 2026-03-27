import { randomBytes, randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type { SecurityConfig } from "../types";
import { ResticClient } from "../utils/restic";
import { getDefaultSessionsStorageRoot as getDefaultSessionsStorageRootFromAppPaths } from "../utils/app-paths";
import { SnapshotManifestStore } from "./manifest-store";
import { DiogenesStateSerializer, type SnapshotStateProvider, type SnapshotStateRestorer, type SnapshotStateSerializer } from "./state-serializer";
import type { SnapshotCreateInput, SnapshotCreateResult, SnapshotRestoreInput, SnapshotSummary } from "./types";

export interface SnapshotManager {
    initialize(): Promise<void>;
    isAutoBeforePromptEnabled(): boolean;
    createSnapshot(input: SnapshotCreateInput): Promise<SnapshotCreateResult>;
    listSnapshots(): Promise<SnapshotSummary[]>;
    restoreSnapshot(input: SnapshotRestoreInput): Promise<void>;
    cleanup(): Promise<void>;
}

export interface SnapshotManagerOptions {
    sessionId: string;
    cwd: string;
    config: SecurityConfig["snapshot"];
    stateProvider: SnapshotStateProvider;
    stateRestorer?: SnapshotStateRestorer;
    stateSerializer?: SnapshotStateSerializer;
}

export class SessionSnapshotManager implements SnapshotManager {
    private readonly sessionDir: string;
    private readonly repoDir: string;
    private readonly stateDir: string;
    private readonly manifestPath: string;
    private readonly passwordFilePath: string;
    private readonly restic: ResticClient;
    private readonly manifestStore: SnapshotManifestStore;
    private readonly stateSerializer: SnapshotStateSerializer;
    private initialized = false;
    private cleanedUp = false;

    constructor(private readonly options: SnapshotManagerOptions) {
        this.sessionDir = path.join(options.config.storageRoot, options.sessionId, "snapshots");
        this.repoDir = path.join(this.sessionDir, "repo");
        this.stateDir = path.join(this.sessionDir, "state");
        this.manifestPath = path.join(this.sessionDir, "manifest.json");
        this.passwordFilePath = path.join(this.sessionDir, ".restic-password");
        this.restic = new ResticClient({
            binary: options.config.resticBinary,
            binaryArgs: options.config.resticBinaryArgs,
            repository: this.repoDir,
            passwordFile: this.passwordFilePath,
            timeoutMs: options.config.timeoutMs,
        });
        this.manifestStore = new SnapshotManifestStore(this.manifestPath);
        this.stateSerializer = options.stateSerializer ?? new DiogenesStateSerializer(this.stateDir);
    }

    isAutoBeforePromptEnabled(): boolean {
        return this.options.config.autoBeforePrompt;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        if (this.cleanedUp) {
            throw new Error("Snapshot manager has already been cleaned up");
        }

        const manifestExists = await fs.stat(this.manifestPath).then(() => true).catch(() => false);
        const passwordExists = await fs.stat(this.passwordFilePath).then(() => true).catch(() => false);

        await fs.mkdir(this.repoDir, { recursive: true });
        await fs.mkdir(this.stateDir, { recursive: true });

        if (!passwordExists) {
            await fs.writeFile(this.passwordFilePath, `${randomBytes(32).toString("hex")}\n`, {
                encoding: "utf8",
                mode: 0o600,
            });
        }

        if (!manifestExists) {
            await this.manifestStore.initialize({
                sessionId: this.options.sessionId,
                cwd: this.options.cwd,
                createdAt: new Date().toISOString(),
            });
            await this.restic.initRepo();
        }

        this.initialized = true;
    }

    async createSnapshot(input: SnapshotCreateInput): Promise<SnapshotCreateResult> {
        await this.initialize();

        const createdAt = new Date().toISOString();
        const snapshotId = `snapshot-${input.turn}-${randomUUID()}`;
        const relativeWorkspacePath = this.getRelativeWorkspacePath();
        const backup = await this.restic.backup({
            cwd: path.dirname(this.options.cwd),
            paths: [relativeWorkspacePath],
            tags: this.buildTags(input),
            skipIfUnchanged: false,
        });

        let diogenesStatePath: string | null | undefined;
        if (this.options.config.includeDiogenesState) {
            const serialized = await this.stateSerializer.serialize({
                snapshotId,
                sessionId: this.options.sessionId,
                cwd: this.options.cwd,
                stateProvider: this.options.stateProvider,
            });
            diogenesStatePath = serialized.statePath;
        }

        await this.manifestStore.append({
            snapshotId,
            createdAt,
            trigger: input.trigger,
            turn: input.turn,
            label: input.label,
            reason: input.reason,
            resticSnapshotId: backup.snapshotId,
            diogenesStatePath: diogenesStatePath ?? null,
        });

        return {
            snapshotId,
            createdAt,
            trigger: input.trigger,
            turn: input.turn,
            label: input.label,
            resticSnapshotId: backup.snapshotId,
            diogenesStatePath: diogenesStatePath ?? null,
        };
    }

    async listSnapshots(): Promise<SnapshotSummary[]> {
        await this.initialize();
        const entries = await this.manifestStore.list();
        return entries.map((entry) => ({
            snapshotId: entry.snapshotId,
            createdAt: entry.createdAt,
            trigger: entry.trigger,
            turn: entry.turn,
            label: entry.label,
        }));
    }

    async restoreSnapshot(input: SnapshotRestoreInput): Promise<void> {
        await this.initialize();

        const entries = await this.manifestStore.list();
        const entry = entries.find((candidate) => candidate.snapshotId === input.snapshotId);
        if (!entry) {
            throw new Error(`Unknown snapshot: ${input.snapshotId}`);
        }

        const stagingDir = path.join(this.sessionDir, "restore-staging", randomUUID());
        await fs.mkdir(stagingDir, { recursive: true });

        let state = null;
        if (entry.diogenesStatePath && this.options.stateRestorer) {
            state = await this.stateSerializer.deserialize(entry.diogenesStatePath);
        }

        try {
            await this.restic.restore({
                snapshotId: entry.resticSnapshotId,
                target: stagingDir,
            });

            const restoredRoot = path.join(stagingDir, this.getRelativeWorkspacePath());
            await this.replaceWorkspaceFromStaging(restoredRoot, async () => {
                if (state && this.options.stateRestorer) {
                    await this.options.stateRestorer.restorePersistedState(state);
                }
            });
        } finally {
            await fs.rm(stagingDir, { recursive: true, force: true });
        }
    }

    async cleanup(): Promise<void> {
        if (this.cleanedUp) {
            return;
        }

        this.cleanedUp = true;
        await fs.rm(this.sessionDir, { recursive: true, force: true });
    }

    private buildTags(input: SnapshotCreateInput): string[] {
        return [
            `session:${this.options.sessionId}`,
            `trigger:${input.trigger}`,
            `turn:${input.turn}`,
            ...(input.label ? [`label:${input.label}`] : []),
        ];
    }

    private getRelativeWorkspacePath(): string {
        const relativePath = path.basename(this.options.cwd);
        if (!relativePath) {
            throw new Error(`Unsupported workspace root for snapshotting: ${this.options.cwd}`);
        }
        return relativePath;
    }

    private async replaceWorkspaceFromStaging(restoredRoot: string, afterWorkspaceRestore?: () => Promise<void>): Promise<void> {
        const restoredStat = await fs.stat(restoredRoot).catch(() => null);
        if (!restoredStat?.isDirectory()) {
            throw new Error(`Restored workspace root is missing: ${restoredRoot}`);
        }

        const rollbackDir = path.join(this.sessionDir, "restore-staging", `rollback-${randomUUID()}`);
        await fs.mkdir(rollbackDir, { recursive: true });

        const currentEntries = await fs.readdir(this.options.cwd);
        try {
            await Promise.all(currentEntries.map((entry) => fs.cp(
                path.join(this.options.cwd, entry),
                path.join(rollbackDir, entry),
                { recursive: true, force: true },
            )));

            await Promise.all(currentEntries.map((entry) => fs.rm(path.join(this.options.cwd, entry), { recursive: true, force: true })));

            const restoredEntries = await fs.readdir(restoredRoot);
            await Promise.all(restoredEntries.map((entry) => fs.cp(
                path.join(restoredRoot, entry),
                path.join(this.options.cwd, entry),
                { recursive: true, force: true },
            )));

            await afterWorkspaceRestore?.();
        } catch (error) {
            const currentWorkspaceEntries = await fs.readdir(this.options.cwd).catch(() => []);
            await Promise.all(currentWorkspaceEntries.map((entry) => fs.rm(path.join(this.options.cwd, entry), { recursive: true, force: true })));

            const rollbackEntries = await fs.readdir(rollbackDir).catch(() => []);
            await Promise.all(rollbackEntries.map((entry) => fs.cp(
                path.join(rollbackDir, entry),
                path.join(this.options.cwd, entry),
                { recursive: true, force: true },
            )));
            throw error;
        } finally {
            await fs.rm(rollbackDir, { recursive: true, force: true });
        }
    }
}

export function getDefaultSessionsStorageRoot(): string {
    return getDefaultSessionsStorageRootFromAppPaths();
}
