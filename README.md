# Diogenes

A minimal LLM-controlled agent framework with explicit context management, implemented in TypeScript.

## Overview

Diogenes is a framework that treats the LLM as the primary controller of its own context window. Unlike traditional agent frameworks that use hidden memory layers, embeddings, or forced summarization, Diogenes exposes context manipulation explicitly through tools, allowing the LLM to decide what information stays in context.

## Core Principles

1. **LLM-controlled context**: The LLM decides what to load, unload, and modify in its context window
2. **No implicit memory**: All context must be explicitly visible to the LLM
3. **Tool-mediated interaction**: Any interaction with files, directories, or the system happens via tools
4. **Simplicity over abstraction**: Avoids planners, sub-agents, embeddings, or hidden heuristics
5. **Trust the model, but verify execution**: Tools validate and report results; the LLM reasons about them
6. **Protocol uniformity**: All tools use a single, consistent JSON invocation protocol

## Installation

```bash
npm install diogenes
```

## Quick Start

```typescript
import { createDiogenes, parseToolCalls, formatToolResults } from 'diogenes';

// Create a Diogenes instance
const diogenes = createDiogenes({
  security: {
    workspaceRoot: '/path/to/workspace'
  }
});

// Get the initial prompt for the LLM
const initialPrompt = diogenes.buildPrompt();

// Simulate LLM response with tool calls
const llmResponse = `
I'll start by exploring the project structure.

\`\`\`tool-call
[
  {
    "tool": "dir.dir_list",
    "params": {
      "path": "src"
    }
  }
]
\`\`\`
`;

// Parse tool calls from LLM response
const toolCalls = parseToolCalls(llmResponse);

// Execute tool calls
const results = await diogenes.executeToolCalls(toolCalls);

// Format results for next LLM turn
const toolResults = formatToolResults(toolCalls, results);

// Get updated prompt with results
const nextPrompt = diogenes.buildPrompt();
```

## Architecture

### Context Window Structure

The LLM context window is composed of the following ordered sections:

1. **System prompt** - Framework instructions and principles
2. **Tool definitions** - Available tools and invocation protocol
3. **Context status** - Token usage, workspace summary
4. **Directory workspace** - Loaded directory listings
5. **File workspace** - Loaded file contents (full or partial)
6. **Todo list** - Task tracking

### Workspace Model

- **Directory Workspace**: Directory listings explicitly loaded by the LLM
- **File Workspace**: File contents or partial file contents explicitly loaded by the LLM
- **Todo Workspace**: Externalized scratchpad for task tracking

### Tool System

All tool calls use a unified JSON protocol. Tools are invoked by emitting a JSON array inside the **last** code block labeled `tool-call`.

#### Example Tool Call

```json
[
  {
    "tool": "file.file_load",
    "params": {
      "path": "src/main.ts",
      "start": 1,
      "end": 100
    }
  }
]
```

## Available Tools

### Directory Tools
- `dir.dir_list` - List directory contents and load into workspace
- `dir.dir_unload` - Remove directory from workspace

### File Tools
- `file.file_load` - Load file content into workspace
- `file.file_unload` - Remove file from workspace
- `file.file_edit` - Apply structured edits to a file (complex anchor-based editing)
- `file.file_create` - Create a new file with content
- `file.file_overwrite` - Overwrite entire file content
- `file.file_append` - Append content to end of file

### Todo Tools
- `todo.todo_set` - Overwrite entire todo list
- `todo.todo_update` - Update state of a todo item
- `todo.todo_append` - Add new items to todo list

### Task Tools
- `task.task_end` - End the current task

### Search Tools (Planned)
- `search.search_files` - Search for pattern across files
- `search.search_symbols` - Search for symbol definitions

### Shell Tools (Planned)
- `shell.shell_exec` - Execute a shell command

## Example Session

```typescript
// User request: "Fix the type error in utils.ts"

// LLM Response 1:
const response1 = `
I'll start by loading the project structure and the mentioned file.

\`\`\`tool-call
[
  {
    "tool": "dir.dir_list",
    "params": {"path": "src"}
  },
  {
    "tool": "file.file_load",
    "params": {"path": "src/utils.ts"}
  }
]
\`\`\`
`;

// Parse and execute
const toolCalls1 = parseToolCalls(response1);
const results1 = await diogenes.executeToolCalls(toolCalls1);

// LLM sees results and responds with fix
const response2 = `
I found the issue. The function returns \`undefined\` but the return type is \`string\`.

\`\`\`tool-call
[
  {
    "tool": "file.file_edit",
    "params": {
      "path": "src/utils.ts",
      "edits": [
        {
          "mode": "replace",
          "anchor": {
            "start": {
              "line": 3,
              "text": "export function getUserName(user: User): string {",
              "before": ["import { User } from './types';", ""],
              "after": ["  if (!user) {", "    return undefined;"]
            }
          },
          "content": ["export function getUserName(user: User): string | undefined {"]
        }
      ]
    }
  }
]
\`\`\`
`;

// Execute the fix
const toolCalls2 = parseToolCalls(response2);
const results2 = await diogenes.executeToolCalls(toolCalls2);
```

## Security

Diogenes includes configurable security features:

```typescript
const diogenes = createDiogenes({
  security: {
    workspaceRoot: '/project',
    allowOutsideWorkspace: false,
    shell: {
      enabled: true,
      timeout: 30,
      blockedCommands: ['rm -rf', 'sudo']
    },
    file: {
      maxFileSize: 1048576, // 1MB
      blockedExtensions: ['.exe', '.bin']
    }
  }
});
```

## Configuration

```typescript
interface DiogenesConfig {
  systemPrompt?: string;
  tokenLimit?: number;
  security?: {
    workspaceRoot?: string;
    allowOutsideWorkspace?: boolean;
    shell?: {
      enabled?: boolean;
      timeout?: number;
      blockedCommands?: string[];
    };
    file?: {
      maxFileSize?: number;
      blockedExtensions?: string[];
    };
  };
}
```

## API Reference

### `createDiogenes(config?: DiogenesConfig)`
Creates a new Diogenes context manager with default tools.

### `parseToolCalls(text: string): ToolCall[]`
Parses tool calls from LLM response text.

### `formatToolResults(toolCalls: ToolCall[], results: ToolResult[]): string`
Formats tool execution results for LLM context.

### `DiogenesContextManager`
Main class for managing context and executing tools.

#### Methods:
- `buildPrompt(): string` - Builds the complete prompt with all context sections
- `executeToolCalls(toolCalls: ToolCall[]): Promise<ToolResult[]>` - Executes multiple tool calls
- `getWorkspaceManager(): WorkspaceManager` - Returns the workspace manager instance
- `clearWorkspace(): void` - Clears all workspace content

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Lint
npm run lint

# Format code
npm run format
```

## License

MIT