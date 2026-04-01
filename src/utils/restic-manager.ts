import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml";
import { z } from "zod";

import type { DiogenesConfig, SecurityConfig } from "../types";
import type { DiogenesAppPaths } from "./app-paths";

import { ensureDiogenesAppDirs, resolveDiogenesAppPaths } from "./app-paths";
import { ResticCommandError } from "./restic";

const RESTIC_RELEASES_LATEST_URL = "https://api.github.com/repos/restic/restic/releases/latest";
const RESTIC_DOWNLOAD_TIMEOUT_MS = 120_000;
const RESTIC_VERIFY_TIMEOUT_MS = 15_000;

const GitHubReleaseAssetSchema = z.object({
    name: z.string(),
    browser_download_url: z.string(),
});

const GitHubLatestReleaseSchema = z.object({
    tag_name: z.string(),
    assets: z.array(GitHubReleaseAssetSchema),
});

interface GitHubReleaseAsset {
    name: string;
    browser_download_url: string;
}

interface GitHubLatestRelease {
    tag_name: string;
    assets: GitHubReleaseAsset[];
}

type FetchLike = typeof fetch;
type LooseObject = Record<string, unknown>;

export interface EnsureSnapshotResticOptions {
    configPath?: string;
    appPaths?: DiogenesAppPaths;
    fetchImpl?: FetchLike;
}

export interface EnsureSnapshotResticResult {
    enabled: boolean;
    binaryPath?: string;
    source?: "configured" | "path" | "downloaded";
    reason?: string;
}

export async function ensureSnapshotResticConfigured(
    config: DiogenesConfig,
    options: EnsureSnapshotResticOptions = {},
): Promise<EnsureSnapshotResticResult> {
    const snapshot = config.security?.snapshot;
    if (!snapshot?.enabled) {
        return { enabled: false, reason: "snapshots disabled" };
    }

    const configuredBinary = snapshot.resticBinary?.trim();
    const configuredArgs = snapshot.resticBinaryArgs || [];

    if (configuredBinary) {
        const configuredCheck = await verifyResticBinary(configuredBinary, configuredArgs);
        if (configuredCheck.ok) {
            return { enabled: true, binaryPath: configuredBinary, source: "configured" };
        }
    }

    const pathCheck = await verifyResticBinary("restic", configuredArgs);
    if (pathCheck.ok) {
        config.security = {
            ...(config.security || {}),
            snapshot: {
                ...(config.security?.snapshot || {}),
                resticBinary: "restic",
                unavailableReason: undefined,
            },
        };
        return { enabled: true, binaryPath: "restic", source: "path" };
    }

    try {
        const appPaths = options.appPaths ?? (await ensureDiogenesAppDirs());
        const fetchImpl = options.fetchImpl ?? fetch;
        const release = await fetchLatestRelease(fetchImpl);
        const asset = selectReleaseAsset(release, process.platform, process.arch);
        const binaryPath = await downloadManagedResticBinary(
            asset,
            release.tag_name,
            appPaths,
            fetchImpl,
        );

        config.security = {
            ...(config.security || {}),
            snapshot: {
                ...(config.security?.snapshot || {}),
                resticBinary: binaryPath,
                unavailableReason: undefined,
            },
        };

        if (options.configPath) {
            await persistResticBinaryToConfig(options.configPath, binaryPath);
        }

        return { enabled: true, binaryPath, source: "downloaded" };
    } catch (error) {
        const reason = formatResticResolutionError(error);
        config.security = {
            ...(config.security || {}),
            snapshot: {
                ...(config.security?.snapshot || {}),
                requestedEnabled: true,
                enabled: false,
                unavailableReason: reason,
            },
        };
        return { enabled: false, reason };
    }
}

export function selectReleaseAsset(
    release: GitHubLatestRelease,
    platform: NodeJS.Platform,
    arch: string,
): GitHubReleaseAsset {
    const platformName = mapResticPlatform(platform);
    const archName = mapResticArch(arch);
    const extension = platformName === "windows" ? ".zip" : ".bz2";
    const version = release.tag_name.replace(/^v/, "");
    const expectedName = `restic_${version}_${platformName}_${archName}${extension}`;
    const asset = release.assets.find((item) => item.name === expectedName);

    if (!asset) {
        throw new Error(
            `No restic release asset found for ${platformName}/${archName} in ${release.tag_name}`,
        );
    }

    return asset;
}

