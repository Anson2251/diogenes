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
  };
}

export interface ToolDefinition {
  namespace: string;
  name: string;
  description: string;
  params: Record<string, {
    type: "string" | "number" | "bool" | "array" | "object" | string;
    optional?: boolean;
    description: string;
  }>;
  returns: Record<string, string>;
}

// ==================== Workspace Types ====================

export interface DirectoryEntry {
  name: string;
  type: 'FILE' | 'DIR';
}

export interface DirectoryWorkspace {
  [path: string]: DirectoryEntry[];
}

export interface FileRange {
  start: number;
  end: number;
}

export interface FileWorkspaceEntry {
  path: string;
  content: string[];
  totalLines: number;
  ranges: FileRange[];
}

export interface FileWorkspace {
  [path: string]: FileWorkspaceEntry;
}

export interface TodoItem {
  text: string;
  state: 'done' | 'active' | 'pending';
}

export interface TodoWorkspace {
  items: TodoItem[];
}

// ==================== File Edit Types ====================

export interface LineAnchor {
  line: number;
  text: string;
  before: string[];
  after: string[];
}

export interface Anchor {
  start: LineAnchor;
  end?: LineAnchor;
}

export type EditMode = 'replace' | 'delete' | 'insert_before' | 'insert_after';

export interface Edit {
  mode: EditMode;
  anchor: Anchor;
  content?: string[];
}

export interface EditOptions {
  atomic?: boolean;
  whitespace?: 'strict' | 'loose';
}

export interface EditResult {
  index: number;
  mode: EditMode;
  matchedRange: [number, number];
  newRange: [number, number];
  matchQuality: 'exact' | 'fuzzy' | 'line_hint';
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
}

export interface ContextSections {
  systemPrompt: string;
    taskPrompt: string;
  toolDefinitions: string;
  contextStatus: string;
  directoryWorkspace: string;
  fileWorkspace: string;
  todoWorkspace: string;
}

// ==================== Security Types ====================

export interface SecurityConfig {
  workspaceRoot: string;
  allowOutsideWorkspace: boolean;
  shell: {
    enabled: boolean;
    timeout: number;
    blockedCommands: string[];
  };
  file: {
    maxFileSize: number;
    blockedExtensions: string[];
  };
}

// ==================== LLM Configuration ====================

export interface LLMConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  timeout?: number;
  temperature?: number;
  maxTokens?: number;
}

// ==================== Framework Configuration ====================

export interface DiogenesConfig {
  systemPrompt?: string;
  tokenLimit?: number;
  security?: Partial<SecurityConfig>;
  tools?: ToolDefinition[];
  llm?: Partial<LLMConfig>;
}

// ==================== Framework State ====================

export interface DiogenesState {
  config: Required<DiogenesConfig>;
  directoryWorkspace: DirectoryWorkspace;
  fileWorkspace: FileWorkspace;
  todoWorkspace: TodoWorkspace;
  contextStatus: ContextStatus;
  toolRegistry: Map<string, ToolDefinition>;
}
