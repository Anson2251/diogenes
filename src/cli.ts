#!/usr/bin/env node

/**
 * Diogenes CLI - Simple command-line interface for task execution
 */

import Table from "cli-table3";
import { Command } from "commander";
import { config as loadDotenv } from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { PassThrough, Writable } from "stream";
import * as yaml from "yaml";

import type { StoredSessionMetadata } from "./acp/types";
import type { SnapshotSummary } from "./snapshot/types";

import { SessionStore, type SessionPruneResult, isTemporarySession } from "./acp/session-store";
import { DEFAULT_SECURITY_CONFIG } from "./config/default-prompts";
import {
    executeTask,
    DiogenesConfig,
    TUILogger,
    Logger,
    LogLevel,
    createDiogenes,
    formatToolResults,
    startACPServer,
    type ConversationMessage,
    type DiogenesContextManager,
} from "./index";
import { getProviderApiKey } from "./utils/api-key-manager";
import { resolveDiogenesAppPaths } from "./utils/app-paths";
import {
    ensureDefaultConfigFileSync,
    ensureDefaultModelsConfigSync,
} from "./utils/config-bootstrap";
import {
    loadModelsConfig,
    listAvailableModels,
    resolveModelWithFallback,
    getProviderApiKeyEnvVarName,
} from "./utils/model-resolver";
import { ensureSnapshotResticConfigured } from "./utils/restic-manager";
import { collectSetupDiagnostics } from "./utils/setup-diagnostics";
import { parseSocraticToolInput } from "./utils/socratic-parser";

// ANSI color codes for terminal output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    red: "\x1b[31m",
    green: "\x1b[32m",
    yellow: "\x1b[33m",
    blue: "\x1b[34m",
    magenta: "\x1b[35m",
    cyan: "\x1b[36m",
};

interface CLIOptions {
    model?: string;
    baseUrl?: string;
    workspace?: string;
    resticBinary?: string;
    envFile?: string;
    debugStdioFile?: string | boolean;
    verbose?: boolean;
    maxIterations?: number;
    socratic?: boolean;
    interactive?: boolean;
    acp?: boolean;
    clearAppData?: boolean;
}

type CLICommand =
    | { kind: "run" }
    | { kind: "init" }
    | { kind: "doctor" }
    | { kind: "acp.server" }
    | { kind: "acp.init" }
    | { kind: "acp.doctor" }
    | { kind: "sessions.list" }
    | { kind: "sessions.get"; sessionId: string }
    | { kind: "sessions.snapshots"; sessionId: string }
    | { kind: "sessions.delete"; sessionId: string }
    | { kind: "sessions.prune"; dryRun: boolean; tempOnly: boolean }
    | { kind: "models.list" }
    | { kind: "models.default"; model?: string; clear?: boolean }
    | { kind: "models.use"; model?: string; clear?: boolean }
    | { kind: "models.path" }
    | { kind: "models.providers" }
    | { kind: "models.show"; model: string }
    | {
          kind: "models.addProvider";
          provider: string;
          style: "openai" | "anthropic";
          baseUrl?: string;
          supportsToolRole: boolean;
      }
    | {
          kind: "models.add";
          model: string;
          name: string;
          description?: string;
          contextWindow?: number;
          maxTokens?: number;
          temperature?: number;
      };

function getProviderEnvApiKey(providerName?: string): string | undefined {
    return getProviderApiKey(providerName || "openai");
}

function parseProviderModelRef(modelRef: string): { provider: string; model: string } | null {
    const slashIndex = modelRef.indexOf("/");
    if (slashIndex <= 0 || slashIndex >= modelRef.length - 1) {
        return null;
    }
    return {
        provider: modelRef.slice(0, slashIndex),
        model: modelRef.slice(slashIndex + 1),
    };
}

type QuestionFn = (prompt: string) => Promise<string>;
const CLEAR_APP_DATA_PASSPHRASE = "delete diogenes data";

/**
 * Parse command-line arguments
 */
