#!/usr/bin/env node

/**
 * Diogenes CLI - Simple command-line interface for task execution
 */

// Load environment variables from .env file
import { config } from "dotenv";
config();

import { executeTask, DiogenesConfig } from "./index";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "yaml"
import { TRON } from "@tron-format/tron";

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

${colors.bright}Examples:${colors.reset}
  diogenes "List all TypeScript files in src directory"
  diogenes --api-key sk-... "Fix type errors in utils.ts"
  diogenes --base-url https://api.openai.com/v1 "Use custom OpenAI endpoint"
  diogenes --workspace ./my-project "Analyze project structure"
  diogenes --interactive        Start interactive mode

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
    const config: DiogenesConfig = {
        llm: {
            apiKey: getApiKey(options),
            model: options.model || process.env.DIOGENES_MODEL || "gpt-4",
            baseURL: options.baseUrl || process.env.OPENAI_BASE_URL,
        },
    };

    // Load config file if specified
    if (options.config) {
        const fileConfig = loadConfig(options.config);
        Object.assign(config, fileConfig);
    }

    // Set workspace root
    if (options.workspace) {
        config.security = {
            workspaceRoot: path.resolve(options.workspace),
        };
    } else if (process.env.DIOGENES_WORKSPACE) {
        config.security = {
            workspaceRoot: path.resolve(process.env.DIOGENES_WORKSPACE),
        };
    }

    return config;
}

/**
 * Execute a task with progress reporting
 */
async function executeTaskWithProgress(
    taskDescription: string,
    config: DiogenesConfig,
    options: CLIOptions,
): Promise<void> {
    console.log(
        `${colors.cyan}${colors.bright}Task:${colors.reset} ${taskDescription}`,
    );
    console.log(`${colors.dim}Starting execution...${colors.reset}\n`);

    const startTime = Date.now();

    try {
        const result = await executeTask(taskDescription, config, {
            maxIterations: options.maxIterations || 20,
            onIterationStart: (iteration) => {
                console.log(
                    `\n${colors.cyan}${colors.bright}=== Iteration ${iteration} ===${colors.reset}`,
                );
            },
            onIterationComplete: (iteration, response) => {
                console.log(`${colors.green}LLM Response:${colors.reset}`);
                console.log(response);
                console.log();
            },
            onToolCall: (toolCalls) => {
                console.log(
                    `${colors.yellow}${colors.bright}Tool Calls (${toolCalls.length}):${colors.reset}`,
                );
                for (let i = 0; i < toolCalls.length; i++) {
                    const toolCall = toolCalls[i];
                    console.log(
                        `${colors.yellow}[${i + 1}] ${toolCall.tool}:${colors.reset}`,
                    );
                    console.log(TRON.stringify(toolCall.params));
                    console.log();
                }
            },
            onToolResult: (toolName, result) => {
                console.log(
                    `${colors.magenta}${colors.bright}Tool Result: ${toolName}${colors.reset}`,
                );
                if (result.success) {
                    console.log(`${colors.green}Success:${colors.reset}`);
                } else {
                    console.log(`${colors.red}Error:${colors.reset}`);
                    const error = result.error!;
                    console.log(`Code: ${error.code}`);
                    console.log(`Message: ${error.message}`);
                    if (error.details) {
                        console.log(
                            `Details: ${JSON.stringify(error.details, null, 2)}`,
                        );
                    }
                    if (error.suggestion) {
                        console.log(`Suggestion: ${error.suggestion}`);
                    }
                }
                console.log();
            },
            onError: (error) => {
                console.error(
                    `\n${colors.red}Error:${colors.reset} ${error.message}`,
                );

                // Provide additional troubleshooting for common errors
                const errorMsg = error.message.toLowerCase();
                if (
                    errorMsg.includes("network") ||
                    errorMsg.includes("fetch") ||
                    errorMsg.includes("failed")
                ) {
                    console.error(
                        `\n${colors.yellow}Network troubleshooting:${colors.reset}`,
                    );
                    console.error(`1. Check your internet connection`);
                    console.error(
                        `2. Verify the API endpoint: ${config.llm?.baseURL || "https://api.openai.com/v1"}`,
                    );
                    console.error(
                        `3. If behind a proxy, set HTTP_PROXY/HTTPS_PROXY environment variables`,
                    );
                    console.error(
                        `4. For self-signed certificates, try: NODE_TLS_REJECT_UNAUTHORIZED=0 diogenes ...`,
                    );
                } else if (
                    errorMsg.includes("api key") ||
                    errorMsg.includes("authentication") ||
                    errorMsg.includes("invalid")
                ) {
                    console.error(
                        `\n${colors.yellow}API key troubleshooting:${colors.reset}`,
                    );
                    console.error(`1. Verify your API key is correct`);
                    console.error(
                        `2. Check if the key has sufficient permissions/quota`,
                    );
                    console.error(
                        `3. Generate a new key at https://platform.openai.com/api-keys`,
                    );
                }
            },
        });

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        if (!options.verbose) {
            process.stdout.write("\n");
        }

        console.log();

        if (result.success) {
            console.log(
                `${colors.green}${colors.bright}✓ Task completed successfully!${colors.reset}`,
            );
            console.log(
                `${colors.dim}Iterations: ${result.iterations}, Time: ${elapsedTime}s${colors.reset}`,
            );

            if (result.result) {
                console.log(`\n${colors.bright}Result:${colors.reset}`);
                console.log(result.result);
            }
        } else {
            console.log(
                `${colors.red}${colors.bright}✗ Task failed${colors.reset}`,
            );
            console.log(
                `${colors.dim}Iterations: ${result.iterations}, Time: ${elapsedTime}s${colors.reset}`,
            );

            if (result.error) {
                console.log(
                    `\n${colors.bright}Error:${colors.reset} ${result.error}`,
                );
            }
        }
    } catch (error) {
        console.error(
            `\n${colors.red}${colors.bright}Fatal error:${colors.reset}`,
            error,
        );
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
        await executeTaskWithProgress(task, config, options);
    } else {
        // Check if interactive mode was explicitly requested
        const args = process.argv.slice(2);
        if (args.includes("--interactive")) {
            await interactiveMode(config, options);
        } else {
            console.error(
                `${colors.red}Error: No task provided.${colors.reset}`,
            );
            console.error(`Usage: diogenes [options] <task>`);
            console.error(`       diogenes --interactive`);
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
