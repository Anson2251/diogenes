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

### Using the CLI

```bash
# Set your OpenAI API key
export OPENAI_API_KEY="your-api-key-here"

# Run a task
diogenes "List all files in the current directory"

# Or use interactive mode
diogenes --interactive
```

### Using the API

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

## CLI Usage

The Diogenes CLI provides a simple command-line interface for task execution.

### Basic Commands

```bash
# Show help
diogenes --help

# Show version
diogenes --version

# Execute a task
diogenes "Your task description here"

# Interactive mode
diogenes --interactive
```

### Options

- `-h, --help` - Show help message
- `-v, --version` - Show version information
- `-k, --api-key <key>` - OpenAI API key (or set OPENAI_API_KEY env var)
- `-m, --model <model>` - LLM model to use (default: gpt-4)
- `-b, --base-url <url>` - OpenAI-compatible API base URL
- `-w, --workspace <path>` - Workspace directory (default: current directory)
- `-c, --config <path>` - Configuration file path (JSON or YAML)
- `-V, --verbose` - Enable verbose output
- `-i, --max-iterations <n>` - Maximum LLM iterations (default: 20)

### Examples

```bash
# Simple task
diogenes "List all TypeScript files in src directory"

# With API key and model
diogenes --api-key sk-... --model gpt-4 "Fix type errors in utils.ts"

# With custom API endpoint
diogenes --base-url https://api.openai.com/v1 "Use custom OpenAI endpoint"

# With workspace and verbose output
diogenes --workspace ./my-project --verbose "Analyze project structure"

# Using configuration file
diogenes --config config.json "Create a new Express.js server"
```

### Interactive Mode

In interactive mode, you can:
- Type tasks directly
- Use `help` to see available commands
- Use `config` to see current configuration
- Use `clear` to clear the screen
- Use `exit` or `quit` to exit

### Configuration File

Create a JSON or YAML configuration file:

```json
{
  "llm": {
    "model": "gpt-4",
    "temperature": 0.7,
    "baseURL": "https://api.openai.com/v1"
  },
  "security": {
    "workspaceRoot": "/path/to/workspace"
  }
}
```

### Environment Variables

- `OPENAI_API_KEY`: OpenAI API key (required)
- `OPENAI_BASE_URL`: OpenAI-compatible API base URL
- `DIOGENES_WORKSPACE`: Default workspace directory
- `DIOGENES_MODEL`: Default LLM model

Example:
```bash
export OPENAI_API_KEY="your-api-key"
export OPENAI_BASE_URL="https://api.openai.com/v1"
export DIOGENES_MODEL="gpt-4"
export DIOGENES_WORKSPACE="/path/to/project"
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

## Troubleshooting

### Common Errors

#### "Network error connecting to https://api.openai.com/v1: fetch failed"
- Check your internet connection
- Verify the API endpoint URL is correct
- If behind a proxy, set HTTP_PROXY/HTTPS_PROXY environment variables
- For self-signed certificates, try: `NODE_TLS_REJECT_UNAUTHORIZED=0 diogenes ...`

#### "OpenAI API key is required"
- Set your API key: `export OPENAI_API_KEY="your-key-here"`
- Or use the `--api-key` option
- Get an API key from https://platform.openai.com/api-keys

#### "API error: Invalid API key"
- Verify your API key is correct
- Check if the key has sufficient permissions/quota
- Generate a new key at https://platform.openai.com/api-keys

#### "Request timeout after 30000ms"
- The server may be slow or network congested
- Increase timeout: `--timeout 60000`
- Check your network connection

### Testing Connectivity

```bash
# Test with a simple task
diogenes --api-key "your-key" "List files in current directory"

# Test with verbose output to see what's happening
diogenes --verbose --api-key "your-key" "Simple task"

# Test with a different endpoint (if using OpenAI-compatible API)
diogenes --base-url "https://your-endpoint.com/v1" --api-key "your-key" "Test"
```

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