function parseArgs(): { task?: string; options: CLIOptions; command: CLICommand } {
    let task: string | undefined;
    let command: CLICommand = { kind: "run" };
    const commandOptions: CLIOptions = {};

    const program = new Command()
        .name("diogenes")
        .usage("[OPTIONS] <COMMAND>")
        .description("Run tasks and manage local Diogenes state")
        .configureOutput({
            writeErr: (str: string) => {
                console.error(str.trimEnd());
            },
        })
        .showHelpAfterError("\nRun with --help for usage.")
        .allowExcessArguments(false)
        .option("-m, --model <model>", "Model to use (provider/model or model name)")
        .option("-b, --base-url <url>", "OpenAI-compatible API base URL")
        .option("-w, --workspace <path>", "Workspace directory")
        .option("--restic-binary <path>", "Path to the restic binary")
        .option("-e, --env-file <path>", "Env file to load before reading environment variables")
        .option(
            "--debug-stdio-file [path]",
            "Mirror ACP stdin/stdout/stderr to a debug log file (default path when omitted)",
        )
        .option("-V, --verbose", "Enable verbose output")
        .option("-i, --max-iterations <n>", "Maximum LLM iterations", (value: string) => {
            const parsed = Number.parseInt(value, 10);
            if (Number.isNaN(parsed)) {
                throw new Error(`Invalid integer value for --max-iterations: ${value}`);
            }
            return parsed;
        })
        .option("-s, --socratic", "Run in Socratic debug mode")
        .option("-I, --interactive", "Start interactive mode")
        .option("--acp", "Start ACP stdio server")
        .option("--clear-app-data", "Delete Diogenes config and local storage")
        .helpOption("-h, --help", "Print help")
        .version(getVersion(), "-v, --version", "Print version")
        .showSuggestionAfterError(true)
        .action(() => {
            command = { kind: "run" };
        });

    program
        .command("run <task...>")
        .summary("Run a task")
        .action((taskParts: string[]) => {
            command = { kind: "run" };
            task = taskParts.join(" ");
        });

    program
        .command("init")
        .summary("Show setup state and next steps")
        .action(() => {
            command = { kind: "init" };
        });

    program
        .command("doctor")
        .summary("Inspect setup readiness and snapshot state")
        .action(() => {
            command = { kind: "doctor" };
        });

    program
        .command("interactive")
        .summary("Start interactive mode")
        .action(() => {
            commandOptions.interactive = true;
        });

    program
        .command("socratic <task...>")
        .summary("Run in Socratic debug mode")
        .action((taskParts: string[]) => {
            commandOptions.socratic = true;
            task = taskParts.join(" ");
        });

    const acp = program
        .command("acp")
        .summary("Run ACP stdio server commands")
        .description("Start ACP server and inspect ACP setup state");
    acp.addHelpText("after", `\n${formatACPCLIHelp()}`);
    acp.action(() => {
        command = { kind: "acp.server" };
    });
    acp.command("server")
        .summary("Start ACP stdio server")
        .action(() => {
            command = { kind: "acp.server" };
        });
    acp.command("init")
        .summary("Show ACP setup state and config examples")
        .action(() => {
            command = { kind: "acp.init" };
        });
    acp.command("doctor")
        .summary("Inspect ACP config, logs, providers, and snapshots")
        .action(() => {
            command = { kind: "acp.doctor" };
        });

    program
        .command("clear-app-data")
        .summary("Delete Diogenes config and local storage")
        .action(() => {
            commandOptions.clearAppData = true;
        });

    const sessions = program
        .command("session")
        .summary("Manage stored sessions")
        .description("Inspect and clean stored session metadata and snapshots");
    sessions
        .command("list")
        .summary("List sessions")
        .action(() => {
            command = { kind: "sessions.list" };
        });
    sessions
        .command("get <sessionId>")
        .summary("Show one session")
        .action((sessionId: string) => {
            command = { kind: "sessions.get", sessionId };
        });
    sessions
        .command("snapshots <sessionId>")
        .summary("List session snapshots")
        .action((sessionId: string) => {
            command = { kind: "sessions.snapshots", sessionId };
        });
    sessions
        .command("delete <sessionId>")
        .alias("remove")
        .summary("Delete a session")
        .action((sessionId: string) => {
            command = { kind: "sessions.delete", sessionId };
        });
    sessions
        .command("prune")
        .summary("Remove broken session artifacts")
        .option("--dry-run", "Show what would be removed")
        .option("--temp", "Remove temporary test sessions")
        .action((subOptions: { dryRun?: boolean; temp?: boolean }) => {
            command = {
                kind: "sessions.prune",
                dryRun: Boolean(subOptions.dryRun),
                tempOnly: Boolean(subOptions.temp),
            };
        });

    const models = program
        .command("model")
        .summary("Manage configured models")
        .description("List available models and manage the default model");
    models.action(() => {
        command = { kind: "models.list" };
    });
    models
        .command("list")
        .summary("List models")
        .action(() => {
            command = { kind: "models.list" };
        });
    models
        .command("default [provider]/[model]")
        .summary("Get or set the fallback default model (in models.yaml)")
        .option("--clear", "Clear the configured default model")
        .action((model?: string, subOptions?: { clear?: boolean }) => {
            command = { kind: "models.default", model, clear: Boolean(subOptions?.clear) };
        });
    models
        .command("use [provider]/[model]")
        .summary("Get or set the active model (in config.yaml)")
        .option("--clear", "Clear the active model (will use default)")
        .action((model?: string, subOptions?: { clear?: boolean }) => {
            command = { kind: "models.use", model, clear: Boolean(subOptions?.clear) };
        });
    models
        .command("path")
        .summary("Show the managed models.yaml path")
        .action(() => {
            command = { kind: "models.path" };
        });
    models
        .command("providers")
        .summary("List configured providers")
        .action(() => {
            command = { kind: "models.providers" };
        });
    models
        .command("show <model>")
        .summary("Show one configured model definition")
        .action((model: string) => {
            command = { kind: "models.show", model };
        });
    models
        .command("add-provider <provider>")
        .summary("Add a provider entry to models.yaml")
        .requiredOption("--style <style>", "Provider style: openai or anthropic")
        .option("--base-url <url>", "Provider base URL")
        .option("--supports-tool-role", "Mark provider as supporting tool-role messages")
        .action(
            (
                provider: string,
                _subOptions: {
                    style: "openai" | "anthropic";
                    baseUrl?: string;
                    supportsToolRole?: boolean;
                },
                subCommand: Command,
            ) => {
                const subOptions = subCommand.opts<{
                    style: "openai" | "anthropic";
                    baseUrl?: string;
                    supportsToolRole?: boolean;
                }>();
                command = {
                    kind: "models.addProvider",
                    provider,
                    style: subOptions.style,
                    baseUrl: subOptions.baseUrl,
                    supportsToolRole: Boolean(subOptions.supportsToolRole),
                };
            },
        );
    models
        .command("add <provider>/<model>")
        .summary("Add a model definition under an existing provider")
        .requiredOption("--name <name>", "Human-readable model name")
        .option("--description <text>", "Model description")
        .option("--context-window <n>", "Context window size", (value: string) =>
            parseInt(value, 10),
        )
        .option("--max-tokens <n>", "Default max tokens", (value: string) => parseInt(value, 10))
        .option("--temperature <n>", "Default temperature", (value: string) => parseFloat(value))
        .action(
            (
                model: string,
                _subOptions: {
                    name: string;
                    description?: string;
                    contextWindow?: number;
                    maxTokens?: number;
                    temperature?: number;
                },
                subCommand: Command,
            ) => {
                const subOptions = subCommand.opts<{
                    name: string;
                    description?: string;
                    contextWindow?: number;
                    maxTokens?: number;
                    temperature?: number;
                }>();
                command = {
                    kind: "models.add",
                    model,
                    name: subOptions.name,
                    description: subOptions.description,
                    contextWindow: subOptions.contextWindow,
                    maxTokens: subOptions.maxTokens,
                    temperature: subOptions.temperature,
                };
            },
        );

    program.parse(process.argv);

    const parsedOptions = program.opts<CLIOptions>();
    let finalCommand = command as CLICommand;
    if (
        finalCommand.kind === "models.addProvider" &&
        parsedOptions.baseUrl &&
        !finalCommand.baseUrl
    ) {
        finalCommand = {
            ...finalCommand,
            baseUrl: parsedOptions.baseUrl,
        };
    }

    return {
        task,
        options: {
            model: commandOptions.model ?? parsedOptions.model,
            baseUrl: commandOptions.baseUrl ?? parsedOptions.baseUrl,
            workspace: commandOptions.workspace ?? parsedOptions.workspace,
            resticBinary: commandOptions.resticBinary ?? parsedOptions.resticBinary,
            envFile: commandOptions.envFile ?? parsedOptions.envFile,
            debugStdioFile: commandOptions.debugStdioFile ?? parsedOptions.debugStdioFile,
            verbose: commandOptions.verbose ?? parsedOptions.verbose,
            maxIterations: commandOptions.maxIterations ?? parsedOptions.maxIterations,
            socratic: commandOptions.socratic ?? parsedOptions.socratic,
            interactive: commandOptions.interactive ?? parsedOptions.interactive,
            acp: commandOptions.acp ?? parsedOptions.acp,
            clearAppData: commandOptions.clearAppData ?? parsedOptions.clearAppData,
        },
        command: finalCommand,
    };
}

/**
 * Show version information
 */
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

/**
 * Load configuration from file
 */
