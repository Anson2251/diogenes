#!/usr/bin/env node

import { config as loadDotenv } from "dotenv";

import * as fs from "fs";
import * as path from "path";
import { PassThrough, Writable } from "stream";
import * as yaml from "yaml";
import { startACPServer } from "./index";
import type { DiogenesConfig } from "./types";

interface ACPCLIOptions {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    workspace?: string;
    configFile?: string;
    envFile?: string;
    maxIterations?: number;
    debugStdioFile?: string;
}

function parseArgs(): ACPCLIOptions {
    const args = process.argv.slice(2);
    const options: ACPCLIOptions = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            showHelp();
            process.exit(0);
        } else if (arg === "--api-key" || arg === "-k") {
            options.apiKey = args[++i];
        } else if (arg === "--model" || arg === "-m") {
            options.model = args[++i];
        } else if (arg === "--base-url" || arg === "-b") {
            options.baseUrl = args[++i];
        } else if (arg === "--workspace" || arg === "-w") {
            options.workspace = args[++i];
        } else if (arg === "--config-file" || arg === "--config" || arg === "-c") {
            options.configFile = args[++i];
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
  -k, --api-key <key>           OpenAI API key
  -m, --model <model>           LLM model
  -b, --base-url <url>          OpenAI-compatible API base URL
  -w, --workspace <path>        Workspace directory
  -c, --config-file <path>      JSON or YAML config file
  -e, --env-file <path>         Env file to load before reading environment variables
  -i, --max-iterations <n>      Maximum iterations per session/prompt run
      --debug-stdio-file <path> Mirror ACP stdin/stdout/stderr to a debug log file

Environment Variables:
  OPENAI_API_KEY
  OPENAI_BASE_URL
  DIOGENES_MODEL
  DIOGENES_WORKSPACE
`);
}

function loadConfig(configPath: string): Partial<DiogenesConfig> {
    const content = fs.readFileSync(configPath, "utf-8");
    const ext = path.extname(configPath).toLowerCase();

    if (ext === ".yaml" || ext === ".yml") {
        return yaml.parse(content) as Partial<DiogenesConfig>;
    }

    return JSON.parse(content) as Partial<DiogenesConfig>;
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
        if (base.security?.interaction || override.security?.interaction) {
            (merged.security as any).interaction = {
                ...(base.security?.interaction || {}),
                ...(override.security?.interaction || {}),
            };
        }
        if (base.security?.watch || override.security?.watch) {
            (merged.security as any).watch = {
                ...(base.security?.watch || {}),
                ...(override.security?.watch || {}),
            };
        }
        if (base.security?.shell || override.security?.shell) {
            (merged.security as any).shell = {
                ...(base.security?.shell || {}),
                ...(override.security?.shell || {}),
            };
        }
        if (base.security?.file || override.security?.file) {
            (merged.security as any).file = {
                ...(base.security?.file || {}),
                ...(override.security?.file || {}),
            };
        }
        if (base.security?.snapshot || override.security?.snapshot) {
            (merged.security as any).snapshot = {
                ...(base.security?.snapshot || {}),
                ...(override.security?.snapshot || {}),
            };
        }
    }

    return merged;
}

function createConfig(options: ACPCLIOptions): DiogenesConfig {
    const fileConfig = options.configFile ? loadConfig(options.configFile) : {};

    const envConfig: Partial<DiogenesConfig> = {};
    if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL || process.env.DIOGENES_MODEL) {
        envConfig.llm = {};
        if (process.env.OPENAI_API_KEY) envConfig.llm.apiKey = process.env.OPENAI_API_KEY;
        if (process.env.OPENAI_BASE_URL) envConfig.llm.baseURL = process.env.OPENAI_BASE_URL;
        if (process.env.DIOGENES_MODEL) envConfig.llm.model = process.env.DIOGENES_MODEL;
    }
    if (process.env.DIOGENES_WORKSPACE) {
        envConfig.security = {
            workspaceRoot: path.resolve(process.env.DIOGENES_WORKSPACE),
        };
    }

    const cliConfig: Partial<DiogenesConfig> = {};
    if (options.apiKey || options.baseUrl || options.model) {
        cliConfig.llm = {};
        if (options.apiKey) cliConfig.llm.apiKey = options.apiKey;
        if (options.baseUrl) cliConfig.llm.baseURL = options.baseUrl;
        if (options.model) cliConfig.llm.model = options.model;
    }
    if (options.workspace) {
        cliConfig.security = {
            workspaceRoot: path.resolve(options.workspace),
        };
    }

    const merged = mergeConfig(mergeConfig(fileConfig, envConfig), cliConfig);
    merged.security = {
        ...(merged.security || {}),
        interaction: {
            enabled: false,
        },
    };

    return merged as DiogenesConfig;
}

function formatDebugChunk(streamName: "stdin" | "stdout" | "stderr", chunk: string | Buffer): string {
    const content = Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : chunk;
    return `[${new Date().toISOString()}] ${streamName}\n${content}${content.endsWith("\n") ? "" : "\n"}`;
}

function createDebugInput(
    input: NodeJS.ReadStream,
    debugLog: fs.WriteStream,
): NodeJS.ReadStream {
    const mirroredInput = new PassThrough();

    input.on("data", (chunk: string | Buffer) => {
        debugLog.write(formatDebugChunk("stdin", chunk));
        mirroredInput.write(chunk);
    });
    input.on("end", () => mirroredInput.end());
    input.on("error", (error) => mirroredInput.destroy(error));

    return mirroredInput as unknown as NodeJS.ReadStream;
}

function createDebugOutput(
    output: NodeJS.WriteStream,
    debugLog: fs.WriteStream,
    streamName: "stdout" | "stderr",
): NodeJS.WriteStream {
    const mirroredOutput = new Writable({
        write(chunk, encoding, callback) {
            debugLog.write(formatDebugChunk(streamName, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)));

            output.write(chunk, encoding, (error) => {
                if (error) {
                    callback(error);
                    return;
                }
                callback();
            });
        },
    });

    return mirroredOutput as unknown as NodeJS.WriteStream;
}

export function createDebugStdio(
    filePath: string,
    input: NodeJS.ReadStream,
    output: NodeJS.WriteStream,
    error: NodeJS.WriteStream,
): {
    input: NodeJS.ReadStream;
    output: NodeJS.WriteStream;
    error: NodeJS.WriteStream;
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
    loadDotenv(options.envFile ? { path: options.envFile } : undefined);
    const config = createConfig(options);

    let input: NodeJS.ReadStream = process.stdin;
    let output: NodeJS.WriteStream = process.stdout;
    let error: NodeJS.WriteStream = process.stderr;

    if (options.debugStdioFile) {
        const debugStdio = createDebugStdio(options.debugStdioFile, input, output, error);
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
