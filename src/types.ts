/**
 * Core type definitions for the Diogenes framework
 */

// ==================== Tool System Types ====================

export interface ToolCall {
    tool: string;
    params: Record<string, any>;
}

export interface ToolResult {
    success: boolean;
    data?: Record<string, any>;
    error?: {
        code: string;
        message: string;
        details?: Record<string, any>;
        suggestion?: string;
        candidates?: Array<{ line: number; preview: string }>;
    };
}

export interface ToolDefinition {
    namespace: string;
    name: string;
    description: string;
    params: Record<
        string,
        {
            type: "string" | "number" | "bool" | "array" | "object";
            optional?: boolean;
            description: string;
        }
    >;
    returns: Record<string, string>;
}

// ==================== Workspace Types ====================

export interface DirectoryEntry {
    name: string;
    type: "FILE" | "DIR";
}

export interface DirectoryWorkspace {
    [path: string]: DirectoryEntry[];
}

export interface FileRange {
    start: number;
    end: number;
}

export interface FileOffset {
    at: number;
    delta: number;
}

export interface FileWorkspaceEntry {
    path: string;
    content: string[];
    totalLines: number;
    ranges: FileRange[];
    offsets: FileOffset[];
}

export interface FileWorkspace {
    [path: string]: FileWorkspaceEntry;
}

export interface TodoItem {
    text: string;
    state: "done" | "active" | "pending";
}

export interface TodoWorkspace {
    items: TodoItem[];
}

export interface NotepadWorkspace {
    lines: string[];
}

// ==================== File Edit Types ====================

export interface LineAnchor {
    line: number;
    text: string;
    before?: string[];
    after?: string[];
}

export interface Anchor {
    start: LineAnchor;
    end?: LineAnchor;
}

export type EditMode = "replace" | "delete" | "insert_before" | "insert_after";

export interface Edit {
    mode: EditMode;
    anchor: Anchor;
    content?: string[];
}

export interface EditOptions {
    atomic?: boolean;
    whitespace?: "strict" | "loose";
}

export interface EditResult {
    index: number;
    mode: EditMode;
    matchedRange: [number, number];
    newRange: [number, number];
    matchQuality: "exact" | "fuzzy" | "substring" | "line_hint";
}

export interface EditError {
    index: number;
    error: string;
    message: string;
    candidates?: Array<{ line: number; preview: string }>;
}

export interface FileEditResult {
    success: boolean;
    applied: EditResult[];
    errors: EditError[];
    fileState: {
        totalLines: number;
        modifiedRegions: Array<[number, number]>;
    };
}

// ==================== Context Types ====================

export interface ContextStatus {
    tokenUsage: {
        current: number;
        limit: number;
        percentage: number;
    };
    directoryWorkspace: {
        count: number;
    };
    fileWorkspace: {
        count: number;
        totalLines: number;
    };
    notepadWorkspace: {
        lines: number;
    };
}

export interface ContextSections {
    systemPrompt: string;
    taskPrompt: string;
    toolDefinitions: string;
    contextStatus: string;
    directoryWorkspace: string;
    fileWorkspace: string;
    todoWorkspace: string;
    notepadWorkspace: string;
    toolResults: string;
}

// ==================== Security Types ====================

export interface SecurityConfig {
    workspaceRoot?: string;
    allowOutsideWorkspace?: boolean;
    watch?: {
        enabled?: boolean;
        debounceMs?: number;
    };
    interaction?: {
        enabled?: boolean;
    };
    shell?: {
        enabled?: boolean;
        timeout?: number;
        blockedCommands?: string[];
    };
    file?: {
        maxFileSize?: number;
        blockedExtensions?: string[];
    };
    snapshot?: {
        enabled?: boolean;
        requestedEnabled?: boolean;
        unavailableReason?: string;
        includeDiogenesState?: boolean;
        autoBeforePrompt?: boolean;
        storageRoot?: string;
        resticBinary?: string;
        resticBinaryArgs?: string[];
        timeoutMs?: number;
    };
}

// ==================== Logger Types ====================

export interface LoggerConfig {
    level: "debug" | "info" | "warn" | "error" | "silent";
    style?: "tui" | "console" | "silent";
}

// ==================== LLM Configuration ====================

export type LLMProviderStyle = "openai" | "anthropic";

export interface LLMConfig {
    apiKey?: string;
    baseURL?: string;
    model?: string;
    timeout?: number;
    temperature?: number;
    maxTokens?: number;
    provider?: string;
    providerStyle?: LLMProviderStyle;
    supportsToolRole?: boolean;
}

// ==================== Models Configuration ====================

export interface ModelDefinition {
    name: string;
    description?: string;
    contextWindow?: number;
    maxTokens?: number;
    temperature?: number;
    /**
     * Whether this model supports interleaved thinking (reasoning between tool calls).
     * Default to true.
     */
    supportsInterleavedThinking?: boolean;
    /**
     * Whether this model supports native tool calls via API.
     * If not set, inherits from provider definition.
     */
    supportsNativeToolCalls?: boolean;
}

export interface ProviderDefinition {
    style: LLMProviderStyle;
    baseURL?: string;
    supportsToolRole?: boolean;
    models: Record<string, ModelDefinition>;
    /**
     * Default native tool call support for models in this provider.
     * Can be overridden at the model level.
     * @default true
     */
    supportsNativeToolCalls?: boolean;
}

export interface ModelsConfig {
    providers: Record<string, ProviderDefinition>;
    default?: string;
}

export interface ResolvedModel {
    provider: string;
    providerStyle: LLMProviderStyle;
    supportsToolRole: boolean;
    model: string;
    fullName: string;
    apiKey: string;
    baseURL?: string;
    contextWindow?: number;
    maxTokens?: number;
    temperature?: number;
    /**
     * Whether interleaved thinking is supported.
     * Model-level setting overrides provider-level.
     */
    supportsInterleavedThinking: boolean;
    /**
     * Whether native tool calls are supported.
     * Model-level setting overrides provider-level.
     */
    supportsNativeToolCalls: boolean;
}

// ==================== Framework Configuration ====================

export interface DiogenesConfig {
    systemPrompt?: string;
    tokenLimit?: number;
    security?: Partial<SecurityConfig>;
    tools?: ToolDefinition[];
    llm?: Partial<LLMConfig>;
    logger?: Partial<LoggerConfig>;
    interactionHandlers?: {
        ask?: (question: string) => Promise<string>;
        choose?: (question: string, options: string[]) => Promise<string>;
    };
}

// ==================== Framework State ====================

export interface DiogenesState {
    config: Required<DiogenesConfig>;
    directoryWorkspace: DirectoryWorkspace;
    fileWorkspace: FileWorkspace;
    todoWorkspace: TodoWorkspace;
    notepadWorkspace: NotepadWorkspace;
    contextStatus: ContextStatus;
    toolRegistry: Map<string, ToolDefinition>;
    toolResults: string[];
}