function loadConfig(configPath: string): Partial<DiogenesConfig> {
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        const ext = path.extname(configPath).toLowerCase();

        let raw: unknown;
        if (ext === ".json") {
            raw = JSON.parse(configContent);
        } else if (ext === ".yaml" || ext === ".yml") {
            raw = yaml.parse(configContent);
        } else {
            console.error(
                `${colors.yellow}Warning: Unsupported config file format ${ext}, using JSON${colors.reset}`,
            );
            raw = JSON.parse(configContent);
        }
        if (typeof raw !== "object" || raw === null) {
            return {};
        }
        // Object is validated at runtime, TypeScript trusts the function signature
        return raw as Partial<DiogenesConfig>;
    } catch (error) {
        console.error(
            `${colors.red}Error loading config file ${configPath}:${colors.reset}`,
            error,
        );
        process.exit(1);
    }
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

    if (base.logger || override.logger) {
        merged.logger = {
            ...(base.logger || {}),
            ...(override.logger || {}),
        };
    }

    if (base.security || override.security) {
        merged.security = {
            ...(base.security || {}),
            ...(override.security || {}),
        };

        if (base.security?.shell || override.security?.shell) {
            const baseShell = base.security?.shell;
            const overrideShell = override.security?.shell;
            merged.security.shell = {
                enabled:
                    overrideShell?.enabled ??
                    baseShell?.enabled ??
                    DEFAULT_SECURITY_CONFIG.shell.enabled,
                timeout:
                    overrideShell?.timeout ??
                    baseShell?.timeout ??
                    DEFAULT_SECURITY_CONFIG.shell.timeout,
                blockedCommands:
                    overrideShell?.blockedCommands ??
                    baseShell?.blockedCommands ??
                    DEFAULT_SECURITY_CONFIG.shell.blockedCommands,
            };
        }

        if (base.security?.file || override.security?.file) {
            const baseFile = base.security?.file;
            const overrideFile = override.security?.file;
            merged.security.file = {
                maxFileSize:
                    overrideFile?.maxFileSize ??
                    baseFile?.maxFileSize ??
                    DEFAULT_SECURITY_CONFIG.file.maxFileSize,
                blockedExtensions:
                    overrideFile?.blockedExtensions ??
                    baseFile?.blockedExtensions ??
                    DEFAULT_SECURITY_CONFIG.file.blockedExtensions,
            };
        }

        if (base.security?.watch || override.security?.watch) {
            const baseWatch = base.security?.watch;
            const overrideWatch = override.security?.watch;
            merged.security.watch = {
                enabled:
                    overrideWatch?.enabled ??
                    baseWatch?.enabled ??
                    DEFAULT_SECURITY_CONFIG.watch.enabled,
                debounceMs:
                    overrideWatch?.debounceMs ??
                    baseWatch?.debounceMs ??
                    DEFAULT_SECURITY_CONFIG.watch.debounceMs,
            };
        }

        if (base.security?.interaction || override.security?.interaction) {
            const baseInteraction = base.security?.interaction;
            const overrideInteraction = override.security?.interaction;
            merged.security.interaction = {
                enabled:
                    overrideInteraction?.enabled ??
                    baseInteraction?.enabled ??
                    DEFAULT_SECURITY_CONFIG.interaction.enabled,
            };
        }

        if (base.security?.snapshot || override.security?.snapshot) {
            const baseSnapshot = base.security?.snapshot;
            const overrideSnapshot = override.security?.snapshot;
            merged.security.snapshot = {
                enabled:
                    overrideSnapshot?.enabled ??
                    baseSnapshot?.enabled ??
                    DEFAULT_SECURITY_CONFIG.snapshot.enabled,
                includeDiogenesState:
                    overrideSnapshot?.includeDiogenesState ??
                    baseSnapshot?.includeDiogenesState ??
                    DEFAULT_SECURITY_CONFIG.snapshot.includeDiogenesState,
                autoBeforePrompt:
                    overrideSnapshot?.autoBeforePrompt ??
                    baseSnapshot?.autoBeforePrompt ??
                    DEFAULT_SECURITY_CONFIG.snapshot.autoBeforePrompt,
                storageRoot: DEFAULT_SECURITY_CONFIG.snapshot.storageRoot,
                resticBinary:
                    overrideSnapshot?.resticBinary ??
                    baseSnapshot?.resticBinary ??
                    DEFAULT_SECURITY_CONFIG.snapshot.resticBinary,
                resticBinaryArgs:
                    overrideSnapshot?.resticBinaryArgs ??
                    baseSnapshot?.resticBinaryArgs ??
                    DEFAULT_SECURITY_CONFIG.snapshot.resticBinaryArgs,
                timeoutMs:
                    overrideSnapshot?.timeoutMs ??
                    baseSnapshot?.timeoutMs ??
                    DEFAULT_SECURITY_CONFIG.snapshot.timeoutMs,
            };
        }
    }

    return merged;
}

/**
 * Create Diogenes configuration from CLI options
 */
function createConfig(options: CLIOptions): DiogenesConfig {
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

    if (modelsConfig && merged.llm && merged.llm.model && !merged.llm.provider) {
        const parsedRef = parseProviderModelRef(merged.llm.model);
        if (parsedRef && modelsConfig.providers[parsedRef.provider]) {
            merged.llm.provider = parsedRef.provider;
            merged.llm.model = parsedRef.model;
            merged.llm.providerStyle = modelsConfig.providers[parsedRef.provider].style;
            merged.llm.supportsToolRole =
                modelsConfig.providers[parsedRef.provider].supportsToolRole ?? false;
            if (!merged.llm.baseURL) {
                merged.llm.baseURL = modelsConfig.providers[parsedRef.provider].baseURL;
            }
        }
    }

    if (merged.llm && !merged.llm.apiKey) {
        const apiKey = getProviderEnvApiKey(merged.llm.provider);
        if (apiKey) {
            merged.llm.apiKey = apiKey;
        }
    }

    const interactiveToolsEnabled = options.interactive
        ? (merged.security?.interaction?.enabled ?? DEFAULT_SECURITY_CONFIG.interaction.enabled)
        : false;

    merged.security = {
        ...(merged.security || {}),
        interaction: {
            enabled: interactiveToolsEnabled,
        },
    };

    if (!options.interactive) {
        const note =
            "CLI note: task.ask and task.choose are unavailable in this session. Continue without interactive user questions.";
        merged.systemPrompt = merged.systemPrompt ? `${merged.systemPrompt}\n\n${note}` : note;
    }

    merged.security = {
        ...(merged.security || {}),
        snapshot: {
            ...((merged.security as { snapshot?: Record<string, unknown> })?.snapshot || {}),
            storageRoot: appPaths.sessionsDir,
        },
    };

    return merged as DiogenesConfig;
}

/**
 * Create a logger instance based on CLI options
 */
function createLogger(options: CLIOptions): Logger {
    const logger = new TUILogger();

    if (options.verbose) {
        logger.setLogLevel(LogLevel.DEBUG);
    } else {
        logger.setLogLevel(LogLevel.INFO);
    }

    return logger;
}

function createQuestionFn(rl: readline.Interface): QuestionFn {
    return async (prompt: string) =>
        new Promise<string>((resolve) => {
            rl.question(prompt, resolve);
        });
}

