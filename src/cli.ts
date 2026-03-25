#!/usr/bin/env node

/**
 * Diogenes CLI - Simple command-line interface for task execution
 */

// Load environment variables from .env file
import { config } from "dotenv";
config();

import { executeTask, DiogenesConfig, TUILogger, Logger, LogLevel, createDiogenes, parseToolCalls, formatToolResults } from "./index";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml"
import { DEFAULT_SECURITY_CONFIG } from "./config/default-prompts";

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
    apiKey?: string;
    model?: string;
    baseUrl?: string;
    workspace?: string;
    config?: string;
    verbose?: boolean;
    maxIterations?: number;
    socratic?: boolean;
    interactive?: boolean;
}

/**
 * Parse command-line arguments
 */
function parseArgs(): { task?: string; options: CLIOptions } {
    const args = process.argv.slice(2);
    const options: CLIOptions = {};
    let task: string | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg === "--help" || arg === "-h") {
            showHelp();
            process.exit(0);
        } else if (arg === "--version" || arg === "-v") {
            showVersion();
            process.exit(0);
        } else if (arg === "--api-key" || arg === "-k") {
            options.apiKey = args[++i];
        } else if (arg === "--model" || arg === "-m") {
            options.model = args[++i];
        } else if (arg === "--base-url" || arg === "-b") {
            options.baseUrl = args[++i];
        } else if (arg === "--workspace" || arg === "-w") {
            options.workspace = args[++i];
        } else if (arg === "--config" || arg === "-c") {
            options.config = args[++i];
        } else if (arg === "--verbose" || arg === "-V") {
            options.verbose = true;
        } else if (arg === "--socratic" || arg === "-s") {
            options.socratic = true;
        } else if (arg === "--interactive" || arg === "-I") {
            options.interactive = true;
        } else if (arg === "--max-iterations" || arg === "-i") {
            options.maxIterations = parseInt(args[++i], 10);
        } else if (arg.startsWith("-")) {
            console.error(
                `${colors.red}Error: Unknown option ${arg}${colors.reset}`,
            );
            showHelp();
            process.exit(1);
        } else {
            // First non-option argument is the task
            if (!task) {
                task = arg;
            } else {
                // Append to task if it contains spaces
                task += " " + arg;
            }
        }
    }

    return { task, options };
}

/**
 * Show help message
 */
function showHelp(): void {
    console.log(`
${colors.bright}Diogenes CLI - LLM-controlled agent framework${colors.reset}

${colors.bright}Usage:${colors.reset}
  diogenes [options] <task>
  diogenes [options] --interactive
  diogenes --help

${colors.bright}Options:${colors.reset}
  -h, --help                    Show this help message
  -v, --version                 Show version information
  -k, --api-key <key>           OpenAI API key (or set OPENAI_API_KEY env var)
  -m, --model <model>           LLM model to use (default: gpt-4)
  -b, --base-url <url>          OpenAI-compatible API base URL
  -w, --workspace <path>        Workspace directory (default: current directory)
  -c, --config <path>           Configuration file path
  -V, --verbose                 Enable verbose output
  -i, --max-iterations <n>      Maximum LLM iterations (default: 20)
  -s, --socratic                Socratic debug mode - you guide the agent
  -I, --interactive             Start interactive mode

${colors.bright}Examples:${colors.reset}
  diogenes "List all TypeScript files in src directory"
  diogenes --api-key sk-... "Fix type errors in utils.ts"
  diogenes --base-url https://api.openai.com/v1 "Use custom OpenAI endpoint"
  diogenes --workspace ./my-project "Analyze project structure"
  diogenes --interactive        Start interactive mode
  diogenes --socratic "Debug my code"

${colors.bright}Environment Variables:${colors.reset}
  OPENAI_API_KEY                OpenAI API key (alternative to --api-key)
  OPENAI_BASE_URL               OpenAI-compatible API base URL
  DIOGENES_WORKSPACE            Default workspace directory
  DIOGENES_MODEL                Default LLM model

${colors.bright}Configuration:${colors.reset}
  Environment variables can be loaded from a .env file in the current directory
  or specified via --config option. Create a .env file with your credentials:

  OPENAI_API_KEY=sk-your-api-key-here
  OPENAI_BASE_URL=https://api.openai.com/v1
  DIOGENES_MODEL=gpt-4
`);
}

/**
 * Show version information
 */
function showVersion(): void {
    try {
        const packageJson = JSON.parse(
            fs.readFileSync(
                path.join(__dirname, "..", "package.json"),
                "utf-8",
            ),
        );
        console.log(`Diogenes v${packageJson.version}`);
    } catch {
        console.log("Diogenes (version unknown)");
    }
}

/**
 * Load configuration from file
 */
