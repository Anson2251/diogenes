#!/usr/bin/env node

import { Command } from "commander";
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
import { ensureSnapshotResticConfigured } from "./utils/restic-manager";
import { collectSetupDiagnostics } from "./utils/setup-diagnostics";

interface ACPCLIOptions {
    model?: string;
    baseUrl?: string;
    workspace?: string;
    resticBinary?: string;
    envFile?: string;
    maxIterations?: number;
    debugStdioFile?: string;
}

type ACPCLICommand = "server" | "init" | "doctor";

function getProviderEnvApiKey(providerName?: string): string | undefined {
    return getProviderApiKey(providerName || "openai");
}

function parseArgs(): { options: ACPCLIOptions; command: ACPCLICommand } {
    let options: ACPCLIOptions = {};
    let command: ACPCLICommand = "server";

    const program = new Command()
        .name("diogenes-acp")
        .usage("[OPTIONS] [COMMAND]")
        .description("Start or inspect the Diogenes ACP stdio server")
        .configureOutput({
            writeErr: (str: string) => {
                console.error(str.trimEnd());
            },
        })
        .showHelpAfterError("\nRun with --help for usage.")
        .showSuggestionAfterError(true)
        .allowExcessArguments(false)
        .helpOption("-h, --help", "Print help")
        .version(getVersion(), "-v, --version", "Print version")
        .action(() => {
            command = "server";
        });

    applyCommonOptions(program);
    program.addHelpText("after", `\n${formatACPCLIHelp()}`);

    const initCommand = program
        .command("init")
        .summary("Show ACP setup state and config examples")
        .action((_args, subCommand: Command) => {
            command = "init";
            options = getCommandOptions(subCommand);
        });
    applyCommonOptions(initCommand);

    const doctorCommand = program
        .command("doctor")
        .summary("Inspect ACP config, logs, providers, and snapshots")
        .action((_args, subCommand: Command) => {
            command = "doctor";
            options = getCommandOptions(subCommand);
        });
    applyCommonOptions(doctorCommand);

    program.parse(process.argv);

    if (command === "server") {
        options = program.opts<ACPCLIOptions>();
    }

    return { options, command };
}

function applyCommonOptions(command: Command): void {
    command
        .option("-m, --model <model>", "LLM model")
        .option("-b, --base-url <url>", "OpenAI-compatible API base URL")
        .option("-w, --workspace <path>", "Workspace directory")
        .option("--restic-binary <path>", "Path to the restic binary")
        .option("-e, --env-file <path>", "Env file to load before reading environment variables")
        .option(
            "-i, --max-iterations <n>",
            "Maximum iterations per session/prompt run",
            (value: string) => {
                const parsed = Number.parseInt(value, 10);
                if (Number.isNaN(parsed)) {
                    throw new Error(`Invalid integer value for --max-iterations: ${value}`);
                }
                return parsed;
            },
        )
        .option("--debug-stdio-file <path>", "Mirror ACP stdin/stdout/stderr to a debug log file");
}

function getCommandOptions(command: Command): ACPCLIOptions {
    return command.optsWithGlobals<ACPCLIOptions>();
}

function formatACPCLIHelp(): string {
    return `Behavior:
  No subcommand starts the ACP stdio server.
  Use 'init' to print ACP config examples and setup hints.
  Use 'doctor' to inspect config, logs, providers, and snapshot readiness.

Environment Variables:
  <PROVIDER>_API_KEY
  OPENAI_BASE_URL
  DIOGENES_MODEL
  DIOGENES_WORKSPACE
  DIOGENES_RESTIC_BINARY

API Key Rule:
  Provider API keys are resolved from the provider name in models.yaml.
  Example: openai -> OPENAI_API_KEY, claude-proxy -> CLAUDE_PROXY_API_KEY

Model Management:
  models.yaml is managed under the Diogenes config directory and is auto-generated on first run.
  Use the main CLI to inspect or edit model definitions:
    diogenes model path
    diogenes model providers
    diogenes model show <provider/model>
    diogenes model add-provider <provider> --style <openai|anthropic>
    diogenes model add <provider/model> --name <name>
    diogenes model default [provider/model]
`;
}

