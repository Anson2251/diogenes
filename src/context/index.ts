/**
 * Main context manager for Diogenes framework
 */

import { WorkspaceManager } from "./workspace";
import { PromptBuilder } from "./prompt-builder";
import { ToolRegistry } from "../tools";
import { BaseTool } from "../tools/base-tool";
import { OpenAIClient } from "../llm/openai-client";
import {
    DiogenesConfig,
    DiogenesState,
    ToolCall,
    ToolResult,
    ToolDefinition,
    LLMConfig,
} from "../types";
import { parseToolCalls, formatToolResults } from "../utils/tool-parser";

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
        const defaultConfig: Required<DiogenesConfig> = {
            systemPrompt: `
            You are Diogenes, a professional coder. Your priority is to finish the tasks/answer the questions from the user. You have explicit control over your context window through tools. Treat tools as your way to see and change the world; do not assume anything about the file system or environment without using tools.

            Core principles:

            1. You decide what to load, unload, and modify in your context.
            2. All useful context should be explicitly visible in the injected sections (Context Status, Directory Workspace, File Workspace, Todo).
            3. Monitor context usage via the CONTEXT STATUS section and manage what you keep loaded.
            4. Prefer small, targeted tool calls over large, exhaustive ones.
            5. Use tools to verify your assumptions before making edits.

            ### General behavior

            - Think in natural language first: outline what you need to do and what you need to inspect.
            - Then choose tools to:
              - Discover files and directories.
              - Search for relevant code or text.
              - Load only the file ranges you need.
              - Edit files safely.
              - Track progress (Todo).

            ### Context and workspace management

            - Before each tool call, quickly check:

              - \`Token Usage\` in CONTEXT STATUS.
              - How many directories and files are currently loaded.

            - If token usage is high (e.g. above ~50%) or many files/lines are loaded:
              - Unload files and directories you no longer need using the unload tools.
              - Prefer re‑loading specific ranges later over keeping everything in context.
              - Your performance would get degraded if you keep too much context (generally speaking, 50% is the threshold).

            - Use workspaces as follows:

              - **Directory Workspace**: Use directory listing tools (e.g. \`dir.list\`) to explore project structure. Unload directories you no longer care about.
              - **File Workspace**: Load only the files or line ranges that are necessary. Prefer:
                - Narrow ranges around the code you’re inspecting or editing.
                - Unloading large or no‑longer‑relevant files to reduce context size.
              - **Todo Workspace**: Maintain a simple, explicit list of steps for multi‑step tasks. Update it as you progress; do not rely on hidden memory.
                Keep it focused; periodically overwrite or prune it to avoid bloat.

            ### Loading files

            - **Never guess file contents.** Always load (or reload) the relevant ranges before editing.
            - When inspecting code:
              - Use \`file.load\` to fetch only the parts you need (e.g., a function, class, or local region).
              - If context changes significantly (after multiple edits), consider re‑loading the affected file/ranges to align with reality.

            ### Shell tools and safety

            - Use shell tools only when necessary (e.g., running tests, linters, build commands, simple file system commands).
            - Prefer safe, read‑only commands (listing, checks) before destructive ones.
            - Avoid dangerous patterns (e.g. removing directories, running untrusted commands) unless clearly required by the task and allowed by policy.

            ### Todo usage

            - **Todo**:
              - On multi‑step tasks, set up a brief todo list early.
              - Mark items as \`active\`, \`pending\`, or \`done\` as you progress.
              - Use it to keep yourself oriented over longer runs instead of relying on memory.

            ### Task completion

            - When you believe the task is finished, blocked, or cannot be completed:

              - Call \`task.end\` with:
                - A brief \`reason\` explaining why you are ending the task.
                - A \`summary\` describing what you did, what changed, and any remaining follow‑ups or limitations.

            - Ensure your final summary is accurate and reflects the current state of files, todos, and any relevant results (tests, builds, etc.).

            ---

            Always:

            - Check CONTEXT STATUS and workspaces before deciding what to load or unload.
            - Use tools to confirm reality rather than assuming.
            - Keep the context small, focused, and relevant to the current task.
            - Plan things ahead using the Todo workspace for multi-step tasks.
            `,
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
            llm: {
                apiKey: '',
                baseURL: 'https://api.openai.com/v1',
                model: 'gpt-4',
                timeout: 30000,
                temperature: 0.7,
                maxTokens: undefined,
            },
        };

        return {
            ...defaultConfig,
            ...config,
            security: {
                ...defaultConfig.security,
                ...config.security,
            },
            llm: {
                ...defaultConfig.llm,
                ...config.llm,
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

    getTaskPrompt(): string {
        return `========= TASK\n${this.task}\n=========`
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
        parts.push("YOUR OUTPUT SHOULD CONTAIN AT LEAST ONE TOOL CALL AND ONLY ONE TOOL-CALL-CODEBLOCK");
        parts.push("Once if you want to emit a tool call, use the following protocol by writing the code block, then and the message, framework would execute your tool call.");
        parts.push("TOOL INVOCATION PROTOCOL:");
        parts.push(
            "All tool calls use a unified JSON protocol. Tools are invoked by emitting a JSON array inside the **last** code block labeled `tool-call`. ONLY THE LAST `tool-call` CODE BLOCK WILL BE PARSED.",
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
            '[{"tool": "dir.list", "params": {"path": "src"}}, {"tool": "todo.update", "params": {"text": "Understand build and run configuration", "state": "done"}}]',
        );
        parts.push("```");
        parts.push("Multiple tool calls will be executed sequentially in the order they appear in the array. And it is recommended to use this format when invoking more than one tool.");

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
            this.getTaskPrompt(),
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
     * 2. Call LLM API
     * 3. Parse tool calls from response
     * 4. Execute tool calls
     * 5. Format results and update context
     *
     * Returns the LLM response text
     */
    async runLLMCycle(): Promise<string> {
        if (!this.llmClient) {
            throw new Error('LLM client not configured. Please set LLM API key.');
        }

        // Build prompt from current context
        const prompt = this.buildPrompt();

        // Prepare messages for OpenAI API
        const messages = [
            {
                role: 'system' as const,
                content: 'You are an AI assistant that follows instructions and uses tools to complete tasks.',
            },
            {
                role: 'user' as const,
                content: prompt,
            },
        ];

        // Call LLM API
        const response = await this.llmClient.createChatCompletion(messages, {
            temperature: this.config.llm.temperature,
            max_tokens: this.config.llm.maxTokens,
        });

        // Parse tool calls from response
        const toolCalls = parseToolCalls(response);

        // Execute tool calls if any
        if (toolCalls.length > 0) {
            const results = await this.executeToolCalls(toolCalls);

            // Format tool results for context
            const _formattedResults = formatToolResults(toolCalls, results);

            // Update context with tool results
            // Note: In the next cycle, these results will be included in the prompt
            // via the buildPrompt() method which reads from workspace state
        }

        return response;
    }
}
