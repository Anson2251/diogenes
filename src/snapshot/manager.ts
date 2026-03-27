import { randomBytes, randomUUID } from "crypto";
import * as fs from "fs/promises";
import * as path from "path";
import type { SecurityConfig } from "../types";
import { ResticClient } from "../utils/restic";
import { getDefaultSessionsStorageRoot as getDefaultSessionsStorageRootFromAppPaths } from "../utils/app-paths";
import { SnapshotManifestStore } from "./manifest-store";
import { DiogenesStateSerializer, type SnapshotStateProvider, type SnapshotStateSerializer } from "./state-serializer";
import type { SnapshotCreateInput, SnapshotCreateResult, SnapshotSummary } from "./types";

export interface SnapshotManager {
    initialize(): Promise<void>;
    isAutoBeforePromptEnabled(): boolean;
    createSnapshot(input: SnapshotCreateInput): Promise<SnapshotCreateResult>;
    listSnapshots(): Promise<SnapshotSummary[]>;
    cleanup(): Promise<void>;
}

export interface SnapshotManagerOptions {
    sessionId: string;
    cwd: string;
    config: SecurityConfig["snapshot"];
    stateProvider: SnapshotStateProvider;
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
        this.sessionDir = path.join(options.config.storageRoot, options.sessionId);
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

        await fs.mkdir(this.repoDir, { recursive: true });
        await fs.mkdir(this.stateDir, { recursive: true });
        await fs.writeFile(this.passwordFilePath, `${randomBytes(32).toString("hex")}\n`, {
            encoding: "utf8",
            mode: 0o600,
        });
        await this.manifestStore.initialize({
            sessionId: this.options.sessionId,
            cwd: this.options.cwd,
            createdAt: new Date().toISOString(),
        });
        await this.restic.initRepo();
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
}

export function getDefaultSessionsStorageRoot(): string {
    return getDefaultSessionsStorageRootFromAppPaths();
}
