/**
 * Main context manager for Diogenes framework
 */

import { WorkspaceManager } from "./workspace";
import { PromptBuilder } from "./prompt-builder";
import { ToolRegistry } from "../tools";
import { BaseTool } from "../tools/base-tool";
import {
    DiogenesConfig,
    DiogenesState,
    ToolCall,
    ToolResult,
    ToolDefinition,
} from "../types";

export class DiogenesContextManager {
    private config: Required<DiogenesConfig>;
    private workspace: WorkspaceManager;
    private promptBuilder: PromptBuilder;
    private toolRegistry: ToolRegistry;
    private state: DiogenesState;

    constructor(config: DiogenesConfig = {}) {
        this.config = this.mergeWithDefaults(config);
        if (!this.config.security.workspaceRoot) {
            throw new Error("Workspace root cannot be empty");
        }
        this.workspace = new WorkspaceManager(
            this.config.security.workspaceRoot,
        );
        this.promptBuilder = new PromptBuilder(
            this.config.systemPrompt,
            this.config.tokenLimit,
        );
        this.toolRegistry = new ToolRegistry();
        this.state = this.initializeState();
    }

    private mergeWithDefaults(
        config: DiogenesConfig,
    ): Required<DiogenesConfig> {
        const defaultConfig: Required<DiogenesConfig> = {
            systemPrompt: `You are Diogenes, an LLM-controlled agent framework. You have explicit control over your context window through tools.

Core Principles:
1. You decide what to load, unload, and modify in your context
2. All context is explicitly visible to you
3. Monitor context usage via the status section
4. Unload unused content to conserve tokens
5. Use tools to interact with the environment

You have access to tools for:
- Shell command execution
- Directory listing and management
- File loading, editing, and creation
- Search across files
- Todo list management

Always check the context status before making decisions about what to load or unload.`,
            tokenLimit: 128000,
            security: {
                workspaceRoot: process.cwd(),
                allowOutsideWorkspace: false,
                shell: {
                    enabled: true,
                    timeout: 30,
                    blockedCommands: ["rm -rf", "sudo", ":(){:|:&};:"],
                },
                file: {
                    maxFileSize: 1048576, // 1MB
                    blockedExtensions: [".exe", ".bin"],
                },
            },
            tools: [],
        };

        return {
            ...defaultConfig,
            ...config,
            security: {
                ...defaultConfig.security,
                ...config.security,
            },
        };
    }

    private initializeState(): DiogenesState {
        return {
            config: this.config,
            directoryWorkspace: {},
            fileWorkspace: {},
            todoWorkspace: { items: [] },
            contextStatus: {
                tokenUsage: {
                    current: 0,
                    limit: this.config.tokenLimit,
                    percentage: 0,
                },
                directoryWorkspace: {
                    count: 0,
                },
                fileWorkspace: {
                    count: 0,
                    totalLines: 0,
                },
            },
            toolRegistry: new Map(),
        };
    }

    // ==================== Tool Management ====================

    registerTool(tool: BaseTool): void {
        this.toolRegistry.register(tool);
    }

    getToolDefinitions(): string {
        const definitions = this.toolRegistry.getAllDefinitions();

        const parts: string[] = ["AVAILABLE TOOLS:"];

        // Group by namespace
        const byNamespace: Record<string, ToolDefinition[]> = {};
        for (const def of definitions) {
            if (!byNamespace[def.namespace]) {
                byNamespace[def.namespace] = [];
            }
            byNamespace[def.namespace].push(def);
        }

        // Format each namespace
        for (const [namespace, tools] of Object.entries(byNamespace)) {
            parts.push(namespace);

            for (const tool of tools) {
                parts.push(`  ${tool.name}:`);
                parts.push(`    DESCRIPTION: ${tool.description}`);
                parts.push(`    PARAMS:`);

                for (const [paramName, paramDef] of Object.entries(
                    tool.params,
                )) {
                    const optional = paramDef.optional ? " [optional]" : "";
                    parts.push(
                        `      ${paramName}: ${paramDef.type}${optional} - ${paramDef.description}`,
                    );
                }

                parts.push(`    RETURNS:`);
                for (const [returnField, description] of Object.entries(
                    tool.returns,
                )) {
                    parts.push(`      ${returnField}: ${description}`);
                }

                parts.push(""); // Empty line between tools
            }
        }

        // Add tool invocation protocol
        parts.push("TOOL INVOCATION PROTOCOL:");
        parts.push(
            "All tool calls use a unified JSON protocol. Tools are invoked by emitting a JSON array inside the **last** code block labeled `tool-call`.",
        );
        parts.push("");
        parts.push("Example single tool call:");
        parts.push("```tool-call");
        parts.push(
            '[{"tool": "file.load", "params": {"path": "src/main.ts"}}]',
        );
        parts.push("```");
        parts.push("");
        parts.push("Example multiple tool calls:");
        parts.push("```tool-call");
        parts.push(
            '[{"tool": "dir.list", "params": {"path": "src"}}, {"tool": "file.load", "params": {"path": "src/main.ts"}}]',
        );
        parts.push("```");

        return parts.join("\n");
    }

