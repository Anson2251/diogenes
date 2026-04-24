/**
 * Main context manager for Diogenes framework
 */

import { z } from "zod";

import type { StreamChunk, LLMClient } from "../llm/anthropic-client";

import {
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_SECURITY_CONFIG,
    DEFAULT_LOGGER_CONFIG,
    DEFAULT_TOKEN_LIMIT,
    getContextWindowForModel,
} from "../config/default-prompts";
import { AnthropicClient } from "../llm/anthropic-client";
import { OpenAIClient } from "../llm/openai-client";
import { ToolRegistry } from "../tools";
import { BaseTool } from "../tools/base-tool";
import {
    DiogenesConfig,
    DiogenesState,
    ToolCall,
    ToolResult,
    ToolDefinition,
    LLMConfig,
} from "../types";
import { parseToolCalls, formatToolResults } from "../utils/tool-parser";
import { PromptBuilder } from "./prompt-builder";
import { WorkspaceManager } from "./workspace";

export class DiogenesContextManager {
    private config: Required<DiogenesConfig>;
    private workspace: WorkspaceManager;
    private promptBuilder: PromptBuilder;
    private toolRegistry: ToolRegistry;
    private state: DiogenesState;
    private llmClient: LLMClient | null = null;
    private task: string = "";

    constructor(config: DiogenesConfig = {}) {
        this.config = this.mergeWithDefaults(config);
        if (!this.config.security.workspaceRoot) {
            throw new Error("Workspace root cannot be empty");
        }
        this.workspace = new WorkspaceManager(this.config.security.workspaceRoot, {
            enabled: this.config.security.watch?.enabled ?? DEFAULT_SECURITY_CONFIG.watch.enabled,
            debounceMs:
                this.config.security.watch?.debounceMs ?? DEFAULT_SECURITY_CONFIG.watch.debounceMs,
        });
        this.promptBuilder = new PromptBuilder(this.config.systemPrompt, this.config.tokenLimit);
        this.toolRegistry = new ToolRegistry();
        this.state = this.initializeState();

        // Initialize LLM client if API key is provided
        if (this.config.llm.apiKey) {
            this.llmClient = this.createLLMClient(this.config.llm);
        }
    }

    private createLLMClient(llmConfig: Partial<LLMConfig>): LLMClient {
        if (!llmConfig.apiKey) {
            throw new Error("API key is required");
        }

        const providerStyle = llmConfig.providerStyle || "openai";

        const config = {
            apiKey: llmConfig.apiKey,
            baseURL: llmConfig.baseURL,
            model: llmConfig.model,
            timeout: llmConfig.timeout,
        };

        if (providerStyle === "anthropic") {
            return new AnthropicClient(config);
        }

        return new OpenAIClient(config);
    }
    private mergeWithDefaults(config: DiogenesConfig): Required<DiogenesConfig> {
        const model = config.llm?.model;
        const modelContextWindow = getContextWindowForModel(model);
        const tokenLimit = config.tokenLimit || modelContextWindow || DEFAULT_TOKEN_LIMIT;

        const llmConfig: LLMConfig = {
            ...config.llm,
        };

        return {
            systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            tokenLimit,
            security: {
                ...DEFAULT_SECURITY_CONFIG,
                ...config.security,
                watch: {
                    ...DEFAULT_SECURITY_CONFIG.watch,
                    ...config.security?.watch,
                },
                interaction: {
                    ...DEFAULT_SECURITY_CONFIG.interaction,
                    ...config.security?.interaction,
                },
                shell: {
                    ...DEFAULT_SECURITY_CONFIG.shell,
                    ...config.security?.shell,
                },
                file: {
                    ...DEFAULT_SECURITY_CONFIG.file,
                    ...config.security?.file,
                },
                snapshot: {
                    ...DEFAULT_SECURITY_CONFIG.snapshot,
                    ...config.security?.snapshot,
                },
                workspaceRoot:
                    config.security?.workspaceRoot || DEFAULT_SECURITY_CONFIG.workspaceRoot,
            },
            tools: config.tools || [],
            llm: llmConfig,
            logger: {
                ...DEFAULT_LOGGER_CONFIG,
                ...config.logger,
            },
            interactionHandlers: {
                ...config.interactionHandlers,
            },
        };
    }

