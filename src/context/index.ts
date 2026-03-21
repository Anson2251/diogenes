/**
 * Main context manager for Diogenes framework
 */

import { WorkspaceManager } from "./workspace";
import { PromptBuilder } from "./prompt-builder";
import { ToolRegistry } from "../tools";
import { BaseTool } from "../tools/base-tool";
import { OpenAIClient, StreamChunk } from "../llm/openai-client";
import { TRON } from '@tron-format/tron';
import {
    DiogenesConfig,
    DiogenesState,
    ToolCall,
    ToolResult,
    ToolDefinition,
    LLMConfig,
} from "../types";
import { parseToolCalls, formatToolResults } from "../utils/tool-parser";
import {
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_SECURITY_CONFIG,
    DEFAULT_LLM_CONFIG,
    DEFAULT_LOGGER_CONFIG,
    DEFAULT_TOKEN_LIMIT,
    getContextWindowForModel,
} from "../config/default-prompts";

export class DiogenesContextManager {
    private config: Required<DiogenesConfig>;
    private workspace: WorkspaceManager;
    private promptBuilder: PromptBuilder;
    private toolRegistry: ToolRegistry;
    private state: DiogenesState;
    private llmClient: OpenAIClient | null = null;
    private task: string = ""

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

        // Initialize LLM client if API key is provided
        if (this.config.llm.apiKey) {
            this.llmClient = new OpenAIClient({
                apiKey: this.config.llm.apiKey,
                baseURL: this.config.llm.baseURL,
                model: this.config.llm.model,
                timeout: this.config.llm.timeout,
            });
        }
    }

    private mergeWithDefaults(
        config: DiogenesConfig,
    ): Required<DiogenesConfig> {
        const model = config.llm?.model || DEFAULT_LLM_CONFIG.model;
        const modelContextWindow = getContextWindowForModel(model);
        const tokenLimit = config.tokenLimit || modelContextWindow || DEFAULT_TOKEN_LIMIT;
        
        return {
            systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
            tokenLimit,
            security: {
                ...DEFAULT_SECURITY_CONFIG,
                ...config.security,
                workspaceRoot: config.security?.workspaceRoot || DEFAULT_SECURITY_CONFIG.workspaceRoot,
            },
            tools: config.tools || [],
            llm: {
                ...DEFAULT_LLM_CONFIG,
                ...config.llm,
            },
            logger: {
                ...DEFAULT_LOGGER_CONFIG,
                ...config.logger,
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
            toolResults: [],
        };
    }

    // ==================== Tool Management ====================

    registerTool(tool: BaseTool): void {
        this.toolRegistry.register(tool);
    }

    getTaskPrompt(): string {
        return `========= TASK\n${this.task}\n=========`
    }

    getTool(name: string): BaseTool | undefined {
        return this.toolRegistry.getTool(name);
    }

    getToolDefinitions(): string {
        const definitions = this.toolRegistry.getAllDefinitions();

        const parts: string[] = [];

        const byNamespace: Record<string, ToolDefinition[]> = {};
        for (const def of definitions) {
            if (!byNamespace[def.namespace]) {
                byNamespace[def.namespace] = [];
            }
            byNamespace[def.namespace].push(def);
        }

        for (const [namespace, tools] of Object.entries(byNamespace)) {
            parts.push(`\n-----\n\n[${namespace}]`);

            for (const tool of tools) {
                parts.push(`\n\n  ${tool.name}: ${tool.description}`);

                const requiredParams: string[] = [];
                const optionalParams: string[] = [];

                for (const [paramName, paramDef] of Object.entries(tool.params)) {
                    if (paramDef.optional) {
                        optionalParams.push(paramName);
                    } else {
                        requiredParams.push(paramName);
                    }
                }

                if (requiredParams.length > 0) {
                    parts.push(`    required: ${requiredParams.join(", ")}`);
                }
                if (optionalParams.length > 0) {
                    parts.push(`    optional: ${optionalParams.join(", ")}`);
                }
            }

            parts.push("");
        }

        return parts.join("\n");
    }

    // ==================== Context Management ====================

    async executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]> {
        const results: ToolResult[] = [];
        let contextWarning: string | null = null;

        for (let i = 0; i < toolCalls.length; i++) {
            const toolCall = toolCalls[i];
            const result = await this.toolRegistry.executeToolCall(toolCall);
            results.push(result);

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
            case "file.append":
            case "todo.set":
            case "todo.update":
            case "todo.append":
                break;
        }
    }

    private estimateContextUsage(): number {
        const stats = this.workspace.getStatistics();
        const estimatedTokens = this.promptBuilder.getCurrentTokens() +
            (stats.totalLines * 10) +
            (this.state.toolResults.length * 100);
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
            this.getTaskPrompt(),
            this.state.contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
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

        const sections = this.promptBuilder.buildContextSections(
            toolDefinitions,
            this.getTaskPrompt(),
            this.state.contextStatus,
            directoryWorkspace,
            fileWorkspace,
            todoWorkspace,
            this.state.toolResults,
        );

        return this.promptBuilder.assembleContextSections(sections);
    }

    formatToolResult(toolName: string, result: ToolResult): string {
        if (result.success) {
            return `=========TOOL RESULT: ${toolName}\n${TRON.stringify(result.data)}\n=========`;
        } else {
            const error = result.error!;
            return `=========TOOL ERROR: ${toolName}\nError: ${error.code}\nMessage: ${error.message}\n${error.details ? TRON.stringify(error.details) + "\n" : ""}${error.suggestion ? "Suggestion: " + error.suggestion + "\n" : ""}=========`;
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
    setLLMConfig(config: Partial<DiogenesConfig['llm']>): void {
        this.config.llm = {
            ...this.config.llm,
            ...config,
        };

        // Reinitialize LLM client if API key is provided
        if (this.config.llm.apiKey) {
            this.llmClient = new OpenAIClient({
                apiKey: this.config.llm.apiKey,
                baseURL: this.config.llm.baseURL,
                model: this.config.llm.model,
                timeout: this.config.llm.timeout,
            });
        } else {
            this.llmClient = null;
        }
    }

    /**
     * Get LLM configuration
     */
    getLLMConfig(): LLMConfig {
        // this.config.llm is always defined due to mergeWithDefaults
        // Cast to LLMConfig since all required fields have defaults
        return this.config.llm as LLMConfig;
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
    getLLMClient(): OpenAIClient | null {
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
            throw new Error('LLM client not configured. Please set LLM API key.');
        }

        const prompt = this.buildPrompt();

        const messages = [
            {
                role: 'user' as const,
                content: prompt,
            },
        ];

        let response: string;
        if (onStreamChunk) {
            const result = await this.llmClient.createChatCompletionStream(
                messages,
                onStreamChunk,
                {
                    temperature: this.config.llm.temperature,
                    max_tokens: this.config.llm.maxTokens,
                },
            );
            // Reasoning is kept separate - only use content for the assistant message
            response = result.content;
        } else {
            response = await this.llmClient.createChatCompletion(messages, {
                temperature: this.config.llm.temperature,
                max_tokens: this.config.llm.maxTokens,
            });
        }

        const parseResult = parseToolCalls(response);

        if (!parseResult.success) {
            this.state.toolResults.push(
                `=========PARSE ERROR\n${parseResult.error?.message}\nSuggestion: ${parseResult.error?.suggestion}\n=========`
            );
            return response;
        }

        const toolCalls = parseResult.toolCalls!;

        if (toolCalls.length > 0) {
            const results = await this.executeToolCalls(toolCalls);

            const formattedResults = formatToolResults(toolCalls, results);
            this.state.toolResults.push(formattedResults);

            if (this.state.toolResults.length > 10) {
                this.state.toolResults = this.state.toolResults.slice(-10);
            }
        }

        return response;
    }
}