    // ==================== Context Management ====================

    async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
        const results = await this.toolRegistry.executeToolCalls(toolCalls);

        // Update workspace state based on tool results
        this.updateStateFromToolResults(toolCalls, results);

        // Update context status
        this.updateContextStatus();

        return results;
    }

    private updateStateFromToolResults(
        toolCalls: ToolCall[],
        results: ToolResult[],
    ): void {
        for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            const result = results[i];

            if (!result.success) {
                // Stop processing on first error
                break;
            }

            // Handle specific tool updates
            switch (toolCall.tool) {
                case "dir.list":
                    if (result.data?.items) {
                        // Directory is already loaded in workspace manager
                        break;
                    }
                    break;

                case "dir.unload":
                    // Directory is already unloaded in workspace manager
                    break;

                case "file.load":
                    // File is already loaded in workspace manager
                    break;

                case "file.unload":
                    // File is already unloaded in workspace manager
                    break;

                case "todo.set":
                case "todo.update":
                case "todo.append":
                    // Todo is already updated in workspace manager
                    break;

                case "file.edit":
                    // File content is already updated in workspace manager
                    break;

                case "file.create":
                case "file.overwrite":
                case "file.append":
                    // File content is already updated in workspace manager
                    break;
            }
        }
    }

    private updateContextStatus(): void {
        const stats = this.workspace.getStatistics();

        this.state.contextStatus = {
            tokenUsage: {
                current: this.promptBuilder.getCurrentTokens(),
                limit: this.config.tokenLimit,
                percentage: this.promptBuilder.getTokenPercentage(),
            },
            directoryWorkspace: {
                count: stats.directoryCount,
            },
            fileWorkspace: {
                count: stats.fileCount,
                totalLines: stats.totalLines,
            },
        };
    }

    // ==================== Prompt Generation ====================

    buildPrompt(): string {
        const toolDefinitions = this.getToolDefinitions();
        const directoryWorkspace = this.workspace.getDirectoryWorkspace();
        const fileWorkspace = this.workspace.getFileWorkspace();
        const todoWorkspace = this.workspace.getTodoWorkspace();

        const sections = this.promptBuilder.buildContextSections(
            toolDefinitions,
            this.state.contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
        );

        // Update token usage
        this.promptBuilder.updateTokenUsage(sections);

        return this.promptBuilder.assemblePrompt(sections);
    }

    formatToolResult(toolName: string, result: ToolResult): string {
        if (result.success) {
            return `=========TOOL RESULT: ${toolName}\n${JSON.stringify(result.data, null, 2)}\n=========`;
        } else {
            const error = result.error!;
            return `=========TOOL ERROR: ${toolName}\nError: ${error.code}\nMessage: ${error.message}\n${error.details ? JSON.stringify(error.details, null, 2) + "\n" : ""}${error.suggestion ? "Suggestion: " + error.suggestion + "\n" : ""}=========`;
        }
    }

    // ==================== State Accessors ====================

    getWorkspaceManager(): WorkspaceManager {
        return this.workspace;
    }

    getState(): DiogenesState {
        return { ...this.state };
    }

    getConfig(): Required<DiogenesConfig> {
        return { ...this.config };
    }

    // ==================== Utility Methods ====================

    clearWorkspace(): void {
        this.workspace.clearAll();
        this.updateContextStatus();
    }

    setSystemPrompt(prompt: string): void {
        this.config.systemPrompt = prompt;
    }

    setTokenLimit(limit: number): void {
        this.config.tokenLimit = limit;
        this.promptBuilder = new PromptBuilder(this.config.systemPrompt, limit);
        this.updateContextStatus();
    }
}