export async function persistResticBinaryToConfig(
    configPath: string,
    resticBinaryPath: string,
): Promise<void> {
    const resolvedConfigPath = path.resolve(configPath);
    const content = await fs.promises.readFile(resolvedConfigPath, "utf8");
    const ext = path.extname(resolvedConfigPath).toLowerCase();

    if (ext === ".json") {
        const parsed = parseConfigValue(JSON.parse(content) as unknown);
        const nextConfig = applyResticBinaryToConfig(parsed, resticBinaryPath);
        await fs.promises.writeFile(
            resolvedConfigPath,
            JSON.stringify(nextConfig, null, 2),
            "utf8",
        );
        return;
    }

    const document = yaml.parseDocument(content);
    const currentConfig = parseConfigValue(document.toJSON() as unknown);
    const nextConfig = applyResticBinaryToConfig(currentConfig, resticBinaryPath);
    await fs.promises.writeFile(resolvedConfigPath, yaml.stringify(nextConfig), "utf8");
}

function applyResticBinaryToConfig(config: LooseObject, resticBinaryPath: string): LooseObject {
    const security = getNestedObject(config, "security");
    const snapshot = getNestedObject(security, "snapshot");

    return {
        ...config,
        security: {
            ...security,
            snapshot: {
                ...snapshot,
                resticBinary: resticBinaryPath,
            },
        },
    };
}

async function fetchLatestRelease(fetchImpl: FetchLike): Promise<GitHubLatestRelease> {
    const response = await fetchImpl(RESTIC_RELEASES_LATEST_URL, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "diogenes-restic-manager",
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to fetch latest restic release: ${response.status}`);
    }

    return parseGitHubLatestRelease(await response.json());
}

async function downloadManagedResticBinary(
    asset: GitHubReleaseAsset,
    releaseTag: string,
    appPaths: DiogenesAppPaths,
    fetchImpl: FetchLike,
): Promise<string> {
    const installDir = path.join(appPaths.dataDir, "storage", "restic", releaseTag);
    const binaryName = process.platform === "win32" ? "restic.exe" : "restic";
    const finalBinaryPath = path.join(installDir, binaryName);

    const existingCheck = await verifyResticBinary(finalBinaryPath, []);
    if (existingCheck.ok) {
        return finalBinaryPath;
    }

    await fs.promises.mkdir(installDir, { recursive: true });
    const tempRoot = await fs.promises.mkdtemp(path.join(installDir, "download-"));
    const archivePath = path.join(tempRoot, asset.name);
    const extractDir = path.join(tempRoot, "extract");

    try {
        await fs.promises.mkdir(extractDir, { recursive: true });
        await downloadFile(asset.browser_download_url, archivePath, fetchImpl);
        await extractArchive(archivePath, extractDir, asset.name);

        const extractedBinary = await findResticBinary(extractDir, binaryName);
        await fs.promises.copyFile(extractedBinary, finalBinaryPath);
        if (process.platform !== "win32") {
            await fs.promises.chmod(finalBinaryPath, 0o755);
        }

        const verify = await verifyResticBinary(finalBinaryPath, []);
        if (!verify.ok) {
            throw new Error(verify.reason || "Downloaded restic binary failed verification");
        }

        return finalBinaryPath;
    } finally {
        await fs.promises.rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function downloadFile(url: string, targetPath: string, fetchImpl: FetchLike): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        controller.abort();
    }, RESTIC_DOWNLOAD_TIMEOUT_MS);

    try {
        const response = await fetchImpl(url, {
            headers: {
                Accept: "application/octet-stream",
                "User-Agent": "diogenes-restic-manager",
            },
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Failed to download restic asset: ${response.status}`);
        }

        const data = Buffer.from(await response.arrayBuffer());
        await fs.promises.writeFile(targetPath, data);
    } finally {
        clearTimeout(timer);
    }
}

async function extractArchive(
    archivePath: string,
    extractDir: string,
    assetName: string,
): Promise<void> {
    const extraction = getExtractionCommand(process.platform, archivePath, extractDir, assetName);
    await runCommand(extraction.command, extraction.args, RESTIC_DOWNLOAD_TIMEOUT_MS, "extract");
}

async function findResticBinary(rootDir: string, binaryName: string): Promise<string> {
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const entryPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            try {
                return await findResticBinary(entryPath, binaryName);
            } catch {
                continue;
            }
        }

        if (entry.isFile() && entry.name === binaryName) {
            return entryPath;
        }
    }

    throw new Error(`Unable to locate extracted ${binaryName}`);
}