    private initializeState(): DiogenesState {
        return {
            config: this.config,
            directoryWorkspace: {},
            fileWorkspace: {},
            todoWorkspace: { items: [] },
            notepadWorkspace: { lines: [] },
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
                notepadWorkspace: {
                    lines: 0,
                },
            },
            toolRegistry: new Map(),
            toolResults: [],
        };
    }

    // ==================== Tool Management ====================

    registerTool(tool: BaseTool<z.ZodType>): void {
        this.toolRegistry.register(tool);
    }

    getTaskPrompt(): string {
        return `## Task\n${this.task}\n--`;
    }

    getTool(name: string): BaseTool<z.ZodType> | undefined {
        return this.toolRegistry.getTool(name);
    }

    getToolDefinitions(): string {
        const definitions = this.toolRegistry.getAllDefinitions();

        const byNamespace: Record<string, ToolDefinition[]> = {};
        for (const def of definitions) {
            if (!byNamespace[def.namespace]) {
                byNamespace[def.namespace] = [];
            }
            byNamespace[def.namespace].push(def);
        }

        const parts: string[] = [];

        for (const [namespace, tools] of Object.entries(byNamespace)) {
            parts.push(`\n## NAMESPACE: ${namespace}\n`);

            for (const tool of tools) {
                const paramSignatures: string[] = [];
                for (const [paramName, paramDef] of Object.entries(tool.params)) {
                    const optionalMark = paramDef.optional ? '?' : '';
                    paramSignatures.push(`${paramName}${optionalMark}`);
                }
                const signature = `${namespace}.${tool.name}(${paramSignatures.join(', ')})`;

                parts.push(`### ${signature}`);
                parts.push(`${tool.description}\n`);

                const requiredParams: string[] = [];
                const optionalParams: string[] = [];
                for (const [paramName, paramDef] of Object.entries(tool.params)) {
                    if (paramDef.optional) {
                        optionalParams.push(paramName);
                    } else {
                        requiredParams.push(paramName);
                    }
                }

                if (requiredParams.length) {
                    parts.push(`- **Required:** ${requiredParams.join(', ')}`);
                }
                if (optionalParams.length) {
                    parts.push(`- **Optional:** ${optionalParams.join(', ')}`);
                }
                parts.push('');
            }
        }

        return parts.join('\n');
    }

    // ==================== Context Management ====================

    async executeToolCalls(
        toolCalls: ToolCall[],
        options: {
            shouldCancel?: () => boolean;
            onToolStart?: (toolCall: ToolCall, index: number) => void;
            onToolComplete?: (toolCall: ToolCall, result: ToolResult, index: number) => void;
        } = {},
    ): Promise<ToolResult[]> {
        const results: ToolResult[] = [];
        let contextWarning: string | null = null;

        for (let i = 0; i < toolCalls.length; i++) {
            if (options.shouldCancel?.()) {
                break;
            }

            const toolCall = toolCalls[i];
            options.onToolStart?.(toolCall, i);
            const result = await this.toolRegistry.executeToolCall(toolCall);
            results.push(result);
            options.onToolComplete?.(toolCall, result, i);

            if (result.success) {
                this.updateStateFromSingleToolResult(toolCall, result);
            }

            const percentage = this.estimateContextUsage();

            if (percentage > 75 && i < toolCalls.length - 1) {
                contextWarning = `Context usage at ${percentage.toFixed(1)}%. Remaining ${toolCalls.length - i - 1} tool(s) not executed.`;
                break;
            }
        }

        this.updateContextStatus();

        if (contextWarning) {
            const lastResult = results[results.length - 1];
            if (lastResult.success && lastResult.data) {
                lastResult.data._contextWarning = contextWarning;
            } else {
                results.push({
                    success: true,
                    data: { _contextWarning: contextWarning, _skipped: true },
                });
            }
        }

        return results;
    }

    private updateStateFromSingleToolResult(toolCall: ToolCall, result: ToolResult): void {
        if (!result.success) return;

        switch (toolCall.tool) {
            case "dir.list":
            case "dir.unload":
            case "file.load":
            case "file.unload":
            case "file.edit":
            case "file.create":
            case "file.overwrite":
            case "todo.set":
            case "todo.update":
            case "task.ask":
            case "task.choose":
            case "task.notepad":
                break;
        }
    }

    private estimateContextUsage(): number {
        const stats = this.workspace.getStatistics();
        const estimatedTokens =
            this.promptBuilder.getCurrentTokens() +
            stats.totalLines * 10 +
            this.state.toolResults.length * 100;
        return (estimatedTokens / this.config.tokenLimit) * 100;
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
            notepadWorkspace: {
                lines: this.workspace.getNotepadWorkspace().lines.length,
            },
        };
    }

    // ==================== Prompt Generation ====================

    buildPrompt(): string {
        const toolDefinitions = this.getToolDefinitions();
        const directoryWorkspace = this.workspace.getDirectoryWorkspace();
        const fileWorkspace = this.workspace.getFileWorkspace();
        const todoWorkspace = this.workspace.getTodoWorkspace();
        const notepadWorkspace = this.workspace.getNotepadWorkspace();

        const sections = this.promptBuilder.buildContextSections(
            toolDefinitions,
            this.getTaskPrompt(),
            this.state.contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
            notepadWorkspace,
            this.state.toolResults,
        );

        // Update token usage
        this.promptBuilder.updateTokenUsage(sections);

        return this.promptBuilder.assemblePrompt(sections);
    }

    /**
     * Get the system prompt separately from the context
     * Use this when you want to send system prompt as a separate system message
     */
    getSystemPrompt(): string {
        return this.promptBuilder.getSystemPrompt();
    }

    /**
     * Build just the context sections (tools, status, workspaces) without system prompt or task
     * Use this when sending system prompt separately and task as user message
     */
    buildContextOnly(): string {
        const toolDefinitions = this.getToolDefinitions();
        const directoryWorkspace = this.workspace.getDirectoryWorkspace();
        const fileWorkspace = this.workspace.getFileWorkspace();
        const todoWorkspace = this.workspace.getTodoWorkspace();
        const notepadWorkspace = this.workspace.getNotepadWorkspace();

        const sections = this.promptBuilder.buildContextSections(
            toolDefinitions,
            this.getTaskPrompt(),
            this.state.contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
            notepadWorkspace,
            this.state.toolResults,
        );

        return this.promptBuilder.assembleContextSections(sections);
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

    setTask(task: string): void {
        this.task = task;
    }

    setTokenLimit(limit: number): void {
        this.config.tokenLimit = limit;
        this.promptBuilder = new PromptBuilder(this.config.systemPrompt, limit);
        this.updateContextStatus();
    }

    // ==================== LLM Interaction Methods ====================

    /**
     * Set LLM API configuration
     */
    setLLMConfig(config: Partial<DiogenesConfig["llm"]>): void {
        this.config.llm = {
            ...this.config.llm,
            ...config,
        };

        // Reinitialize LLM client if API key is provided
        if (this.config.llm.apiKey) {
            this.llmClient = this.createLLMClient(this.config.llm);
        } else {
            this.llmClient = null;
        }
    }

    /**
     * Get LLM configuration
     */
    getLLMConfig(): LLMConfig {
        const llm = this.config.llm;
        return {
            apiKey: llm.apiKey ?? "",
            baseURL: llm.baseURL,
            model: llm.model,
            timeout: llm.timeout,
            temperature: llm.temperature,
            maxTokens: llm.maxTokens,
            provider: llm.provider,
            providerStyle: llm.providerStyle,
            supportsToolRole: llm.supportsToolRole,
        };
    }

    /**
     * Check if LLM client is available
     */
    hasLLMClient(): boolean {
        return this.llmClient !== null;
    }

    /**
     * Get the LLM client instance
     */
    getLLMClient(): LLMClient | null {
        return this.llmClient;
    }

    /**
     * Execute a complete LLM interaction cycle:
     * 1. Build prompt from current context
     * 2. Call LLM API (with optional streaming)
     * 3. Parse tool calls from response
     * 4. Execute tool calls
     * 5. Format results and update context
     *
     * Returns the LLM response text
     */
    async runLLMCycle(onStreamChunk?: (chunk: StreamChunk) => void): Promise<string> {
        if (!this.llmClient) {
            throw new Error("LLM client not configured. Please set LLM API key.");
        }

        const prompt = this.buildPrompt();

        const messages = [
            {
                role: "user" as const,
                content: prompt,
            },
        ];

        const result = await this.llmClient.createChatCompletionStream(
            messages,
            onStreamChunk || (() => {}),
            {
                temperature: this.config.llm.temperature,
                max_tokens: this.config.llm.maxTokens,
            },
        );
        // Reasoning is kept separate - only use content for the assistant message
        const response = result.content;

        const parseResult = parseToolCalls(response);

        if (!parseResult.success) {
            this.state.toolResults.push(
                `## Parse Error\n${parseResult.error?.message}\nSuggestion: ${parseResult.error?.suggestion}\n--`,
            );
            return response;
        }

        const toolCalls = parseResult.toolCalls!;

        if (toolCalls.length > 0) {
            const results = await this.executeToolCalls(toolCalls);

            const formattedResults = formatToolResults(
                toolCalls,
                results,
                (toolCall: ToolCall, result: ToolResult): string => {
                    const tool: BaseTool<z.ZodType> | undefined = this.getTool(toolCall.tool);
                    return (
                        tool?.formatResultForLLM(toolCall, result) ??
                        JSON.stringify(result, null, 2)
                    );
                },
            );
            this.state.toolResults.push(formattedResults);

            if (this.state.toolResults.length > 10) {
                this.state.toolResults = this.state.toolResults.slice(-10);
            }
        }

        return response;
    }
}
