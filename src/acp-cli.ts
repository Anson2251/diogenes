#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { PassThrough, Writable } from "stream";
import * as yaml from "yaml";

import type { DiogenesConfig } from "./types";

import { startACPServer } from "./index";
import { getProviderApiKey } from "./utils/api-key-manager";
import { resolveDiogenesAppPaths } from "./utils/app-paths";
import {
    ensureDefaultConfigFileSync,
    ensureDefaultModelsConfigSync,
} from "./utils/config-bootstrap";
import { loadModelsConfig, resolveModelWithFallback } from "./utils/model-resolver";

interface ACPCLIOptions {
    model?: string;
    baseUrl?: string;
    workspace?: string;
    envFile?: string;
    maxIterations?: number;
    debugStdioFile?: string;
}

function getProviderEnvApiKey(providerName?: string): string | undefined {
    return getProviderApiKey(providerName || "openai");
}

function parseArgs(): ACPCLIOptions {
    const args = process.argv.slice(2);
    const options: ACPCLIOptions = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            showHelp();
            process.exit(0);
        } else if (arg === "--model" || arg === "-m") {
            options.model = args[++i];
        } else if (arg === "--base-url" || arg === "-b") {
            options.baseUrl = args[++i];
        } else if (arg === "--workspace" || arg === "-w") {
            options.workspace = args[++i];
        } else if (arg === "--env-file" || arg === "-e") {
            options.envFile = args[++i];
        } else if (arg === "--max-iterations" || arg === "-i") {
            options.maxIterations = parseInt(args[++i], 10);
        } else if (arg === "--debug-stdio-file") {
            options.debugStdioFile = args[++i];
        } else {
            console.error(`Unknown option: ${arg}`);
            showHelp();
            process.exit(1);
        }
    }

    return options;
}

function showHelp(): void {
    console.log(`Diogenes ACP Server

Usage:
  diogenes-acp [options]

Options:
  -h, --help                    Show this help message
  -m, --model <model>           LLM model
  -b, --base-url <url>          OpenAI-compatible API base URL
  -w, --workspace <path>        Workspace directory
  -e, --env-file <path>         Env file to load before reading environment variables
  -i, --max-iterations <n>      Maximum iterations per session/prompt run
      --debug-stdio-file <path> Mirror ACP stdin/stdout/stderr to a debug log file

Environment Variables:
  OPENAI_API_KEY
  ANTHROPIC_API_KEY
  OPENAI_BASE_URL
  DIOGENES_MODEL
  DIOGENES_WORKSPACE
`);
}

function loadConfig(configPath: string): Partial<DiogenesConfig> {
    const content = fs.readFileSync(configPath, "utf-8");
    const ext = path.extname(configPath).toLowerCase();

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const parsed: Partial<DiogenesConfig> =
        ext === ".yaml" || ext === ".yml" ? yaml.parse(content) : JSON.parse(content);
    return parsed;
}

function mergeConfig(
    base: Partial<DiogenesConfig>,
    override: Partial<DiogenesConfig>,
): Partial<DiogenesConfig> {
    const merged: Partial<DiogenesConfig> = {
        ...base,
        ...override,
    };

    if (base.llm || override.llm) {
        merged.llm = {
            ...(base.llm || {}),
            ...(override.llm || {}),
        };
    }

    if (base.security || override.security) {
        merged.security = {
            ...(base.security || {}),
            ...(override.security || {}),
        };
        const security = merged.security;
        if (base.security?.interaction || override.security?.interaction) {
            security.interaction = {
                ...(base.security?.interaction || {}),
                ...(override.security?.interaction || {}),
            };
        }
        if (base.security?.watch || override.security?.watch) {
            security.watch = {
                ...(base.security?.watch || {}),
                ...(override.security?.watch || {}),
            };
        }
        if (base.security?.shell || override.security?.shell) {
            security.shell = {
                ...(base.security?.shell || {}),
                ...(override.security?.shell || {}),
            };
        }
        if (base.security?.file || override.security?.file) {
            security.file = {
                ...(base.security?.file || {}),
                ...(override.security?.file || {}),
            };
        }
        if (base.security?.snapshot || override.security?.snapshot) {
            security.snapshot = {
                ...(base.security?.snapshot || {}),
                ...(override.security?.snapshot || {}),
            };
        }
    }

    return merged;
}

