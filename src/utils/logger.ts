/**
 * Logging abstraction layer with TUI-style display support
 * 
 * Provides clean separation between logging and presentation,
 * supporting both traditional logging and TUI-style progress display.
 */

import { StreamChunk } from "../llm/openai-client";

export enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3,
    SILENT = 4,
}

/**
 * Tool call data for TUI display
 */
export interface ToolCallData {
    tool: string;
    params: Record<string, any>;
}

/**
 * Tool result data for TUI display
 */
export interface ToolResultData {
    success: boolean;
    error?: {
        code: string;
        message: string;
        details?: Record<string, any>;
        suggestion?: string;
    };
    data?: any;
    /**
     * Custom formatted output from the tool's formatResult() method.
     * If provided, this should be used instead of default formatting.
     */
    formattedOutput?: string;
}

/**
 * Task completion data for TUI display
 */
export interface TaskCompletionData {
    success: boolean;
    result?: string;
    error?: string;
    iterations: number;
    taskEnded: boolean;
}

/**
 * Base logger interface - traditional logging
 */
export interface Logger {
    // Log level control
    setLogLevel(level: LogLevel): void;
    getLogLevel(): LogLevel;

    // Traditional logging methods
    debug(message: string, ...args: any[]): void;
    info(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
    error(message: string, ...args: any[]): void;

    // TUI-style progress methods
    iterationStart(iteration: number): void;
    iterationComplete(iteration: number, response: string): void;
    toolCalls(toolCalls: ToolCallData[]): void;
    toolResult(toolName: string, result: ToolResultData): void;
    taskStarted(taskDescription: string): void;
    taskCompleted(data: TaskCompletionData, elapsedTimeMs: number): void;
    taskError(error: Error): void;

    // Interactive mode
    interactiveMessage(message: string): void;
    interactivePrompt(prompt: string): void;

    // Streaming methods
    streamStart(): void;
    streamChunk(chunk: StreamChunk): void;
    streamEnd(): void;
}

/**
 * ANSI color codes for terminal output
 */
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
    white: "\x1b[37m",
};

/**
 * TUI-style console logger with ANSI colors
 */
export class TUILogger implements Logger {
    private logLevel: LogLevel = LogLevel.INFO;

    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    getLogLevel(): LogLevel {
        return this.logLevel;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    debug(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.log(`${colors.dim}${message}${colors.reset}`, ...args);
        }
    }

    info(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(message, ...args);
        }
    }

    warn(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(`${colors.yellow}Warning: ${message}${colors.reset}`, ...args);
        }
    }

    error(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(`${colors.red}${colors.bright}Error:${colors.reset} ${message}`, ...args);
        }
    }

    iterationStart(iteration: number): void {
        console.log(
            `\n${colors.cyan}${colors.bright}=== Iteration ${iteration} ===${colors.reset}`
        );
    }

    iterationComplete(iteration: number, response: string): void {
        console.log(`${colors.green}LLM Response:${colors.reset}`);
        console.log(response);
        console.log();
    }

    toolCalls(toolCalls: ToolCallData[]): void {
        const { TRON } = require('@tron-format/tron');
        console.log(
            `${colors.yellow}${colors.bright}Tool Calls (${toolCalls.length}):${colors.reset}`
        );
        for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            console.log(
                `${colors.yellow}[${i + 1}] ${toolCall.tool}:${colors.reset}`
            );
            console.log(TRON.stringify(toolCall.params));
            console.log();
        }
    }

    toolResult(toolName: string, result: ToolResultData): void {
        // Use custom formatted output if available from the tool
        if (result.formattedOutput !== undefined) {
            console.log(result.formattedOutput);
            return;
        }

        if (result.success) {
            // For task.end, print the summary
            if (toolName === "task.end" && result.data?.summary) {
                console.log(
                    `${colors.magenta}${colors.bright}Task completed: ${toolName}${colors.reset}`
                );
                console.log(`${colors.bright}Summary:${colors.reset} ${result.data.summary}`);
                console.log();
                return;
            }

            // Check if there's meaningful data beyond just "success: true"
            const hasMeaningfulData = result.data &&
                Object.keys(result.data).length > 0 &&
                !(Object.keys(result.data).length === 1 && result.data.success === true);

            if (hasMeaningfulData) {
                console.log(
                    `${colors.magenta}${colors.bright}Tool Result: ${toolName}${colors.reset}`
                );
                console.log(`${colors.green}Success:${colors.reset}`);
                console.log(result.data);
                console.log();
            } else {
                // Concise output for simple success
                console.log(`${colors.green}Tool ${toolName} success${colors.reset}`);
            }
        } else {
            console.log(
                `${colors.magenta}${colors.bright}Tool Result: ${toolName}${colors.reset}`
            );
            console.log(`${colors.red}Error:${colors.reset}`);
            const error = result.error!;
            console.log(`Code: ${error.code}`);
            console.log(`Message: ${error.message}`);
            if (error.details) {
                console.log(
                    `Details: ${JSON.stringify(error.details, null, 2)}`
                );
            }
            if (error.suggestion) {
                console.log(`Suggestion: ${error.suggestion}`);
            }
            console.log();
        }
    }

    taskStarted(taskDescription: string): void {
        console.log(
            `${colors.cyan}${colors.bright}Task:${colors.reset} ${taskDescription}`
        );
        console.log(`${colors.dim}Starting execution...${colors.reset}\n`);
    }

    taskCompleted(data: TaskCompletionData, elapsedTimeMs: number): void {
        const elapsedTime = (elapsedTimeMs / 1000).toFixed(2);

        console.log();

        if (data.success) {
            console.log(
                `${colors.green}${colors.bright}✓ Task completed successfully!${colors.reset}`
            );
            console.log(
                `${colors.dim}Iterations: ${data.iterations}, Time: ${elapsedTime}s${colors.reset}`
            );

            if (data.result) {
                console.log(`\n${colors.bright}Result:${colors.reset}`);
                console.log(data.result);
            }
        } else {
            console.log(
                `${colors.red}${colors.bright}✗ Task failed${colors.reset}`
            );
            console.log(
                `${colors.dim}Iterations: ${data.iterations}, Time: ${elapsedTime}s${colors.reset}`
            );

            if (data.error) {
                console.log(
                    `\n${colors.bright}Error:${colors.reset} ${data.error}`
                );
            }
        }
    }

    taskError(error: Error): void {
        console.error(
            `\n${colors.red}${colors.bright}Fatal error:${colors.reset}`,
            error
        );
    }

    interactiveMessage(message: string): void {
        console.log(message);
    }

    interactivePrompt(prompt: string): void {
        process.stdout.write(prompt);
    }

    streamStart(): void {
        process.stdout.write(`${colors.green}LLM Response:${colors.reset}\n`);
    }

    streamChunk(chunk: StreamChunk): void {
        if (chunk.type === "reasoning") {
            process.stdout.write(`${colors.dim}${chunk.content}${colors.reset}`);
        } else {
            process.stdout.write(chunk.content);
        }
    }

    streamEnd(): void {
        console.log("\n");
    }
}

