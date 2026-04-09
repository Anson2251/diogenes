/**
 * Shell execution tool
 */

import { exec } from "child_process";
import * as path from "path";
import { promisify } from "util";
import { z } from "zod";

import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const execAsync = promisify(exec);

const shellExecSchema = z.object({
    command: z.string(),
    cwd: z.string().optional(),
    timeout: z.number().optional(),
});

type ShellExecParams = z.infer<typeof shellExecSchema>;

interface SecurityConfig {
    enabled?: boolean;
    timeout?: number;
    blockedCommands?: string[];
}

export class ShellExecTool extends BaseTool<typeof shellExecSchema> {
    protected schema = shellExecSchema;
    private workspaceRoot: string;
    private securityConfig: SecurityConfig;

    constructor(workspaceRoot: string, securityConfig: SecurityConfig) {
        super({
            namespace: "shell",
            name: "exec",
            description: `Execute a shell command.

Use this only when shell execution is the most direct way to advance the task.
- Prefer narrow, deterministic commands over broad exploratory ones
- Set cwd when needed instead of relying on shell-side directory changes
- Do not use this tool for demos or capability showcases`,
            params: {
                command: { type: "string", description: "Command to execute" },
                cwd: {
                    type: "string",
                    optional: true,
                    description: "Working directory",
                },
                timeout: {
                    type: "number",
                    optional: true,
                    description: "Timeout in seconds (default: 30)",
                },
            },
            returns: {
                stdout: "Command stdout",
                stderr: "Command stderr",
                exit_code: "Command exit code",
            },
        });
        this.workspaceRoot = workspaceRoot;
        this.securityConfig = securityConfig;
    }

    async run(params: ShellExecParams): Promise<ToolResult> {
        const { command, cwd, timeout } = params;

        // Check if shell execution is enabled
        if (!(this.securityConfig.enabled ?? true)) {
            return this.error(
                "SHELL_DISABLED",
                "Shell execution is disabled by security configuration",
                { command },
                "Enable shell execution in security configuration or use alternative methods",
            );
        }

        // Check for blocked commands using tokenization to bypass evasion attempts
        const tokens = this.tokenizeCommand(command);
        for (const blocked of this.securityConfig.blockedCommands ?? []) {
            // Check original command for direct matches (catches obvious attempts)
            if (command.includes(blocked)) {
                return this.error(
                    "COMMAND_BLOCKED",
                    `Command contains blocked pattern: ${blocked}`,
                    { command, blocked_pattern: blocked },
                    "Remove the blocked pattern from the command",
                );
            }
            // Check normalized tokens (removes escape characters)
            for (const token of tokens) {
                const normalizedToken = token.replace(/\\/g, ""); // Remove escape characters
                if (normalizedToken === blocked || normalizedToken.startsWith(blocked + " ")) {
                    return this.error(
                        "COMMAND_BLOCKED",
                        `Command contains blocked pattern: ${blocked}`,
                        { command, blocked_pattern: blocked },
                        "Remove the blocked pattern from the command",
                    );
                }
            }
        }

        // Determine working directory
        let workingDir = this.workspaceRoot;
        if (cwd) {
            // Resolve relative to workspace root
            workingDir = path.resolve(this.workspaceRoot, cwd);
            // Ensure cwd is within workspace using path.relative for security
            const relative = path.relative(this.workspaceRoot, workingDir);
            if (relative.startsWith("..") || relative === "..") {
                return this.error(
                    "PATH_OUTSIDE_WORKSPACE",
                    `Working directory ${workingDir} is outside workspace root ${this.workspaceRoot}`,
                    { cwd, workspace_root: this.workspaceRoot },
                    "Use a working directory within the workspace",
                );
            }
        }

        // Determine timeout
        const execTimeout = timeout || this.securityConfig.timeout || 30;

        try {
            const { stdout, stderr } = await execAsync(command, {
                cwd: workingDir,
                timeout: execTimeout * 1000, // Convert to milliseconds
                maxBuffer: 1024 * 1024, // 1MB output limit
            });

            return this.success({
                stdout: stdout || "",
                stderr: stderr || "",
                exit_code: 0, // execAsync doesn't provide exit code on success
            });
        } catch (error) {
            const execError = error instanceof Error ? error : new Error(String(error));
            const execCode = "code" in execError ? execError.code : undefined;
            const execStdout = "stdout" in execError ? execError.stdout : undefined;
            const execStderr = "stderr" in execError ? execError.stderr : undefined;

            // execAsync throws an error on non-zero exit code
            if (execCode === "ETIMEDOUT") {
                return this.error(
                    "EXECUTION_TIMEOUT",
                    `Command timed out after ${execTimeout} seconds`,
                    { command, timeout: execTimeout },
                    "Use a shorter timeout or optimize the command",
                );
            }

            // Check if it's a command execution error
            if (execCode !== undefined && execStderr !== undefined) {
                return this.success({
                    stdout: typeof execStdout === "string" ? execStdout : "",
                    stderr: typeof execStderr === "string" ? execStderr : "",
                    exit_code: execCode,
                });
            }

            // Other errors
            return this.error(
                "EXECUTION_ERROR",
                `Failed to execute command: ${execError.message}`,
                { command, error: execError.message },
                "Check command syntax and permissions",
            );
        }
    }

    /**
     * Tokenize a command string into individual command components.
     * This helps with detecting blocked commands even when they're
     * obfuscated with escape characters or shell tricks.
     */
    private tokenizeCommand(command: string): string[] {
        const tokens: string[] = [];

        let current = "";
        let escaped = false;

        for (let i = 0; i < command.length; i++) {
            const char = command[i];

            if (escaped) {
                current += char;
                escaped = false;
                continue;
            }

            if (char === "\\") {
                escaped = true;
                current += char;
                continue;
            }

            if (char === " " || char === "\t") {
                if (current) {
                    tokens.push(current);
                    current = "";
                }
                continue;
            }

            // Start of a quoted string
            if (char === '"' || char === "'" || char === "`") {
                if (current) {
                    tokens.push(current);
                    current = "";
                }
                const quote = char;
                i++; // skip opening quote
                let quoted = "";
                while (i < command.length && command[i] !== quote) {
                    if (command[i] === "\\" && i + 1 < command.length) {
                        quoted += command[i + 1];
                        i += 2;
                    } else {
                        quoted += command[i];
                        i++;
                    }
                }
                tokens.push(quoted);
                continue;
            }

            current += char;
        }

        if (current) {
            tokens.push(current);
        }

        return tokens;
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data) {
            const stdout = typeof result.data.stdout === "string" ? result.data.stdout : "";
            const stderr = typeof result.data.stderr === "string" ? result.data.stderr : "";
            const exitCodeRaw =
                typeof result.data.exit_code === "number"
                    ? result.data.exit_code
                    : typeof result.data.exit_code === "string"
                      ? Number(result.data.exit_code)
                      : 0;
            const exitCodeNum = exitCodeRaw;
            const parts: string[] = [];
            if (exitCodeNum !== 0) {
                parts.push(`\x1b[31mexit: ${exitCodeNum}\x1b[0m`);
            }
            if (stdout) {
                parts.push(stdout.trim());
            }
            if (stderr) {
                parts.push(`\x1b[33m${stderr.trim()}\x1b[0m`);
            }
            return parts.length > 0 ? parts.join("\n") : "\x1b[32m✓\x1b[0m";
        }
        return undefined;
    }
}
