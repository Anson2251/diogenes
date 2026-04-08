import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface DiogenesAppPaths {
    homeDir: string;
    configDir: string;
    dataDir: string;
    sessionsDir: string;
    treeSitterDir: string;
    treeSitterGrammarsDir: string;
    defaultConfigCandidates: string[];
    modelsConfigPath: string;
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
    const sessionsDir = path.join(dataDir, "sessions");
    const treeSitterDir = path.join(dataDir, "tree-sitter");
    const treeSitterGrammarsDir = path.join(treeSitterDir, "grammars");

    return {
        homeDir,
        configDir,
        dataDir,
        sessionsDir,
        treeSitterDir,
        treeSitterGrammarsDir,
        defaultConfigCandidates: [
            path.join(configDir, "config.yaml"),
            path.join(configDir, "config.yml"),
            path.join(configDir, "config.json"),
        ],
        modelsConfigPath: path.join(configDir, "models.yaml"),
    };
}

export function ensureDiogenesAppDirsSync(options: ResolveOptions = {}): DiogenesAppPaths {
    const paths = resolveDiogenesAppPaths(options);
    // Ensure home directory exists first (needed when home is a temp dir in tests)
    fs.mkdirSync(paths.homeDir, { recursive: true });
    fs.mkdirSync(paths.configDir, { recursive: true });
    fs.mkdirSync(paths.dataDir, { recursive: true });
    fs.mkdirSync(paths.sessionsDir, { recursive: true });
    fs.mkdirSync(paths.treeSitterDir, { recursive: true });
    fs.mkdirSync(paths.treeSitterGrammarsDir, { recursive: true });
    return paths;
}

export async function ensureDiogenesAppDirs(
    options: ResolveOptions = {},
): Promise<DiogenesAppPaths> {
    const paths = resolveDiogenesAppPaths(options);
    try {
        // Ensure home directory exists first (needed when home is a temp dir in tests)
        await fs.promises.mkdir(paths.homeDir, { recursive: true });
        await fs.promises.mkdir(paths.configDir, { recursive: true });
        await fs.promises.mkdir(paths.dataDir, { recursive: true });
        await fs.promises.mkdir(paths.sessionsDir, { recursive: true });
        await fs.promises.mkdir(paths.treeSitterDir, { recursive: true });
        await fs.promises.mkdir(paths.treeSitterGrammarsDir, { recursive: true });
    } catch (error) {
        // Ignore ENOENT errors that can occur during test cleanup race conditions
        // when the home directory is deleted while async operations are in flight
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            // Silently ignore ENOENT errors from race conditions
        } else {
            throw error;
        }
    }
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

export function getDefaultSessionsStorageRoot(options: ResolveOptions = {}): string {
    return resolveDiogenesAppPaths(options).sessionsDir;
}

export function getDefaultTreeSitterStorageRoot(options: ResolveOptions = {}): string {
    return resolveDiogenesAppPaths(options).treeSitterDir;
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
        case "linux":
        case "freebsd":
        case "openbsd":
        case "netbsd":
        case "aix":
        case "android":
        case "cygwin":
        case "haiku":
        case "sunos":
            return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "diogenes");
        default:
            return path.join(env.XDG_CONFIG_HOME || path.join(homeDir, ".config"), "diogenes");
    }
}

function resolveDataDir(platform: Platform, env: NodeJS.ProcessEnv, homeDir: string): string {
    switch (platform) {
        case "darwin":
            return path.join(homeDir, "Library", "Application Support", "diogenes");
        case "win32":
            return path.join(
                env.LOCALAPPDATA || path.join(homeDir, "AppData", "Local"),
                "diogenes",
            );
        case "linux":
        case "freebsd":
        case "openbsd":
        case "netbsd":
        case "aix":
        case "android":
        case "cygwin":
        case "haiku":
        case "sunos":
            return path.join(
                env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"),
                "diogenes",
            );
        default:
            return path.join(
                env.XDG_DATA_HOME || path.join(homeDir, ".local", "share"),
                "diogenes",
            );
    }
}
