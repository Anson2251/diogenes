# Diogenes

A minimal LLM-controlled agent framework with explicit context management, implemented in TypeScript.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Note**: This project is in active development. APIs may change until version 1.0.0.

## 1. What it is

Diogenes is a framework that treats the LLM as the primary controller of its own context window. Unlike traditional agent frameworks that use hidden memory layers, embeddings, or forced summarization, Diogenes exposes context manipulation explicitly through tools, allowing the LLM to decide what information stays in context.

### Core Principles

1. **LLM-controlled context**: The LLM decides what to load, unload, and modify in its context window
2. **No implicit memory**: All context must be explicitly visible to the LLM
3. **Tool-mediated interaction**: Any interaction with files, directories, or the system happens via tools
4. **Simplicity over abstraction**: Avoids planners, sub-agents, embeddings, or hidden heuristics
5. **Trust the model, but verify execution**: Tools validate and report results; the LLM reasons about them
6. **Protocol uniformity**: All tools use a single, consistent JSON invocation protocol

## 2. What is the difference

Traditional agent frameworks often hide complexity behind abstractions like:
- Implicit memory systems that summarize or embed content
- Hidden planners that break down tasks without LLM awareness
- Forced context window management such as truncation or summarization
- Complex orchestration layers

Diogenes takes a different approach:
- **Explicit context management**: The LLM sees exactly what's loaded via workspace sections
- **Direct control**: The LLM decides what to load and unload using tools
- **Transparent execution**: All tool results are visible in the context
- **Minimal abstraction**: No hidden planners, embeddings, or memory systems
- **Unified protocol**: All tools use the same simple JSON format

The key difference is **agency**: Diogenes gives the LLM direct control over its working memory, rather than hiding it behind layers of automation.

## 3. How to use it

### Prerequisites

- Node.js 18 or higher
- TypeScript 5.0+ for development
- pnpm recommended, though npm or yarn also work

### Installation

```bash
git clone https://github.com/Anson2251/diogenes.git
cd diogenes
pnpm install
```

### Available Scripts

- `pnpm run build` - Compile TypeScript to JavaScript
- `pnpm run dev` - Development mode with auto rebuild
- `pnpm test` - Run tests with Vitest
- `pnpm run lint` - Lint the codebase
- `pnpm run bundle` - Build and create a bundled CLI executable

### Basic Usage

1. Build the project:

```bash
pnpm run build
```

2. Run tests:

```bash
pnpm test
```

3. Run the CLI after building:

```bash
node dist/cli.js "List all files in the current directory"
```

4. During development, use watch mode:

```bash
pnpm run dev
```

5. Start an interactive session:

```bash
node dist/cli.js --interactive
```

6. Start socratic mode for guided manual control:

```bash
node dist/cli.js --socratic "Debug the failing test"
```

## 4. Workspace Model

Diogenes exposes its working state through explicit workspace sections:

- **Directory Workspace**: directory listings loaded by `dir.list`
- **File Workspace**: loaded file ranges from `file.load`
- **Todo Workspace**: short execution plans managed by `todo.set` and `todo.update`
- **Notepad Workspace**: retained short notes managed by `task.notepad`

The file and directory workspaces now support automatic refresh through filesystem watching. If a loaded file or loaded directory changes on disk, the workspace view is refreshed without requiring the model to reload it manually. For file edits, range recalculation is still preserved, but the workspace owns the actual reload.

The notepad is intended for short working memory. A typical pattern is:

1. Read a large file with `file.load`
2. Extract the facts you still need into `task.notepad`
3. Unload the file with `file.unload`
4. Continue using the notepad summary without keeping the full file in context

## 5. File and Task Tools

### File Tools

- `file.load` - Load file content into workspace
- `file.peek` - Preview file lines without loading them into workspace
- `file.edit` - Apply anchor-based local edits
- `file.create` - Create a new file with full content
- `file.overwrite` - Replace an entire file with full content
- `file.unload` - Remove a file from workspace context

### Choosing the Right File Tool

- Use `file.edit` for local edits. A single edit around 30 lines is a good target.
- Use `file.overwrite` when replacing most of a file or a large contiguous block.
- Use `file.create` when the target file does not exist yet.
- Use heredoc for multi-line content with `file.edit`, `file.create`, and `file.overwrite`.

### Task Tools

- `task.notepad` - Keep short retained notes across unloads
- `task.ask` - Ask the user a direct open question when blocked on missing input. In the CLI this is only available in `--interactive` mode.
- `task.choose` - Ask the user to select from a small fixed set of options. In the CLI this is only available in `--interactive` mode.
- `task.end` - End the current task with a reason and summary

### Todo Tools

- `todo.set` - Create or replace a short execution plan
- `todo.update` - Update the state of an existing todo item

## 6. Heredoc Usage

For multi-line content, prefer heredoc syntax:

```tool-call
[
  {
    "tool": "file.overwrite",
    "params": {
      "path": "README.md",
      "content": {"$heredoc": "EOF"}
    }
  }
]
<<<EOF
# Title

Updated content
EOF
```

Rules:

1. Put `{"$heredoc":"DELIM"}` inside the JSON
2. Put `<<<DELIM` after the JSON array
3. Put the raw content next
4. Close with a line containing only `DELIM`
5. Keep the heredoc inside the same `tool-call` block

## 7. Configuration

Configuration can be loaded from JSON or YAML. An example file is provided at [`examples/diogenes.config.yaml`](examples/diogenes.config.yaml).

Relevant security options include:

- `security.watch.enabled` - Enable or disable automatic workspace refresh from filesystem changes
- `security.watch.debounceMs` - Debounce interval for filesystem-driven refresh
- `security.interaction.enabled` - Enable or disable interactive tools such as `task.ask` and `task.choose`. In the CLI they are still suppressed unless you run `--interactive`.
- `security.shell.enabled` - Enable or disable shell execution

## 8. CLI Modes

### Interactive Mode

`--interactive` is for repeated task execution in one terminal session.

- Enter a task directly at the prompt
- After one task ends, the session stays open and waits for the next task
- `task.ask` and `task.choose` are only exposed in this mode

### Socratic Mode

`--socratic "task"` is for manually guiding the agent step by step.

- Use `tools`, `context`, `results`, and `task` to inspect state
- Use `tool` or `/tool` to enter multi-line tool-call mode
- Use `paste` or `/paste` to paste arbitrary multi-line text
- Finish multi-line input with `..` on its own line
- Slash-prefixed commands such as `/help` and `/exit` are supported

## 9. Notes on File Editing

`file.edit` is the most precise file-writing tool, but it is also the most demanding:

1. Load or peek the file first
2. Copy anchor text verbatim
3. Provide surrounding context when possible
4. If the same text appears multiple times, provide context to disambiguate it
5. Prefer `file.overwrite` instead of forcing very large `file.edit` ranges

## License

Diogenes is released under the MIT License. See the [LICENSE](./LICENSE) file for details.

Copyright (c) 2024