function loadCliEnv(options: CLIOptions): void {
    if (options.envFile) {
        loadDotenv({ path: options.envFile });
        return;
    }

    const cwdResult = loadDotenv({ quiet: true });
    if (!cwdResult.parsed) {
        const projectRoot = path.resolve(__dirname, "..");
        loadDotenv({ path: path.join(projectRoot, ".env"), quiet: true });
    }
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

function createDebugStdio(
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

function resolveDebugStdioFilePath(optionValue: CLIOptions["debugStdioFile"]): string | undefined {
    if (!optionValue) {
        return undefined;
    }

    if (typeof optionValue === "string") {
        return optionValue;
    }

    const appPaths = resolveDiogenesAppPaths();
    const logsDir = path.join(appPaths.dataDir, "logs");
    fs.mkdirSync(logsDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
    return path.join(logsDir, `acp-stdio-debug-${timestamp}.log`);
}

async function clearDiogenesAppData(
    question: QuestionFn,
    output: NodeJS.WriteStream = process.stdout,
): Promise<boolean> {
    const appPaths = resolveDiogenesAppPaths();
    const uniqueTargets = Array.from(new Set([appPaths.configDir, appPaths.dataDir]));

    output.write(
        `${colors.red}${colors.bright}Danger:${colors.reset} this will delete Diogenes config and local storage.\n`,
    );
    output.write(`- Config: ${appPaths.configDir}\n`);
    output.write(`- Local data: ${appPaths.dataDir}\n`);
    output.write(`Type ${colors.bright}${CLEAR_APP_DATA_PASSPHRASE}${colors.reset} to continue.\n`);

    const answer = (await question("> ")).trim();
    if (answer !== CLEAR_APP_DATA_PASSPHRASE) {
        output.write("Cancelled. Confirmation phrase did not match.\n");
        return false;
    }

    for (const target of uniqueTargets) {
        await fs.promises.rm(target, { recursive: true, force: true });
    }

    output.write("Diogenes config and local storage have been removed.\n");
    return true;
}

async function readTerminatedBlock(
    question: QuestionFn,
    linePrompt: string,
    finishToken = "..",
): Promise<string[]> {
    const lines: string[] = [];

    while (true) {
        const line = await question(linePrompt);
        if (line.trim() === finishToken) {
            break;
        }
        lines.push(line);
    }

    return lines;
}

function hasUnbalancedBraces(text: string): boolean {
    let depth = 0;
    for (const char of text) {
        if (char === "{") depth++;
        if (char === "}") depth--;
    }
    return depth > 0;
}

function startsToolCallBlock(text: string): boolean {
    const trimmed = text.trim().toLowerCase();
    return trimmed === "```tool-call" || trimmed === "```tool";
}

function normalizeSocraticCommand(input: string): string {
    return input.trim().replace(/^\//, "").toLowerCase();
}

async function readSocraticInput(question: QuestionFn): Promise<string> {
    const initial = await question(`${colors.magenta}socratic>${colors.reset} `);
    const trimmed = initial.trim();
    const normalized = normalizeSocraticCommand(trimmed);

    if (normalized === "paste") {
        console.log(
            `${colors.dim}  paste mode enabled; paste content, then enter '..' to finish${colors.reset}`,
        );
        const lines = await readTerminatedBlock(question, `${colors.dim}> ${colors.reset}`);
        return lines.join("\n");
    }

    if (normalized === "tool") {
        console.log(
            `${colors.dim}  tool mode enabled; enter tool-call content, then enter '..' to finish${colors.reset}`,
        );
        const lines = await readTerminatedBlock(question, `${colors.dim}> ${colors.reset}`);
        return lines.join("\n");
    }

    if (startsToolCallBlock(initial)) {
        console.log(
            `${colors.dim}  continuing tool-call block; enter '..' to finish if needed${colors.reset}`,
        );
        const lines = await readTerminatedBlock(question, `${colors.dim}> ${colors.reset}`);
        return [initial, ...lines].join("\n");
    }

    if (hasUnbalancedBraces(initial)) {
        console.log(`${colors.dim}  multiline JSON detected; enter '..' to finish${colors.reset}`);
        const lines = await readTerminatedBlock(question, `${colors.dim}> ${colors.reset}`);
        return [initial, ...lines].join("\n");
    }

    return initial;
}

/**
 * Execute a task with progress reporting
 */
async function executeTaskWithProgress(
    taskDescription: string,
    config: DiogenesConfig,
    options: CLIOptions,
    state?: {
        diogenes?: DiogenesContextManager;
        messageHistory?: ConversationMessage[];
    },
): Promise<ConversationMessage[]> {
    const logger = createLogger(options);

    // Print model name before starting
    const modelName = config.llm?.model || "unknown";
    console.log(`${colors.cyan}Using model: ${modelName}${colors.reset}\n`);

    try {
        const result = await executeTask(taskDescription, config, {
            maxIterations: options.maxIterations || 20,
            logger: logger,
            diogenes: state?.diogenes,
            messageHistory: state?.messageHistory,
        });
        return result.messageHistory || [];
    } catch (error) {
        if (error instanceof Error) {
            logger.taskError(error);
        } else {
            logger.taskError(new Error(String(error)));
        }
        process.exit(1);
    }
}

/**
 * Interactive mode: prompt user for tasks
 */
async function interactiveMode(config: DiogenesConfig, options: CLIOptions): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log(`${colors.cyan}${colors.bright}Diogenes Interactive Mode${colors.reset}`);
    console.log(`${colors.dim}Type 'exit', 'quit', or press Ctrl+C to exit${colors.reset}`);
    console.log(`${colors.dim}Type 'help' for available commands${colors.reset}\n`);

    const question = createQuestionFn(rl);

    const interactiveConfig: DiogenesConfig = {
        ...config,
        interactionHandlers: {
            ask: async (prompt: string) =>
                question(`\n${colors.cyan}[task.ask]${colors.reset} ${prompt}\n> `),
            choose: async (prompt: string, choices: string[]) => {
                const rendered = [
                    `\n${colors.cyan}[task.choose]${colors.reset} ${prompt}`,
                    ...choices.map((choice, index) => `  ${index + 1}. ${choice}`),
                ].join("\n");
                const answer = await question(`${rendered}\n> `);
                const trimmed = answer.trim();
                const index = Number.parseInt(trimmed, 10);

                if (!Number.isNaN(index) && index >= 1 && index <= choices.length) {
                    return choices[index - 1];
                }

                const directMatch = choices.find((choice) => choice === trimmed);
                if (directMatch) {
                    return directMatch;
                }

                throw new Error("Selection must be an option number or exact option text");
            },
        },
    };
    const interactiveDiogenes = createDiogenes(interactiveConfig);
    let messageHistory: ConversationMessage[] = [];

    while (true) {
        const input = await question(`${colors.blue}diogenes>${colors.reset} `);
        const trimmed = input.trim();

        if (!trimmed) {
            continue;
        }

        if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit") {
            break;
        }

        if (trimmed.toLowerCase() === "help") {
            console.log(`
${colors.bright}Available commands:${colors.reset}
  <task>              Execute a task
  exit, quit          Exit interactive mode
  help                Show this help
  clear               Clear the screen
  config              Show current configuration
      `);
            continue;
        }

        if (trimmed.toLowerCase() === "clear") {
            console.clear();
            continue;
        }

        if (trimmed.toLowerCase() === "config") {
            console.log(`${colors.bright}Current configuration:${colors.reset}`);
            console.log(`Model: ${config.llm?.model || "gpt-4"}`);
            console.log(`Workspace: ${config.security?.workspaceRoot || process.cwd()}`);
            console.log(`Max iterations: ${options.maxIterations || 20}`);
            console.log(`Verbose: ${options.verbose ? "Yes" : "No"}`);
            continue;
        }

        // Execute the task
        console.log();
        messageHistory = await executeTaskWithProgress(trimmed, interactiveConfig, options, {
            diogenes: interactiveDiogenes,
            messageHistory,
        });
        console.log();
    }

    rl.close();
    console.log(`${colors.dim}Goodbye!${colors.reset}`);
}

/**
 * Socratic debug mode: user acts as the "LLM" to guide the agent
 */
async function socraticMode(
    taskDescription: string,
    config: DiogenesConfig,
    options: CLIOptions,
): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log(`
${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}
${colors.cyan}${colors.bright}                    SOCRATIC DEBUG MODE                         ${colors.reset}
${colors.cyan}${colors.bright}═══════════════════════════════════════════════════════════════${colors.reset}
`);
    console.log(
        `${colors.yellow}You are the "LLM" guiding the agent through the task.${colors.reset}`,
    );
    console.log(`${colors.dim}Instead of the AI deciding what to do, YOU decide.${colors.reset}`);
    console.log(
        `${colors.dim}This is great for learning, debugging, or teaching others.${colors.reset}\n`,
    );

    const question = createQuestionFn(rl);

    const diogenes = createDiogenes(config);
    diogenes.setTask(taskDescription);

    let iterations = 0;
    const maxIterations = options.maxIterations || 20;

    const showHelp = () => {
        console.log(`
${colors.bright}Commands:${colors.reset}
  ${colors.green}tools${colors.reset}                Show available tools
  ${colors.green}context${colors.reset}              Show current context (loaded files, directories)
  ${colors.green}results${colors.reset}              Show tool execution history
  ${colors.green}task${colors.reset}                 Show the task description
  ${colors.green}tool${colors.reset}                 Enter multiline tool-call mode
  ${colors.green}paste${colors.reset}                Enter multiline paste mode
  ${colors.green}clear${colors.reset}                Clear the screen
  ${colors.green}exit${colors.reset}, ${colors.green}quit${colors.reset}          Exit socratic mode
  ${colors.green}help${colors.reset}                 Show this help

${colors.bright}How to call a tool:${colors.reset}
  ${colors.yellow}tool.name { "param": "value" }${colors.reset}

  Example:
  ${colors.yellow}dir.list { "path": "src" }${colors.reset}
  ${colors.yellow}file.load { "path": "src/cli.ts" }${colors.reset}
  ${colors.yellow}shell.exec { "command": "npm test" }${colors.reset}
  ${colors.yellow}task.end { "reason": "Fixed the bug", "summary": "Changed X to Y" }${colors.reset}

${colors.bright}Multiline:${colors.reset}
  Use ${colors.green}tool${colors.reset} to enter a multi-line tool-call block.
  Use ${colors.green}paste${colors.reset} to paste arbitrary multi-line text.
  Finish either mode with '..' on its own line.
`);
    };

    const showTools = () => {
        console.log(`\n${colors.bright}Available Tools:${colors.reset}`);
        console.log(diogenes.getToolDefinitions());
        console.log();
    };

    const showContext = () => {
        console.log(`\n${colors.bright}Current Context:${colors.reset}`);
        console.log(diogenes.buildContextOnly());
        console.log();
    };

    const showResults = () => {
        const state = diogenes.getState();
        if (state.toolResults.length === 0) {
            console.log(`\n${colors.dim}No tool results yet.${colors.reset}\n`);
        } else {
            console.log(`\n${colors.bright}Tool Execution History:${colors.reset}`);
            for (const result of state.toolResults) {
                console.log(result);
            }
            console.log();
        }
    };

    const showTask = () => {
        console.log(`\n${colors.bright}Task:${colors.reset}\n${taskDescription}\n`);
    };

    console.log(`${colors.bright}Starting task:${colors.reset} ${taskDescription}`);
    console.log(`${colors.dim}Type 'help' for available commands.${colors.reset}\n`);

    while (iterations < maxIterations) {
        iterations++;

        console.log(
            `${colors.cyan}──────────────────────── Iteration ${iterations}/${maxIterations} ────────────────────────${colors.reset}`,
        );

        const input = await readSocraticInput(question);
        const trimmed = input.trim();

        if (!trimmed) {
            continue;
        }

        const lower = normalizeSocraticCommand(trimmed);

        if (lower === "exit" || lower === "quit") {
            break;
        }

        if (lower === "help") {
            showHelp();
            continue;
        }

        if (lower === "tools") {
            showTools();
            continue;
        }

        if (lower === "context") {
            showContext();
            continue;
        }

        if (lower === "results") {
            showResults();
            continue;
        }

        if (lower === "task") {
            showTask();
            continue;
        }

        if (lower === "clear") {
            console.clear();
            continue;
        }

        const parseResult = parseSocraticToolInput(trimmed);

        if (!parseResult.success) {
            console.log(`${colors.red}Parse error: ${parseResult.error?.message}${colors.reset}`);
            console.log(
                `${colors.dim}Tip: Use tool.name { "param": "value" } or a full tool-call block${colors.reset}`,
            );
            continue;
        }

        const toolCalls = parseResult.toolCalls!;

        if (toolCalls.length === 0) {
            console.log(
                `${colors.yellow}No tool calls parsed. Use 'tools' to see available tools.${colors.reset}`,
            );
            continue;
        }

        for (const toolCall of toolCalls) {
            console.log(`${colors.green}→ Calling: ${toolCall.tool}${colors.reset}`);
        }

        try {
            const results = await diogenes.executeToolCalls(toolCalls);

            const formatted = formatToolResults(toolCalls, results);
            console.log(formatted);

            for (let i = 0; i < toolCalls.length; i++) {
                const toolCall = toolCalls[i];
                if (toolCall.tool === "task.end") {
                    console.log(
                        `\n${colors.green}${colors.bright}Task ended by user!${colors.reset}`,
                    );
                    console.log(
                        `${colors.dim}Reason: ${toolCall.params?.reason || "No reason"}${colors.reset}`,
                    );
                    rl.close();
                    console.log(`${colors.dim}Goodbye!${colors.reset}`);
                    return;
                }
            }
        } catch (error) {
            console.log(
                `${colors.red}Error executing tools: ${error instanceof Error ? error.message : String(error)}${colors.reset}`,
            );
        }

        console.log();
    }

    rl.close();
    console.log(`${colors.yellow}Max iterations reached. Goodbye!${colors.reset}`);
}

/**
 * Main CLI entry point
 */
async function main(): Promise<void> {
    const { task, options, command } = parseArgs();

    loadCliEnv(options);

    // Auto-cleanup temporary sessions on startup
    const sessionStore = new SessionStore();
    try {
        const removedCount = await sessionStore.cleanupTempSessions();
        if (removedCount.length > 0 && options.verbose) {
            console.log(
                `${colors.dim}Cleaned up ${removedCount.length} temporary session(s)${colors.reset}`,
            );
        }
    } catch {
        // Ignore cleanup errors
    }

    if (options.clearAppData) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            const question = createQuestionFn(rl);
            await clearDiogenesAppData(question, process.stdout);
        } finally {
            rl.close();
        }

        return;
    }

    if (options.acp || command.kind === "acp.server") {
        const configPath = ensureDefaultConfigFileSync();
        const config = createConfig(options);
        await ensureSnapshotResticConfigured(config, { configPath });

        let input: NodeJS.ReadStream | PassThrough = process.stdin;
        let output: NodeJS.WriteStream | Writable = process.stdout;
        let error: NodeJS.WriteStream | Writable = process.stderr;

        const debugStdioFilePath = resolveDebugStdioFilePath(options.debugStdioFile);
        if (debugStdioFilePath) {
            const debugStdio = createDebugStdio(
                debugStdioFilePath,
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
            maxIterations: options.maxIterations || 20,
            input,
            output,
            error,
        });
        return;
    }

    if (command.kind !== "run") {
        await handleCommand(command, options);
        return;
    }

    // Create configuration first so provider/model resolution can inject the correct key.
    const config = createConfig(options);

    if (!config.llm?.apiKey) {
        const expectedEnvVar = getProviderApiKeyEnvVarName(config.llm?.provider || "openai");
        console.error(`${colors.red}Error: API key is required.${colors.reset}`);
        console.error(`Expected environment variable: ${expectedEnvVar}`);
        console.error(`\n${colors.yellow}Troubleshooting tips:${colors.reset}`);
        console.error(`1. Export ${expectedEnvVar} for the selected provider.`);
        console.error(`2. Example: export ${expectedEnvVar}="your-key-here"`);
        console.error(`3. Check the provider name in models.yaml or config.yaml.`);
        process.exit(1);
    }

    // Validate workspace exists
    if (config.security?.workspaceRoot) {
        try {
            fs.accessSync(config.security.workspaceRoot, fs.constants.R_OK);
        } catch {
            console.error(
                `${colors.red}Error: Workspace directory not accessible: ${config.security.workspaceRoot}${colors.reset}`,
            );
            process.exit(1);
        }
    }

    // Test network connectivity with a simple message
    if (!options.verbose) {
        console.log(`${colors.dim}Testing API connectivity...${colors.reset}`);
    }

    // Execute task or start interactive mode
    if (task) {
        if (options.socratic) {
            await socraticMode(task, config, options);
        } else {
            await executeTaskWithProgress(task, config, options);
        }
    } else {
        // Check if interactive mode was explicitly requested
        if (options.interactive) {
            await interactiveMode(config, options);
        } else if (options.socratic) {
            console.error(`${colors.red}Error: Task required for socratic mode.${colors.reset}`);
            console.error(`Usage: diogenes socratic "your task here"`);
            process.exit(1);
        } else {
            console.error(`${colors.red}Error: No task provided.${colors.reset}`);
            console.error(`Usage: diogenes run "task"`);
            console.error(`       diogenes interactive`);
            console.error(`       diogenes socratic "task"`);
            process.exit(1);
        }
    }
}

