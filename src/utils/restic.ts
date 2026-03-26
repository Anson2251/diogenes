import { spawn } from "child_process";

export interface ResticClientOptions {
    binary?: string;
    binaryArgs?: string[];
    repository?: string;
    password?: string;
    passwordFile?: string;
    passwordCommand?: string;
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}

export interface ResticCommandOptions {
    repository?: string;
    password?: string;
    passwordFile?: string;
    passwordCommand?: string;
    cwd?: string;
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
}

export interface ResticBackupOptions extends ResticCommandOptions {
    paths: string[];
    tags?: string[];
    excludes?: string[];
    excludeFiles?: string[];
    host?: string;
    parent?: string;
    groupBy?: string;
    readConcurrency?: number;
    skipIfUnchanged?: boolean;
    oneFileSystem?: boolean;
    time?: string;
}

export interface ResticSnapshot {
    id: string;
    short_id?: string;
    time: string;
    tree?: string;
    paths?: string[];
    hostname?: string;
    username?: string;
    uid?: number;
    gid?: number;
    tags?: string[];
}

export interface ResticListSnapshotsOptions extends ResticCommandOptions {
    tags?: string[];
    paths?: string[];
    host?: string;
}

export interface ResticRestoreOptions extends ResticCommandOptions {
    snapshotId: string;
    target: string;
    includes?: string[];
    excludes?: string[];
    delete?: boolean;
    dryRun?: boolean;
}

export interface ResticBackupResult {
    snapshotId: string;
    rawOutput: string;
}

export interface ResticCommandResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export class ResticCommandError extends Error {
    readonly args: string[];
    readonly exitCode: number;
    readonly stdout: string;
    readonly stderr: string;

    constructor(message: string, params: {
        args: string[];
        exitCode: number;
        stdout: string;
        stderr: string;
    }) {
        super(message);
        this.name = "ResticCommandError";
        this.args = params.args;
        this.exitCode = params.exitCode;
        this.stdout = params.stdout;
        this.stderr = params.stderr;
    }
}

export class ResticParseError extends Error {
    readonly stdout: string;

    constructor(message: string, stdout: string) {
        super(message);
        this.name = "ResticParseError";
        this.stdout = stdout;
    }
}

export class ResticClient {
    private readonly binary: string;
    private readonly binaryArgs: string[];
    private readonly repository?: string;
    private readonly password?: string;
    private readonly passwordFile?: string;
    private readonly passwordCommand?: string;
    private readonly cwd?: string;
    private readonly timeoutMs: number;
    private readonly env?: NodeJS.ProcessEnv;

    constructor(options: ResticClientOptions = {}) {
        this.binary = options.binary || "restic";
        this.binaryArgs = options.binaryArgs || [];
        this.repository = options.repository;
        this.password = options.password;
        this.passwordFile = options.passwordFile;
        this.passwordCommand = options.passwordCommand;
        this.cwd = options.cwd;
        this.timeoutMs = options.timeoutMs || 120_000;
        this.env = options.env;
        this.validatePasswordSources(options);
    }

    async initRepo(options: ResticCommandOptions = {}): Promise<void> {
        await this.run(["init"], options);
    }

    async backup(options: ResticBackupOptions): Promise<ResticBackupResult> {
        if (!options.paths.length) {
            throw new Error("backup requires at least one path");
        }

        const args = ["backup", "--json"];

        for (const tag of options.tags || []) {
            args.push("--tag", tag);
        }

        for (const exclude of options.excludes || []) {
            args.push("--exclude", exclude);
        }

        for (const excludeFile of options.excludeFiles || []) {
            args.push("--exclude-file", excludeFile);
        }

        if (options.host) {
            args.push("--host", options.host);
        }

        if (options.parent) {
            args.push("--parent", options.parent);
        }

        if (options.groupBy !== undefined) {
            args.push("--group-by", options.groupBy);
        }

        if (options.readConcurrency !== undefined) {
            args.push("--read-concurrency", String(options.readConcurrency));
        }

        if (options.skipIfUnchanged) {
            args.push("--skip-if-unchanged");
        }

        if (options.oneFileSystem) {
            args.push("--one-file-system");
        }

        if (options.time) {
            args.push("--time", options.time);
        }

        args.push(...options.paths);

        const result = await this.run(args, options);
        const snapshotId = this.parseBackupSnapshotId(result.stdout);

        return {
            snapshotId,
            rawOutput: result.stdout,
        };
    }

    async snapshots(options: ResticListSnapshotsOptions = {}): Promise<ResticSnapshot[]> {
        const args = ["snapshots", "--json"];

        for (const tag of options.tags || []) {
            args.push("--tag", tag);
        }

        for (const currentPath of options.paths || []) {
            args.push("--path", currentPath);
        }

        if (options.host) {
            args.push("--host", options.host);
        }

        const result = await this.run(args, options);
        return this.parseSnapshots(result.stdout);
    }