/**
 * Silent logger for testing or quiet mode
 */
export class NullLogger implements Logger {
    setLogLevel(): void {}
    getLogLevel(): LogLevel {
        return LogLevel.SILENT;
    }
    debug(): void {}
    info(): void {}
    warn(): void {}
    error(): void {}
    iterationStart(): void {}
    iterationComplete(): void {}
    toolCalls(): void {}
    toolResult(): void {}
    taskStarted(): void {}
    taskCompleted(): void {}
    taskError(): void {}
    interactiveMessage(): void {}
    interactivePrompt(): void {}
    streamStart(): void {}
    streamChunk(): void {}
    streamEnd(): void {}
}

/**
 * Simple console logger without TUI styling
 */
export class ConsoleLogger implements Logger {
    private logLevel: LogLevel = LogLevel.INFO;

    setLogLevel(level: LogLevel): void {
        this.logLevel = level;
    }

    getLogLevel(): LogLevel {
        return this.logLevel;
    }

    private shouldLog(level: LogLevel): boolean {
        return level >= this.logLevel;
    }

    debug(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.DEBUG)) {
            console.log(`[DEBUG] ${message}`, ...args);
        }
    }

    info(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.INFO)) {
            console.log(message, ...args);
        }
    }

    warn(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.WARN)) {
            console.warn(`[WARN] ${message}`, ...args);
        }
    }

    error(message: string, ...args: any[]): void {
        if (this.shouldLog(LogLevel.ERROR)) {
            console.error(`[ERROR] ${message}`, ...args);
        }
    }

    iterationStart(iteration: number): void {
        this.info(`=== Iteration ${iteration} ===`);
    }

    iterationComplete(iteration: number, response: string): void {
        this.info(`Iteration ${iteration} response: ${response.substring(0, 100)}...`);
    }

    toolCalls(toolCalls: ToolCallData[]): void {
        this.info(`Executing ${toolCalls.length} tool call(s)`);
    }

    toolResult(toolName: string, result: ToolResultData): void {
        // Use custom formatted output if available from the tool
        if (result.formattedOutput !== undefined) {
            this.info(result.formattedOutput);
            return;
        }

        if (result.success) {
            // For task.end, print the summary at INFO level
            if (toolName === "task.end" && result.data?.summary) {
                this.info(`Task completed: ${result.data.summary}`);
                return;
            }

            // Check if there's meaningful data beyond just "success: true"
            const hasMeaningfulData = result.data &&
                Object.keys(result.data).length > 0 &&
                !(Object.keys(result.data).length === 1 && result.data.success === true);

            if (hasMeaningfulData) {
                this.info(`Tool ${toolName} success: ${JSON.stringify(result.data)}`);
            } else {
                this.info(`Tool ${toolName} success`);
            }
        } else {
            this.error(`Tool ${toolName} failed: ${result.error?.message}`);
        }
    }

    taskStarted(taskDescription: string): void {
        this.info(`Task: ${taskDescription}`);
    }

    taskCompleted(data: TaskCompletionData, elapsedTimeMs: number): void {
        const elapsedTime = (elapsedTimeMs / 1000).toFixed(2);
        if (data.success) {
            this.info(`Task completed in ${elapsedTime}s (${data.iterations} iterations)`);
            if (data.result) {
                this.info(`Result: ${data.result}`);
            }
        } else {
            this.error(`Task failed in ${elapsedTime}s: ${data.error || 'Unknown error'}`);
        }
    }

    taskError(error: Error): void {
        this.error(`Fatal error: ${error.message}`);
    }

    interactiveMessage(message: string): void {
        this.info(message);
    }

    interactivePrompt(prompt: string): void {
        process.stdout.write(prompt);
    }

    streamStart(): void {
        this.info("LLM Response:");
    }

    streamChunk(chunk: StreamChunk): void {
        process.stdout.write(chunk.content);
    }

    streamEnd(): void {
        console.log("\n");
    }
}