async function verifyResticBinary(
    binary: string,
    binaryArgs: string[],
): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
        await runCommand(binary, [...binaryArgs, "version"], RESTIC_VERIFY_TIMEOUT_MS, "verify");
        return { ok: true };
    } catch (error) {
        return { ok: false, reason: formatResticResolutionError(error) };
    }
}

async function runCommand(
    command: string,
    args: string[],
    timeoutMs: number,
    phase: "verify" | "extract",
): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { shell: false });
        let settled = false;
        let stderr = "";

        const timer = setTimeout(() => {
            if (settled) {
                return;
            }

            settled = true;
            child.kill("SIGTERM");
            reject(new Error(`${phase}: ${path.basename(command)} command timed out`));
        }, timeoutMs);

        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            reject(error);
        });

        child.on("close", (code) => {
            if (settled) {
                return;
            }

            settled = true;
            clearTimeout(timer);
            if (code !== 0) {
                reject(
                    new Error(
                        `${phase}: ${stderr.trim() || `${path.basename(command)} exited with code ${code}`}`,
                    ),
                );
                return;
            }
            resolve();
        });
    });
}

function mapResticPlatform(platform: NodeJS.Platform): string {
    switch (platform) {
        case "aix":
            return "aix";
        case "freebsd":
            return "freebsd";
        case "darwin":
            return "darwin";
        case "netbsd":
            return "netbsd";
        case "openbsd":
            return "openbsd";
        case "linux":
            return "linux";
        case "sunos":
            return "solaris";
        case "win32":
            return "windows";
        case "android":
        case "cygwin":
        case "haiku":
        default:
            throw new Error(`Unsupported platform for managed restic download: ${platform}`);
    }
}

function mapResticArch(arch: string): string {
    switch (arch) {
        case "x64":
            return "amd64";
        case "arm64":
            return "arm64";
        case "arm":
            return "arm";
        case "ia32":
            return "386";
        case "mips":
            return "mips";
        case "mipsel":
            return "mipsle";
        case "ppc64":
            return "ppc64";
        case "ppc64le":
            return "ppc64le";
        case "riscv64":
            return "riscv64";
        case "s390x":
            return "s390x";
        default:
            throw new Error(`Unsupported architecture for managed restic download: ${arch}`);
    }
}

export function getManagedResticStorageDir(
    appPaths: DiogenesAppPaths = resolveDiogenesAppPaths(),
): string {
    return path.join(appPaths.dataDir, "storage", "restic");
}

export function getExtractionCommand(
    platform: NodeJS.Platform,
    archivePath: string,
    extractDir: string,
    assetName: string,
): { command: string; args: string[] } {
    if (assetName.endsWith(".zip")) {
        if (platform === "win32") {
            return {
                command: "powershell",
                args: [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    `Expand-Archive -LiteralPath '${escapePowerShellLiteral(archivePath)}' -DestinationPath '${escapePowerShellLiteral(extractDir)}' -Force`,
                ],
            };
        }

        return {
            command: "tar",
            args: ["-xf", archivePath, "-C", extractDir],
        };
    }

    return {
        command: "tar",
        args: ["-xjf", archivePath, "-C", extractDir],
    };
}

export function applyManagedResticDisable(
    config: DiogenesConfig,
    reason?: string,
): EnsureSnapshotResticResult {
    const snapshot: SecurityConfig["snapshot"] = {
        ...(config.security?.snapshot || {}),
        requestedEnabled: true,
        enabled: false,
        unavailableReason: reason,
    };
    config.security = {
        ...(config.security || {}),
        snapshot,
    };
    return { enabled: false, reason };
}

function parseConfigValue(value: unknown): LooseObject {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return {};
    }

    return { ...value };
}

function getNestedObject(value: LooseObject, key: string): LooseObject {
    const nested = value[key];
    if (typeof nested !== "object" || nested === null || Array.isArray(nested)) {
        return {};
    }

    return { ...nested };
}

function formatResticResolutionError(error: unknown): string {
    if (error instanceof ResticCommandError) {
        return `${error.phase}:${error.kind}: ${error.message}`;
    }

    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function parseGitHubLatestRelease(value: unknown): GitHubLatestRelease {
    const parsed = GitHubLatestReleaseSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error("Invalid restic release response");
    }

    return parsed.data;
}

function escapePowerShellLiteral(value: string): string {
    return value.replace(/'/g, "''");
}