    async restore(options: ResticRestoreOptions): Promise<void> {
        const args = ["restore", options.snapshotId, "--target", options.target];

        for (const include of options.includes || []) {
            args.push("--include", include);
        }

        for (const exclude of options.excludes || []) {
            args.push("--exclude", exclude);
        }

        if (options.delete) {
            args.push("--delete");
        }

        if (options.dryRun) {
            args.push("--dry-run");
        }

        await this.run(args, options);
    }

    private async run(args: string[], options: ResticCommandOptions = {}): Promise<ResticCommandResult> {
        this.validatePasswordSources(options);

        const mergedEnv = this.buildEnv(options);
        const cwd = options.cwd ?? this.cwd;
        const timeoutMs = options.timeoutMs ?? this.timeoutMs;

        return new Promise((resolve, reject) => {
            const child = spawn(this.binary, [...this.binaryArgs, ...args], {
                cwd,
                env: mergedEnv,
                shell: false,
            });

            let stdout = "";
            let stderr = "";
            let settled = false;

            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                child.kill("SIGTERM");
                setTimeout(() => {
                    child.kill("SIGKILL");
                }, 250).unref();
                reject(new ResticCommandError("restic command timed out", {
                    args,
                    exitCode: -1,
                    stdout,
                    stderr,
                }));
            }, timeoutMs);

            child.stdout.on("data", (chunk) => {
                stdout += chunk.toString();
            });

            child.stderr.on("data", (chunk) => {
                stderr += chunk.toString();
            });

            child.on("error", (error) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);
                reject(new ResticCommandError(error.message, {
                    args,
                    exitCode: -1,
                    stdout,
                    stderr,
                }));
            });

            child.on("close", (exitCode) => {
                if (settled) {
                    return;
                }

                settled = true;
                clearTimeout(timer);

                if (exitCode !== 0) {
                    reject(new ResticCommandError("restic command failed", {
                        args,
                        exitCode: exitCode ?? -1,
                        stdout,
                        stderr,
                    }));
                    return;
                }

                resolve({
                    stdout,
                    stderr,
                    exitCode: exitCode ?? 0,
                });
            });
        });
    }

    private buildEnv(options: ResticCommandOptions): NodeJS.ProcessEnv {
        const env: NodeJS.ProcessEnv = {
            ...process.env,
            ...this.env,
            ...options.env,
        };

        const repository = options.repository || this.repository;
        const password = options.password || this.password;
        const passwordFile = options.passwordFile || this.passwordFile;
        const passwordCommand = options.passwordCommand || this.passwordCommand;

        if (repository) {
            env.RESTIC_REPOSITORY = repository;
        }

        if (password !== undefined) {
            env.RESTIC_PASSWORD = password;
            delete env.RESTIC_PASSWORD_FILE;
            delete env.RESTIC_PASSWORD_COMMAND;
        } else if (passwordFile) {
            env.RESTIC_PASSWORD_FILE = passwordFile;
            delete env.RESTIC_PASSWORD;
            delete env.RESTIC_PASSWORD_COMMAND;
        } else if (passwordCommand) {
            env.RESTIC_PASSWORD_COMMAND = passwordCommand;
            delete env.RESTIC_PASSWORD;
            delete env.RESTIC_PASSWORD_FILE;
        }

        return env;
    }

    private parseBackupSnapshotId(stdout: string): string {
        const lines = stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const line of lines) {
            try {
                const value = JSON.parse(line) as Record<string, unknown>;
                if (value.message_type === "summary" && typeof value.snapshot_id === "string") {
                    return value.snapshot_id;
                }
            } catch {
                continue;
            }
        }

        const fallback = stdout.match(/snapshot\s+([a-f0-9]+)\s+saved/i);
        if (fallback?.[1]) {
            return fallback[1];
        }

        throw new ResticParseError(
            "Unable to parse snapshot id from restic backup output",
            stdout,
        );
    }

    private parseSnapshots(stdout: string): ResticSnapshot[] {
        const trimmed = stdout.trim();
        if (!trimmed) {
            return [];
        }

        try {
            return JSON.parse(trimmed) as ResticSnapshot[];
        } catch {
            throw new ResticParseError("Unable to parse restic snapshots output", stdout);
        }
    }

    private validatePasswordSources(options: ResticCommandOptions): void {
        const passwordSources = [
            options.password ?? this.password,
            options.passwordFile ?? this.passwordFile,
            options.passwordCommand ?? this.passwordCommand,
        ].filter((value) => value !== undefined);

        if (passwordSources.length > 1) {
            throw new Error("Only one restic password source can be configured at a time");
        }
    }
}