async function handleCommand(
    command: Exclude<CLICommand, { kind: "run" } | { kind: "acp.server" }>,
    options: CLIOptions = {},
): Promise<void> {
    if (
        command.kind === "models.list" ||
        command.kind === "models.default" ||
        command.kind === "models.use" ||
        command.kind === "models.path" ||
        command.kind === "models.providers" ||
        command.kind === "models.show" ||
        command.kind === "models.addProvider" ||
        command.kind === "models.add"
    ) {
        handleModelsCommand(command);
        return;
    }

    if (
        command.kind === "init" ||
        command.kind === "doctor" ||
        command.kind === "acp.init" ||
        command.kind === "acp.doctor"
    ) {
        const configPath = ensureDefaultConfigFileSync();
        const config = createConfig(options);
        await ensureSnapshotResticConfigured(config, { configPath });
        const diagnostics = collectSetupDiagnostics(config);

        console.log(
            command.kind === "init"
                ? formatInitSummary(diagnostics)
                : command.kind === "doctor"
                  ? formatDoctorSummary(diagnostics)
                  : command.kind === "acp.init"
                    ? formatACPInitSummary(diagnostics)
                    : formatACPDoctorSummary(diagnostics),
        );
        return;
    }

    const sessionStore = new SessionStore();

    switch (command.kind) {
        case "sessions.list": {
            const sessions = await sessionStore.listMetadata(true); // Include temp sessions to show hidden count
            console.log(formatSessionList(sessions));
            return;
        }
        case "sessions.get": {
            const metadata = await sessionStore.readMetadata(command.sessionId);
            if (!metadata) {
                throw new Error(`Unknown managed session: ${command.sessionId}`);
            }
            const snapshots = await sessionStore.listSnapshots(command.sessionId);
            console.log(formatSessionDetails(metadata, snapshots));
            return;
        }
        case "sessions.snapshots": {
            const metadata = await sessionStore.readMetadata(command.sessionId);
            if (!metadata) {
                throw new Error(`Unknown managed session: ${command.sessionId}`);
            }
            const snapshots = await sessionStore.listSnapshots(command.sessionId);
            console.log(formatSnapshotList(command.sessionId, snapshots));
            return;
        }
        case "sessions.delete": {
            await sessionStore.removeSession(command.sessionId);
            console.log(formatSessionDelete(command.sessionId));
            return;
        }
        case "sessions.prune": {
            if (command.tempOnly) {
                const result = await pruneTemporarySessions(sessionStore, {
                    dryRun: command.dryRun,
                });
                console.log(formatTemporarySessionPrune(result, command.dryRun));
                return;
            }

            const result = await sessionStore.pruneSessions({ dryRun: command.dryRun });
            console.log(formatSessionPrune(result, command.dryRun));
            return;
        }
    }
}