function createConfig(options: ACPCLIOptions): DiogenesConfig {
    const appPaths = resolveDiogenesAppPaths();
    const configPath = ensureDefaultConfigFileSync();
    const fileConfig = configPath ? loadConfig(configPath) : {};

    if (fileConfig.llm?.apiKey && fileConfig.llm) {
        delete fileConfig.llm.apiKey;
    }

    const modelsPath = ensureDefaultModelsConfigSync();
    const modelsConfig = loadModelsConfig(modelsPath);

    const envConfig: Partial<DiogenesConfig> = {};
    if (process.env.OPENAI_BASE_URL || process.env.DIOGENES_MODEL) {
        envConfig.llm = {};
        if (process.env.OPENAI_BASE_URL) envConfig.llm.baseURL = process.env.OPENAI_BASE_URL;
        if (process.env.DIOGENES_MODEL) envConfig.llm.model = process.env.DIOGENES_MODEL;
    }
    if (process.env.DIOGENES_WORKSPACE) {
        envConfig.security = {
            workspaceRoot: path.resolve(process.env.DIOGENES_WORKSPACE),
        };
    }

    const cliConfig: Partial<DiogenesConfig> = {};
    if (options.baseUrl || options.model) {
        cliConfig.llm = {};
        if (options.baseUrl) cliConfig.llm.baseURL = options.baseUrl;
        if (options.model) cliConfig.llm.model = options.model;
    }
    if (options.workspace) {
        cliConfig.security = {
            workspaceRoot: path.resolve(options.workspace),
        };
    }

    const merged = mergeConfig(mergeConfig(fileConfig, envConfig), cliConfig);

    if (modelsConfig) {
        const resolved = resolveModelWithFallback(modelsConfig, merged.llm?.model);
        if (resolved) {
            const currentLLM = merged.llm || {};
            merged.llm = {
                ...currentLLM,
                provider: resolved.provider,
                providerStyle: resolved.providerStyle,
                supportsToolRole: resolved.supportsToolRole,
                model: resolved.model,
                apiKey: resolved.apiKey,
                baseURL: resolved.baseURL || currentLLM.baseURL,
                maxTokens: resolved.maxTokens ?? currentLLM.maxTokens,
                temperature: resolved.temperature ?? currentLLM.temperature,
            };
        }
    }

    if (merged.llm && !merged.llm.apiKey) {
        const apiKey = getProviderEnvApiKey(merged.llm.provider);
        if (apiKey) {
            merged.llm.apiKey = apiKey;
        }
    }

    const snapshotConfig = merged.security?.snapshot;
    merged.security = {
        ...(merged.security || {}),
        interaction: {
            enabled: false,
        },
        snapshot: {
            ...(snapshotConfig || {}),
            storageRoot: appPaths.sessionsDir,
        },
    };

    return merged as DiogenesConfig;
}

function formatDebugChunk(
    streamName: "stdin" | "stdout" | "stderr",
    chunk: string | Buffer,
): string {
    const content = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
    return `[${new Date().toISOString()}] ${streamName}\n${content}${content.endsWith("\n") ? "" : "\n"}`;
}

function createDebugInput(input: NodeJS.ReadStream, debugLog: fs.WriteStream): PassThrough {
    const mirroredInput = new PassThrough();

    input.on("data", (chunk: string | Buffer) => {
        debugLog.write(formatDebugChunk("stdin", chunk));
        mirroredInput.write(chunk);
    });
    input.on("end", () => mirroredInput.end());
    input.on("error", (error) => mirroredInput.destroy(error));

    return mirroredInput;
}

function createDebugOutput(
    output: NodeJS.WriteStream,
    debugLog: fs.WriteStream,
    streamName: "stdout" | "stderr",
): Writable {
    const mirroredOutput = new Writable({
        write(chunk: Uint8Array | string, encoding: BufferEncoding, callback) {
            const bufferChunk = Buffer.isBuffer(chunk)
                ? chunk
                : typeof chunk === "string"
                  ? Buffer.from(chunk, encoding)
                  : Buffer.from(chunk);
            debugLog.write(formatDebugChunk(streamName, bufferChunk));

            output.write(chunk, encoding, (error) => {
                if (error) {
                    callback(error);
                    return;
                }
                callback();
            });
        },
    });

    return mirroredOutput;
}

export function createDebugStdio(
    filePath: string,
    input: NodeJS.ReadStream,
    output: NodeJS.WriteStream,
    error: NodeJS.WriteStream,
): {
    input: PassThrough;
    output: Writable;
    error: Writable;
    debugLog: fs.WriteStream;
} {
    const resolvedPath = path.resolve(filePath);
    const debugLog = fs.createWriteStream(resolvedPath, { flags: "a" });

    debugLog.write(`[${new Date().toISOString()}] debug session started\n`);

    return {
        input: createDebugInput(input, debugLog),
        output: createDebugOutput(output, debugLog, "stdout"),
        error: createDebugOutput(error, debugLog, "stderr"),
        debugLog,
    };
}

function main(): void {
    const options = parseArgs();

    // Load .env file - check both provided path and default locations
    if (options.envFile) {
        loadDotenv({ path: options.envFile });
    } else {
        // Try to load from current working directory first
        const cwdResult = loadDotenv({ quiet: true });
        // If not found in cwd, try to find .env in project root
        // __dirname is in dist/, so go up one level to reach project root
        if (!cwdResult.parsed) {
            const projectRoot = path.resolve(__dirname, "..");
            loadDotenv({ path: path.join(projectRoot, ".env"), quiet: true });
        }
    }

    const config = createConfig(options);

    let input: NodeJS.ReadStream | PassThrough = process.stdin;
    let output: NodeJS.WriteStream | Writable = process.stdout;
    let error: NodeJS.WriteStream | Writable = process.stderr;

    if (options.debugStdioFile) {
        const debugStdio = createDebugStdio(
            options.debugStdioFile,
            process.stdin,
            process.stdout,
            process.stderr,
        );
        input = debugStdio.input;
        output = debugStdio.output;
        error = debugStdio.error;

        process.on("exit", () => {
            debugStdio.debugLog.end();
        });
    }

    startACPServer({
        config,
        maxIterations: options.maxIterations,
        input,
        output,
        error,
    });
}

if (require.main === module) {
    main();
}

export { main, parseArgs };
