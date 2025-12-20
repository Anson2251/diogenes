/**
 * Shell execution tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execAsync = promisify(exec);

interface ShellExecParams {
    command: string;
    cwd?: string;
    timeout?: number;
}

interface SecurityConfig {
    enabled: boolean;
    timeout: number;
    blockedCommands: string[];
}

interface ExecError extends Error {
    code?: string | number;
    stdout?: string;
    stderr?: string;
}

export class ShellExecTool extends BaseTool {
    private workspaceRoot: string;
    private securityConfig: SecurityConfig;

    constructor(
        workspaceRoot: string,
        securityConfig: SecurityConfig,
    ) {
        super({
            namespace: "shell",
            name: "exec",
            description: "Execute a shell command",
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

    async execute(params: unknown): Promise<ToolResult> {
        const validated = this.validateParams(params);
        if (!validated.valid || !validated.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for shell.exec",
                { errors: validated.errors },
                "Check parameter types and values",
            );
        }

        const { command, cwd, timeout } = validated.data as ShellExecParams;

        // Check if shell execution is enabled
        if (!this.securityConfig.enabled) {
            return this.error(
                "SHELL_DISABLED",
                "Shell execution is disabled by security configuration",
                { command },
                "Enable shell execution in security configuration or use alternative methods",
            );
        }

        // Check for blocked commands
        for (const blocked of this.securityConfig.blockedCommands) {
            if (command.includes(blocked)) {
                return this.error(
                    "COMMAND_BLOCKED",
                    `Command contains blocked pattern: ${blocked}`,
                    { command, blocked_pattern: blocked },
                    "Remove the blocked pattern from the command",
                );
            }
        }

        // Determine working directory
        let workingDir = this.workspaceRoot;
        if (cwd) {
            // Resolve relative to workspace root
            workingDir = path.resolve(this.workspaceRoot, cwd);

            // Ensure cwd is within workspace
            if (!workingDir.startsWith(this.workspaceRoot)) {
                return this.error(
                    "PATH_OUTSIDE_WORKSPACE",
                    `Working directory ${workingDir} is outside workspace root ${this.workspaceRoot}`,
                    { cwd, workspace_root: this.workspaceRoot },
                    "Use a working directory within the workspace",
                );
            }
        }

        // Determine timeout
        const execTimeout = timeout || this.securityConfig.timeout;

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
            const execError = error as ExecError;

            // execAsync throws an error on non-zero exit code
            if (execError.code === "ETIMEDOUT") {
                return this.error(
                    "EXECUTION_TIMEOUT",
                    `Command timed out after ${execTimeout} seconds`,
                    { command, timeout: execTimeout },
                    "Use a shorter timeout or optimize the command",
                );
            }

            // Check if it's a command execution error
            if (execError.code !== undefined && execError.stderr !== undefined) {
                return this.success({
                    stdout: execError.stdout || "",
                    stderr: execError.stderr || "",
                    exit_code: execError.code,
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
}
