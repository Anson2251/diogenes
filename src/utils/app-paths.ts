import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface DiogenesAppPaths {
    homeDir: string;
    configDir: string;
    dataDir: string;
    snapshotDir: string;
    defaultConfigCandidates: string[];
}

type Platform = NodeJS.Platform;

interface ResolveOptions {
    platform?: Platform;
    env?: NodeJS.ProcessEnv;
    homeDir?: string;
}

export function resolveDiogenesAppPaths(options: ResolveOptions = {}): DiogenesAppPaths {
    const platform = options.platform ?? process.platform;
    const env = options.env ?? process.env;
    const homeDir = options.homeDir ?? resolveHomeDir(env);

    const configDir = resolveConfigDir(platform, env, homeDir);
    const dataDir = resolveDataDir(platform, env, homeDir);
    const snapshotDir = path.join(dataDir, "session-snapshot");

    return {
        homeDir,
        configDir,
        dataDir,
        snapshotDir,
        defaultConfigCandidates: [
            path.join(configDir, "config.yaml"),
            path.join(configDir, "config.yml"),
            path.join(configDir, "config.json"),
        ],
    };
}

export function ensureDiogenesAppDirsSync(options: ResolveOptions = {}): DiogenesAppPaths {
    const paths = resolveDiogenesAppPaths(options);
    fs.mkdirSync(paths.configDir, { recursive: true });
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.snapshotDir, { recursive: true });
    return paths;
}

export async function ensureDiogenesAppDirs(options: ResolveOptions = {}): Promise<DiogenesAppPaths> {
    const paths = resolveDiogenesAppPaths(options);
    await fs.promises.mkdir(paths.configDir, { recursive: true });
    await fs.promises.mkdir(paths.dataDir, { recursive: true });
    await fs.promises.mkdir(paths.snapshotDir, { recursive: true });
    return paths;
}

export function findDefaultConfigFileSync(options: ResolveOptions = {}): string | null {
    const paths = resolveDiogenesAppPaths(options);
    for (const candidate of paths.defaultConfigCandidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

export function getDefaultSnapshotStorageRoot(options: ResolveOptions = {}): string {
    return resolveDiogenesAppPaths(options).snapshotDir;
}

function resolveHomeDir(env: NodeJS.ProcessEnv): string {
    return env.HOME || env.USERPROFILE || os.homedir();
}

function resolveConfigDir(platform: Platform, env: NodeJS.ProcessEnv, homeDir: string): string {
    switch (platform) {
        case "darwin":
            return path.join(homeDir, "Library", "Application Support", "diogenes");
        case "win32":
            return path.join(env.APPDATA || path.join(homeDir, "AppData", "Roaming"), "diogenes");
        default:
            return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "diogenes");
    }
}

function resolveDataDir(platform: Platform, env: NodeJS.ProcessEnv, homeDir: string): string {
    switch (platform) {
        case "darwin":
            return path.join(homeDir, "Library", "Application Support", "diogenes");
        case "win32":
            return path.join(env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"), "diogenes");
        default:
            return path.join(env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"), "diogenes");
    }
}