function loadConfig(configPath: string): Partial<DiogenesConfig> {
    try {
        const configContent = fs.readFileSync(configPath, "utf-8");
        const ext = path.extname(configPath).toLowerCase();

        if (ext === ".json") {
            return JSON.parse(configContent);
        } else if (ext === ".yaml" || ext === ".yml") {
            return yaml.parse(configContent);
        } else {
            console.error(
                `${colors.yellow}Warning: Unsupported config file format ${ext}, using JSON${colors.reset}`,
            );
            return JSON.parse(configContent);
        }
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
                enabled: overrideShell?.enabled ?? baseShell?.enabled ?? DEFAULT_SECURITY_CONFIG.shell.enabled,
                timeout: overrideShell?.timeout ?? baseShell?.timeout ?? DEFAULT_SECURITY_CONFIG.shell.timeout,
                blockedCommands: overrideShell?.blockedCommands ?? baseShell?.blockedCommands ?? DEFAULT_SECURITY_CONFIG.shell.blockedCommands,
            };
        }

        if (base.security?.file || override.security?.file) {
            const baseFile = base.security?.file;
            const overrideFile = override.security?.file;
            merged.security.file = {
                maxFileSize: overrideFile?.maxFileSize ?? baseFile?.maxFileSize ?? DEFAULT_SECURITY_CONFIG.file.maxFileSize,
                blockedExtensions: overrideFile?.blockedExtensions ?? baseFile?.blockedExtensions ?? DEFAULT_SECURITY_CONFIG.file.blockedExtensions,
            };
        }

        if (base.security?.watch || override.security?.watch) {
            const baseWatch = base.security?.watch;
            const overrideWatch = override.security?.watch;
            merged.security.watch = {
                enabled: overrideWatch?.enabled ?? baseWatch?.enabled ?? DEFAULT_SECURITY_CONFIG.watch.enabled,
                debounceMs: overrideWatch?.debounceMs ?? baseWatch?.debounceMs ?? DEFAULT_SECURITY_CONFIG.watch.debounceMs,
            };
        }

        if (base.security?.interaction || override.security?.interaction) {
            const baseInteraction = base.security?.interaction;
            const overrideInteraction = override.security?.interaction;
            merged.security.interaction = {
                enabled: overrideInteraction?.enabled ?? baseInteraction?.enabled ?? DEFAULT_SECURITY_CONFIG.interaction.enabled,
            };
        }
    }

    return merged;
}

/**
 * Get API key from options or environment
 */
function getApiKey(options: CLIOptions): string | undefined {
    if (options.apiKey) {
        return options.apiKey;
    }

    // Check environment variable
    if (process.env.OPENAI_API_KEY) {
        return process.env.OPENAI_API_KEY;
    }

    return undefined;
}

/**
 * Create Diogenes configuration from CLI options
 */