async function pruneTemporarySessions(
    sessionStore: SessionStore,
    options: { dryRun: boolean },
): Promise<{ sessionIds: string[] }> {
    const sessions = await sessionStore.listMetadata(true); // Include temp sessions
    const sessionIds = sessions.filter(isTemporarySession).map((session) => session.sessionId);

    if (!options.dryRun) {
        await Promise.all(
            sessionIds.map(async (sessionId) => sessionStore.removeSession(sessionId)),
        );
    }

    return { sessionIds };
}

function formatTimeToMinute(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatInitSummary(diagnostics: ReturnType<typeof collectSetupDiagnostics>): string {
    const configuredProviders = diagnostics.providers.filter((provider) => provider.configured);

    return [
        `${colors.bright}Diogenes Init${colors.reset}`,
        configuredProviders.length > 0
            ? `Configured providers: ${configuredProviders.map((provider) => provider.provider).join(", ")}`
            : `Set one provider API key, for example ${diagnostics.providers[0]?.envVarName || "OPENAI_API_KEY"}`,
        diagnostics.snapshot.mode === "enabled"
            ? "Snapshots are ready."
            : diagnostics.snapshot.mode === "degraded"
              ? `Snapshots are degraded: ${diagnostics.snapshot.unavailableReason}`
              : "Snapshots are disabled.",
        `Config file: ${diagnostics.configPath}`,
        `Models file: ${diagnostics.modelsPath}`,
        "Run `diogenes doctor` for a detailed readiness report.",
    ].join("\n");
}

function formatDoctorSummary(diagnostics: ReturnType<typeof collectSetupDiagnostics>): string {
    return [
        `${colors.bright}Diogenes Doctor${colors.reset}`,
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

function formatACPCLIHelp(): string {
    return `Behavior:
  Default behavior starts the ACP stdio server.
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

function formatACPInitSummary(diagnostics: ReturnType<typeof collectSetupDiagnostics>): string {
    const acpCliPath = path.resolve(process.argv[1] || "dist/cli.js");
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
                args: [acpCliPath, "acp"],
                env: envObject,
            },
            null,
            2,
        ),
        "",
        "Run `diogenes acp doctor` for a detailed readiness report.",
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

function formatSessionList(sessions: StoredSessionMetadata[]): string {
    const visibleSessions = sessions.filter((session) => !isTemporarySession(session));
    const hiddenCount = sessions.length - visibleSessions.length;

    if (visibleSessions.length === 0) {
        return hiddenCount > 0
            ? `No stored sessions. ${colors.dim}(${hiddenCount} temporary test session(s) hidden)${colors.reset}`
            : "No stored sessions.";
    }

    const table = new Table({
        head: ["Session", "Title", "State", "Updated", "Workspace"],
        style: {
            head: ["cyan"],
            border: [],
        },
        wordWrap: true,
    });

    for (const session of visibleSessions) {
        table.push([
            session.sessionId,
            session.title || session.description || "(untitled)",
            session.state,
            formatTimeToMinute(session.updatedAt),
            session.cwd,
        ]);
    }

    return [
        `${colors.bright}Stored Sessions${colors.reset}`,
        table.toString(),
        hiddenCount > 0
            ? `${colors.dim}${hiddenCount} temporary test session(s) hidden${colors.reset}`
            : undefined,
    ]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
}

function formatSnapshotsTable(sessionId: string, snapshots: SnapshotSummary[]): string {
    if (snapshots.length === 0) {
        return `No snapshots for session ${sessionId}.`;
    }

    const table = new Table({
        head: ["Snapshot", "Turn", "Trigger", "Created", "Label"],
        style: {
            head: ["cyan"],
            border: [],
        },
        wordWrap: true,
    });

    for (const snapshot of snapshots) {
        table.push([
            snapshot.snapshotId,
            snapshot.turn,
            snapshot.trigger,
            formatTimeToMinute(snapshot.createdAt),
            snapshot.label || "-",
        ]);
    }

    return table.toString();
}

function formatSnapshotList(sessionId: string, snapshots: SnapshotSummary[]): string {
    if (snapshots.length === 0) {
        return `No snapshots for session ${sessionId}.`;
    }

    return `${colors.bright}Snapshots for ${sessionId}${colors.reset}\n${formatSnapshotsTable(sessionId, snapshots)}`;
}

function formatSessionDetails(
    metadata: StoredSessionMetadata,
    snapshots: SnapshotSummary[],
): string {
    return [
        `${colors.bright}Session${colors.reset} ${metadata.sessionId}`,
        `title: ${metadata.title || "(untitled)"}`,
        `description: ${metadata.description || "-"}`,
        `state: ${metadata.state}`,
        `cwd: ${metadata.cwd}`,
        `created: ${formatTimeToMinute(metadata.createdAt)}`,
        `updated: ${formatTimeToMinute(metadata.updatedAt)}`,
        `active run: ${metadata.hasActiveRun ? "yes" : "no"}`,
        `snapshots: ${snapshots.length}`,
        snapshots.length > 0 ? "" : undefined,
        snapshots.length > 0 ? formatSnapshotsTable(metadata.sessionId, snapshots) : undefined,
    ]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
}

function formatSessionDelete(sessionId: string): string {
    return `${colors.green}Deleted session:${colors.reset} ${sessionId}`;
}

function formatSessionPrune(result: SessionPruneResult, dryRun: boolean): string {
    const action = dryRun ? "Would remove" : "Removed";
    const deleted = result.deletedSessionIds;

    if (deleted.length === 0) {
        return dryRun ? "Nothing would be removed." : "Nothing to remove.";
    }

    return [
        `${colors.bright}${action} ${deleted.length} session artifact set(s)${colors.reset}`,
        ...deleted.map(
            (sessionId) =>
                `- ${sessionId} ${colors.dim}(${result.reasonsBySessionId[sessionId] || "unknown"})${colors.reset}`,
        ),
    ].join("\n");
}

function formatTemporarySessionPrune(result: { sessionIds: string[] }, dryRun: boolean): string {
    if (result.sessionIds.length === 0) {
        return dryRun
            ? "No temporary test sessions would be removed."
            : "No temporary test sessions to remove.";
    }

    return [
        `${colors.bright}${dryRun ? "Would remove" : "Removed"} ${result.sessionIds.length} temporary test session(s)${colors.reset}`,
        ...result.sessionIds.map((sessionId) => `- ${sessionId}`),
    ].join("\n");
}

function formatModelList(modelsConfig: NonNullable<ReturnType<typeof loadModelsConfig>>): string {
    const table = new Table({
        head: ["Model", "Provider", "Name", "Context", "Default"],
        style: {
            head: ["cyan"],
            border: [],
        },
        wordWrap: true,
    });

    for (const [providerName, provider] of Object.entries(modelsConfig.providers)) {
        for (const [modelName, model] of Object.entries(provider.models)) {
            const fullName = `${providerName}/${modelName}`;
            table.push([
                fullName,
                providerName,
                model.name,
                model.contextWindow ?? "-",
                modelsConfig.default === fullName ? "yes" : "",
            ]);
        }
    }

    return `${colors.bright}Available Models${colors.reset}\n${table.toString()}`;
}

function formatModelProviders(
    modelsConfig: NonNullable<ReturnType<typeof loadModelsConfig>>,
): string {
    const table = new Table({
        head: ["Provider", "Style", "Models", "Default API Key Env"],
        style: {
            head: ["cyan"],
            border: [],
        },
        wordWrap: true,
    });

    for (const [providerName, provider] of Object.entries(modelsConfig.providers)) {
        table.push([
            providerName,
            provider.style,
            Object.keys(provider.models).length,
            getProviderApiKeyEnvVarName(providerName),
        ]);
    }

    return `${colors.bright}Configured Providers${colors.reset}\n${table.toString()}`;
}

function formatModelDetails(
    modelsConfig: NonNullable<ReturnType<typeof loadModelsConfig>>,
    model: string,
): string {
    const parsedRef = parseProviderModelRef(model);
    if (!parsedRef) {
        const available = listAvailableModels(modelsConfig);
        console.error(`${colors.red}Error: Model "${model}" not found${colors.reset}`);
        console.error(`${colors.dim}Available models: ${available.join(", ")}${colors.reset}`);
        process.exit(1);
    }

    const providerName = parsedRef.provider;
    const modelName = parsedRef.model;
    const provider = modelsConfig.providers[providerName];
    const definition = provider?.models?.[modelName];

    if (!provider || !definition) {
        const available = listAvailableModels(modelsConfig);
        console.error(`${colors.red}Error: Model "${model}" not found${colors.reset}`);
        console.error(`${colors.dim}Available models: ${available.join(", ")}${colors.reset}`);
        process.exit(1);
    }

    return [
        `${colors.bright}Model${colors.reset} ${model}`,
        `provider: ${providerName}`,
        `style: ${provider.style}`,
        `name: ${definition.name}`,
        `description: ${definition.description || "-"}`,
        `context window: ${definition.contextWindow ?? "-"}`,
        `max tokens: ${definition.maxTokens ?? "-"}`,
        `temperature: ${definition.temperature ?? "-"}`,
        `base URL: ${provider.baseURL || "-"}`,
        `supports tool role: ${provider.supportsToolRole === true ? "yes" : "no"}`,
        `api key env: ${getProviderApiKeyEnvVarName(providerName)}`,
        `default: ${modelsConfig.default === model ? "yes" : "no"}`,
    ].join("\n");
}

function formatModelProviderAdded(provider: string): string {
    return `${colors.green}Added provider:${colors.reset} ${provider}`;
}

function formatModelAdded(model: string): string {
    return `${colors.green}Added model:${colors.reset} ${model}`;
}

function handleModelsCommand(
    command: Extract<
        CLICommand,
        {
            kind:
                | "models.list"
                | "models.default"
                | "models.use"
                | "models.path"
                | "models.providers"
                | "models.show"
                | "models.addProvider"
                | "models.add";
        }
    >,
): void {
    const modelsPath = ensureDefaultModelsConfigSync();
    const modelsConfig = loadModelsConfig(modelsPath);

    if (!modelsConfig) {
        console.error(`${colors.red}Error: Could not load models configuration${colors.reset}`);
        process.exit(1);
    }

    switch (command.kind) {
        case "models.list": {
            console.log(formatModelList(modelsConfig));
            return;
        }
        case "models.path": {
            console.log(modelsPath);
            return;
        }
        case "models.providers": {
            console.log(formatModelProviders(modelsConfig));
            return;
        }
        case "models.show": {
            console.log(formatModelDetails(modelsConfig, command.model));
            return;
        }
        case "models.addProvider": {
            if (modelsConfig.providers[command.provider]) {
                console.error(
                    `${colors.red}Error: Provider already exists: ${command.provider}${colors.reset}`,
                );
                process.exit(1);
            }

            modelsConfig.providers[command.provider] = {
                style: command.style,
                ...(command.baseUrl ? { baseURL: command.baseUrl } : {}),
                ...(command.supportsToolRole ? { supportsToolRole: true } : {}),
                models: {},
            };
            fs.writeFileSync(modelsPath, yaml.stringify(modelsConfig), "utf8");
            console.log(formatModelProviderAdded(command.provider));
            return;
        }
        case "models.add": {
            const parsedRef = parseProviderModelRef(command.model);
            const providerName = parsedRef?.provider;
            const modelName = parsedRef?.model;
            const provider = providerName ? modelsConfig.providers[providerName] : undefined;

            if (!provider || !modelName) {
                console.error(
                    `${colors.red}Error: Unknown provider for model: ${command.model}${colors.reset}`,
                );
                process.exit(1);
            }

            if (provider.models[modelName]) {
                console.error(
                    `${colors.red}Error: Model already exists: ${command.model}${colors.reset}`,
                );
                process.exit(1);
            }

            provider.models[modelName] = {
                name: command.name,
                ...(command.description ? { description: command.description } : {}),
                ...(typeof command.contextWindow === "number"
                    ? { contextWindow: command.contextWindow }
                    : {}),
                ...(typeof command.maxTokens === "number" ? { maxTokens: command.maxTokens } : {}),
                ...(typeof command.temperature === "number"
                    ? { temperature: command.temperature }
                    : {}),
            };
            fs.writeFileSync(modelsPath, yaml.stringify(modelsConfig), "utf8");
            console.log(formatModelAdded(command.model));
            return;
        }
        case "models.default": {
            if (command.clear) {
                delete modelsConfig.default;
                fs.writeFileSync(modelsPath, yaml.stringify(modelsConfig), "utf8");
                console.log(`${colors.green}Default model cleared${colors.reset}`);
            } else if (command.model) {
                const available = listAvailableModels(modelsConfig);
                if (!available.includes(command.model)) {
                    console.error(
                        `${colors.red}Error: Unknown model: ${command.model}${colors.reset}`,
                    );
                    console.error(
                        `${colors.dim}Available models: ${available.join(", ")}${colors.reset}`,
                    );
                    process.exit(1);
                }
                modelsConfig.default = command.model;
                fs.writeFileSync(modelsPath, yaml.stringify(modelsConfig), "utf8");
                console.log(`${colors.green}Default model set to: ${command.model}${colors.reset}`);
            } else {
                if (modelsConfig.default) {
                    console.log(modelsConfig.default);
                } else {
                    console.log(`${colors.yellow}No default model configured${colors.reset}`);
                }
            }
            return;
        }
        case "models.use": {
            const configPath = ensureDefaultConfigFileSync();
            const fileConfig = loadConfig(configPath);

            if (command.clear) {
                if (fileConfig.llm) {
                    delete fileConfig.llm;
                    fs.writeFileSync(configPath, yaml.stringify(fileConfig), "utf8");
                }
                console.log(`${colors.green}Active model cleared${colors.reset}`);
                if (modelsConfig.default) {
                    console.log(
                        `${colors.dim}Will use default: ${modelsConfig.default}${colors.reset}`,
                    );
                }
            } else if (command.model) {
                const available = listAvailableModels(modelsConfig);
                if (!available.includes(command.model)) {
                    console.error(
                        `${colors.red}Error: Unknown model: ${command.model}${colors.reset}`,
                    );
                    console.error(
                        `${colors.dim}Available models: ${available.join(", ")}${colors.reset}`,
                    );
                    process.exit(1);
                }
                fileConfig.llm = { model: command.model };
                fs.writeFileSync(configPath, yaml.stringify(fileConfig), "utf8");
                console.log(`${colors.green}Active model set to: ${command.model}${colors.reset}`);
            } else {
                if (fileConfig.llm?.model) {
                    console.log(fileConfig.llm.model);
                } else {
                    console.log(`${colors.yellow}No active model set${colors.reset}`);
                    if (modelsConfig.default) {
                        console.log(
                            `${colors.dim}Will use default: ${modelsConfig.default}${colors.reset}`,
                        );
                    }
                }
            }
            return;
        }
    }
}

// Run the CLI
if (require.main === module) {
    main().catch((error: unknown) => {
        if (error instanceof Error) {
            // Don't show stack trace for known user errors
            const userErrorPatterns = [
                "Unknown managed session",
                "Unknown model",
                "API key is required",
                "Error: Provider already exists",
                "Error: Model already exists",
                "Error: Unknown provider",
            ];
            const isUserError = userErrorPatterns.some((pattern) =>
                error.message.includes(pattern),
            );
            if (isUserError) {
                console.error(`${colors.red}Error:${colors.reset} ${error.message}`);
            } else {
                console.error(`${colors.red}Fatal error:${colors.reset}`, error);
            }
        } else {
            console.error(`${colors.red}Fatal error:${colors.reset}`, error);
        }
        process.exit(1);
    });
}

export {
    main,
    parseArgs,
    createConfig,
    createDebugStdio,
    formatACPCLIHelp,
    formatACPInitSummary,
    formatACPDoctorSummary,
    clearDiogenesAppData,
    handleCommand,
    CLEAR_APP_DATA_PASSPHRASE,
}; // For testing
