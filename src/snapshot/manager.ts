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
    private readonly gitIgnoreRulesCache = new Map<string, GitIgnoreRule[]>();
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
        const existingEntries = await this.manifestStore.list();
        const previousEntry = existingEntries.at(-1);
        const excludes = await this.collectGitIgnoredExcludePaths(relativeWorkspacePath);
        const backup = await this.restic.backup({
            cwd: path.dirname(this.options.cwd),
            paths: [relativeWorkspacePath],
            tags: this.buildTags(input),
            excludes,
            parent: previousEntry?.resticSnapshotId,
            skipIfUnchanged: true,
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

    private async collectGitIgnoredExcludePaths(workspaceRootName: string): Promise<string[]> {
        const excludes: string[] = [];
        await this.walkForGitIgnoredPaths(this.options.cwd, workspaceRootName, excludes);
        return excludes;
    }

    private async walkForGitIgnoredPaths(directory: string, workspaceRelativeDirectory: string, excludes: string[]): Promise<void> {
        const entries = await fs.readdir(directory, { withFileTypes: true });

        for (const entry of entries) {
            const absolutePath = path.join(directory, entry.name);
            const entryRelativePath = path.posix.join(workspaceRelativeDirectory, entry.name);

            if (await this.isGitIgnored(absolutePath)) {
                excludes.push(entryRelativePath);
                continue;
            }

            if (entry.isDirectory()) {
                await this.walkForGitIgnoredPaths(absolutePath, entryRelativePath, excludes);
            }
        }
    }

    private async isGitIgnored(absolutePath: string): Promise<boolean> {
        const relativePath = this.toWorkspaceRelativePath(absolutePath);
        const pathParts = path.dirname(relativePath) === "."
            ? []
            : path.dirname(relativePath).split(path.sep);
        const ignoreDirs = [this.options.cwd];

        let currentDir = this.options.cwd;
        for (const part of pathParts) {
            currentDir = path.join(currentDir, part);
            ignoreDirs.push(currentDir);
        }

        let ignored = false;
        for (const ignoreDir of ignoreDirs) {
            const rules = await this.readGitIgnoreRules(ignoreDir);
            if (rules.length === 0) {
                continue;
            }

            const relativeToIgnoreDir = this.normalizeForGitIgnore(path.relative(ignoreDir, absolutePath));
            for (const rule of rules) {
                if (this.matchesGitIgnoreRule(relativeToIgnoreDir, rule.pattern)) {
                    ignored = !rule.negated;
                }
            }
        }

        return ignored;
    }

    private async readGitIgnoreRules(directory: string): Promise<GitIgnoreRule[]> {
        const cached = this.gitIgnoreRulesCache.get(directory);
        if (cached) {
            return cached;
        }

        const ignorePath = path.join(directory, ".gitignore");

        try {
            const content = await fs.readFile(ignorePath, "utf8");
            const rules = content
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line.length > 0 && !line.startsWith("#"))
                .map((line) => ({
                    negated: line.startsWith("!"),
                    pattern: this.normalizeForGitIgnore(
                        line.startsWith("!") ? line.slice(1) : line,
                    ).replace(/\/+$/, (match) => (match ? "/" : match)),
                }));
            this.gitIgnoreRulesCache.set(directory, rules);
            return rules;
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                this.gitIgnoreRulesCache.set(directory, []);
                return [];
            }
            throw error;
        }
    }

    private matchesGitIgnoreRule(relativePath: string, pattern: string): boolean {
        if (!pattern) {
            return false;
        }

        const directoryOnly = pattern.endsWith("/");
        const normalizedPattern = directoryOnly ? pattern.slice(0, -1) : pattern;
        const anchored = normalizedPattern.startsWith("/");
        const body = anchored ? normalizedPattern.slice(1) : normalizedPattern;
        const hasSlash = body.includes("/");
        const regexBody = this.escapeGitIgnorePattern(body);

        if (!regexBody) {
            return false;
        }

        const prefix = anchored || hasSlash ? "^" : "(?:^|.*/)";
        const suffix = directoryOnly ? "(?:/.*)?$" : "(?:$|/.*$)";
        return new RegExp(`${prefix}${regexBody}${suffix}`).test(relativePath);
    }

    private escapeGitIgnorePattern(pattern: string): string {
        let escaped = "";

        for (let index = 0; index < pattern.length; index += 1) {
            const char = pattern[index];
            if (char === "*") {
                const nextChar = pattern[index + 1];
                if (nextChar === "*") {
                    escaped += ".*";
                    index += 1;
                } else {
                    escaped += "[^/]*";
                }
                continue;
            }

            if (char === "?") {
                escaped += "[^/]";
                continue;
            }

            escaped += char.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
        }

        return escaped;
    }

    private normalizeForGitIgnore(inputPath: string): string {
        return inputPath.split(path.sep).join("/");
    }

    private toWorkspaceRelativePath(absolutePath: string): string {
        return path.relative(this.options.cwd, absolutePath);
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

interface GitIgnoreRule {
    negated: boolean;
    pattern: string;
}

export function getDefaultSessionsStorageRoot(): string {
    return getDefaultSessionsStorageRootFromAppPaths();
}