function createConfig(options: CLIOptions): DiogenesConfig {
    const fileConfig = options.config ? loadConfig(options.config) : {};

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

/**
 * Execute a task with progress reporting
 */
async function executeTaskWithProgress(
    taskDescription: string,
    config: DiogenesConfig,
    options: CLIOptions,
): Promise<void> {
    const logger = createLogger(options);

    // Print model name before starting
    const modelName = config.llm?.model || "unknown";
    console.log(`${colors.cyan}Using model: ${modelName}${colors.reset}\n`);

    try {
        await executeTask(taskDescription, config, {
            maxIterations: options.maxIterations || 20,
            logger: logger,
        });
    } catch (error) {
        logger.taskError(error as Error);
        process.exit(1);
    }
}

/**
 * Interactive mode: prompt user for tasks
 */
async function interactiveMode(
    config: DiogenesConfig,
    options: CLIOptions,
): Promise<void> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log(
        `${colors.cyan}${colors.bright}Diogenes Interactive Mode${colors.reset}`,
    );
    console.log(
        `${colors.dim}Type 'exit', 'quit', or press Ctrl+C to exit${colors.reset}`,
    );
    console.log(
        `${colors.dim}Type 'help' for available commands${colors.reset}\n`,
    );

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    while (true) {
        const input = await question(`${colors.blue}diogenes>${colors.reset} `);
        const trimmed = input.trim();

        if (!trimmed) {
            continue;
        }

        if (
            trimmed.toLowerCase() === "exit" ||
            trimmed.toLowerCase() === "quit"
        ) {
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
            console.log(
                `${colors.bright}Current configuration:${colors.reset}`,
            );
            console.log(`Model: ${config.llm?.model || "gpt-4"}`);
            console.log(
                `Workspace: ${config.security?.workspaceRoot || process.cwd()}`,
            );
            console.log(`Max iterations: ${options.maxIterations || 20}`);
            console.log(`Verbose: ${options.verbose ? "Yes" : "No"}`);
            continue;
        }

        // Execute the task
        console.log();
        await executeTaskWithProgress(trimmed, config, options);
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
    console.log(`${colors.yellow}You are the "LLM" guiding the agent through the task.${colors.reset}`);
    console.log(`${colors.dim}Instead of the AI deciding what to do, YOU decide.${colors.reset}`);
    console.log(`${colors.dim}This is great for learning, debugging, or teaching others.${colors.reset}\n`);

    const question = (prompt: string): Promise<string> => {
        return new Promise((resolve) => {
            rl.question(prompt, resolve);
        });
    };

    const readMultilineInput = async (initialPrompt: string): Promise<string> => {
        let input = "";
        let braceCount = 0;
        let inBraces = false;
        let inCodeBlock = false;
        let lines: string[] = [];

        input = await question(initialPrompt);

        const checkForToolCallBlock = (text: string): boolean => {
            const trimmed = text.trim().toLowerCase();
            return trimmed === "```tool-call" || trimmed === "```tool";
        };

        if (checkForToolCallBlock(input)) {
            inCodeBlock = true;
            console.log(`${colors.dim}  ... (enter more lines, '..' to finish)${colors.reset}`);
        } else {
            for (const char of input) {
                if (char === '{') {
                    braceCount++;
                    inBraces = true;
                } else if (char === '}') {
                    braceCount--;
                    if (braceCount === 0) inBraces = false;
                }
            }
            if (inBraces) {
                console.log(`${colors.dim}  ... (enter more lines, '..' to finish)${colors.reset}`);
            }
        }

        while (inBraces || inCodeBlock) {
            const line = await question(`${colors.dim}> ${colors.reset}`);
            const trimmed = line.trim();

            if (trimmed === "..") {
                break;
            }

            lines.push(line);

            if (inCodeBlock) {
                if (trimmed.startsWith("```")) {
                    break;
                }
            } else if (inBraces) {
                for (const char of line) {
                    if (char === '{') braceCount++;
                    else if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) inBraces = false;
                    }
                }
            }
        }

        if (lines.length > 0) {
            input += "\n" + lines.join("\n");
        }

        return input;
    };

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
  Type tool calls across multiple lines. Enter '..' to finish.
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

        console.log(`${colors.cyan}──────────────────────── Iteration ${iterations}/${maxIterations} ────────────────────────${colors.reset}`);

        const input = await readMultilineInput(`${colors.magenta}socratic>${colors.reset} `);
        const trimmed = input.trim();

        if (!trimmed) {
            continue;
        }

        const lower = trimmed.toLowerCase();

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

        console.log(trimmed)
        const parseResult = parseToolCalls(trimmed);

        if (!parseResult.success) {
            console.log(`${colors.red}Parse error: ${parseResult.error?.message}${colors.reset}`);
            console.log(`${colors.dim}Tip: Use format: tool.name { "param": "value" }${colors.reset}`);
            continue;
        }

        const toolCalls = parseResult.toolCalls!;

        if (toolCalls.length === 0) {
            console.log(`${colors.yellow}No tool calls parsed. Use 'tools' to see available tools.${colors.reset}`);
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
                    console.log(`\n${colors.green}${colors.bright}Task ended by user!${colors.reset}`);
                    console.log(`${colors.dim}Reason: ${toolCall.params?.reason || "No reason"}${colors.reset}`);
                    rl.close();
                    console.log(`${colors.dim}Goodbye!${colors.reset}`);
                    return;
                }
            }
        } catch (error) {
            console.log(`${colors.red}Error executing tools: ${error instanceof Error ? error.message : String(error)}${colors.reset}`);
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
    const { task, options } = parseArgs();

    // Check if API key is available
    const apiKey = getApiKey(options);
    if (!apiKey) {
        console.error(
            `${colors.red}Error: OpenAI API key is required.${colors.reset}`,
        );
        console.error(
            `Set it via --api-key option or OPENAI_API_KEY environment variable.`,
        );
        console.error(`\n${colors.yellow}Troubleshooting tips:${colors.reset}`);
        console.error(
            `1. Get an API key from https://platform.openai.com/api-keys`,
        );
        console.error(`2. Export it: export OPENAI_API_KEY="your-key-here"`);
        console.error(
            `3. Or use: diogenes --api-key "your-key-here" "your task"`,
        );
        process.exit(1);
    }

    // Create configuration
    const config = createConfig(options);

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
            console.error(
                `${colors.red}Error: Task required for socratic mode.${colors.reset}`,
            );
            console.error(`Usage: diogenes --socratic "your task here"`);
            process.exit(1);
        } else {
            console.error(
                `${colors.red}Error: No task provided.${colors.reset}`,
            );
            console.error(`Usage: diogenes [options] <task>`);
            console.error(`       diogenes --interactive`);
            console.error(`       diogenes --socratic "task"`);
            process.exit(1);
        }
    }
}

// Run the CLI
if (require.main === module) {
    main().catch((error) => {
        console.error(`${colors.red}Fatal error:${colors.reset}`, error);
        process.exit(1);
    });
}

export { main }; // For testing