function getVersion(): string {
    try {
        const content = fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8");
        const raw: unknown = JSON.parse(content);
        return typeof raw === "object" &&
            raw !== null &&
            "version" in raw &&
            typeof raw.version === "string"
            ? raw.version
            : "unknown";
    } catch {
        return "unknown";
    }
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
    if (process.env.DIOGENES_RESTIC_BINARY) {
        envConfig.security = {
            ...(envConfig.security || {}),
            snapshot: {
                ...(envConfig.security?.snapshot || {}),
                resticBinary: path.resolve(process.env.DIOGENES_RESTIC_BINARY),
            },
        };
    }

    const cliConfig: Partial<DiogenesConfig> = {};
    if (options.baseUrl || options.model) {
        cliConfig.llm = {};
        if (options.baseUrl) cliConfig.llm.baseURL = options.baseUrl;
        if (options.model) cliConfig.llm.model = options.model;
    }
    if (options.workspace || options.resticBinary) {
        cliConfig.security = {
            ...(cliConfig.security || {}),
        };
        if (options.workspace) {
            cliConfig.security.workspaceRoot = path.resolve(options.workspace);
        }
        if (options.resticBinary) {
            cliConfig.security.snapshot = {
                ...(cliConfig.security.snapshot || {}),
                resticBinary: path.resolve(options.resticBinary),
            };
        }
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

async function main(): Promise<void> {
    const parsed = parseArgs();
    const options = parsed.options;

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

    const configPath = ensureDefaultConfigFileSync();
    const config = createConfig(options);
    await ensureSnapshotResticConfigured(config, { configPath });

    if (parsed.command === "init" || parsed.command === "doctor") {
        const diagnostics = collectSetupDiagnostics(config);
        console.log(
            parsed.command === "init"
                ? formatACPInitSummary(diagnostics)
                : formatACPDoctorSummary(diagnostics),
        );
        return;
    }

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

function formatACPInitSummary(diagnostics: ReturnType<typeof collectSetupDiagnostics>): string {
    const acpCliPath = path.resolve(process.argv[1] || "dist/acp-cli.js");
    const configuredProviders = diagnostics.providers.filter((provider) => provider.configured);
    const preferredEnvVars =
        configuredProviders.length > 0
            ? configuredProviders.map((provider) => provider.envVarName)
            : diagnostics.providers.slice(0, 3).map((provider) => provider.envVarName);
    const envObject = Object.fromEntries(preferredEnvVars.map((key) => [key, "$" + `{${key}}`]));

    return [
        "Diogenes ACP Init",
        "",
        configuredProviders.length > 0
            ? `Configured providers: ${configuredProviders.map((provider) => provider.provider).join(", ")}`
            : `Set one provider API key, for example ${diagnostics.providers[0]?.envVarName || "OPENAI_API_KEY"}`,
        diagnostics.snapshot.mode === "enabled"
            ? "Snapshots are ready for ACP."
            : diagnostics.snapshot.mode === "degraded"
              ? `Snapshots are degraded: ${diagnostics.snapshot.unavailableReason}`
              : "Snapshots are disabled.",
        `Config file: ${diagnostics.configPath}`,
        `Models file: ${diagnostics.modelsPath}`,
        "",
        "ACP command:",
        `node ${acpCliPath}`,
        "",
        "Environment variable keys:",
        ...preferredEnvVars.map((key) => `- ${key}`),
        "",
        "ACP config example:",
        JSON.stringify(
            {
                command: "node",
                args: [acpCliPath],
                env: envObject,
            },
            null,
            2,
        ),
        "",
        "Run `diogenes-acp doctor` for a detailed readiness report.",
    ].join("\n");
}

function formatACPDoctorSummary(diagnostics: ReturnType<typeof collectSetupDiagnostics>): string {
    return [
        "Diogenes ACP Doctor",
        "",
        `Config Dir: ${diagnostics.configDir}`,
        `Data Dir: ${diagnostics.dataDir}`,
        `ACP Logs Dir: ${diagnostics.acpLogsDir}`,
        `ACP Current Log: ${diagnostics.acpCurrentLogFile}`,
        `Config File: ${diagnostics.configExists ? "present" : "missing"} (${diagnostics.configPath})`,
        `Models File: ${diagnostics.modelsExists ? "present" : "missing"} (${diagnostics.modelsPath})`,
        "",
        "Providers:",
        ...diagnostics.providers.map(
            (provider) =>
                `- ${provider.provider}: ${provider.configured ? "configured" : "missing"} via ${provider.envVarName}`,
        ),
        "",
        "Snapshots:",
        `- mode: ${diagnostics.snapshot.mode}`,
        `- requested: ${diagnostics.snapshot.requested ? "yes" : "no"}`,
        `- binary: ${diagnostics.snapshot.resticBinary || "(not set)"}`,
        diagnostics.snapshot.unavailablePhase
            ? `- phase: ${diagnostics.snapshot.unavailablePhase}`
            : undefined,
        diagnostics.snapshot.unavailableKind
            ? `- kind: ${diagnostics.snapshot.unavailableKind}`
            : undefined,
        diagnostics.snapshot.unavailableReason
            ? `- reason: ${diagnostics.snapshot.unavailableReason}`
            : undefined,
    ]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
}

if (require.main === module) {
    main().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
    });
}

export {
    main,
    parseArgs,
    createConfig,
    formatACPCLIHelp,
    formatACPInitSummary,
    formatACPDoctorSummary,
};
