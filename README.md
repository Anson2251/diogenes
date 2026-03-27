# Diogenes

A TypeScript framework for building LLM-driven coding agents with explicit, inspectable context.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Status**: Active development. Expect API and prompt changes before `1.0.0`.

## What Diogenes Is

Diogenes is an agent runtime that keeps the model's working state visible instead of hiding it behind planners, embeddings, or implicit memory layers.

In practice, that means:

- loaded directories are visible
- loaded file ranges are visible
- tool results are visible
- short-term notes and todos are visible

The goal is not "more automation". The goal is a simpler agent loop that is easier to inspect, debug, and trust.

## Why It Exists

Many agent frameworks trade transparency for convenience. They summarize aggressively, keep hidden memory, or introduce orchestration layers that are hard to reason about.

Diogenes takes the opposite approach:

- context management is explicit
- tool use is explicit
- file edits are structured
- workspace state is observable
- the model is responsible for deciding what to keep in context

This makes the framework especially useful when you care about:

- debuggability
- deterministic tool behavior
- precise file editing
- long-running coding sessions where context hygiene matters

## Quick Start

### Requirements

- Node.js 18+
- pnpm recommended

### Install

```bash
git clone https://github.com/Anson2251/diogenes.git
cd diogenes
pnpm install
```

### Common Commands

```bash
pnpm run build
pnpm test
pnpm run dev
pnpm run lint
pnpm run bundle
pnpm run bundle:acp
```

### Run The CLI

Build first:

```bash
pnpm run build
```

Run a one-shot task:

```bash
node dist/cli.js "List all files in src"
```

Start an interactive session:

```bash
node dist/cli.js --interactive
```

Start socratic mode:

```bash
node dist/cli.js --socratic "Debug the failing test"
```

Start the ACP server:

```bash
node dist/acp-cli.js
```

## CLI Modes

### Default Mode

Run one task, let the agent work until it finishes or reaches the iteration limit, then exit.

Use this when you want:

- a single answer
- a single edit pass
- scriptable CLI behavior

### Interactive Mode

Run multiple tasks in one terminal session.

Use this when you want:

- to keep the same session open
- to give the agent multiple tasks in sequence
- to let the agent ask follow-up questions through `task.ask` and `task.choose`

Important:

- `task.ask` and `task.choose` are only exposed in `--interactive`
- after one task ends, the CLI waits for the next task instead of exiting

### Socratic Mode

Drive the session manually, step by step.

Use this when you want:

- full control over tool calls
- to inspect context after every step
- to reproduce or debug agent behavior

Useful commands:

- `tools` or `/tools`
- `context` or `/context`
- `results` or `/results`
- `task` or `/task`
- `tool` or `/tool` for multi-line tool-call input
- `paste` or `/paste` for arbitrary multi-line input
- `help` or `/help`
- `exit` or `/exit`

Multi-line input ends with `..` on its own line.

### ACP Server

Run the dedicated ACP entrypoint when integrating with editors or other ACP clients.

Preferred:

```bash
node dist/acp-cli.js
```

Development shortcut:

```bash
node dist/cli.js --acp
```

Create the standalone ACP bundle with:

```bash
pnpm run bundle:acp
```

Current ACP support includes:

- persisted managed sessions with `session/load` and `session/list`
- streamed `session/update` notifications for assistant text, tool calls, plans, and restore lifecycle
- session-scoped snapshots with host-controlled restore
- Diogenes ACP extensions such as `_diogenes/session/get`, `_diogenes/session/snapshots`, and `_diogenes/session/prune`
- discoverable local ACP slash commands such as `/help`, `/session`, `/restore`, `/snapshots`, and `/snapshot`

Restore remains host-controlled. The ACP host may call `session/restore` or `_diogenes/session/restore`, while `/restore` inside a session only explains the workflow.

See [docs/acp-server.md](./docs/acp-server.md) for usage details and [docs/acp-integration.md](./docs/acp-integration.md) for architecture notes.

## Core Concepts

### Workspace

Diogenes exposes working state through explicit workspace sections:

- `Directory Workspace`
- `File Workspace`
- `Todo`
- `Notepad`

That state is part of the agent prompt, so both the model and the developer can see what is currently loaded.

### File Ranges

Files are not treated as all-or-nothing by default. The agent can load only the lines it needs, inspect them, edit them, and unload them later.

This matters for large repositories, because it keeps the active context smaller and more intentional.

### Notepad

`task.notepad` exists to preserve short working memory after unloading files.

A typical workflow is:

1. load a file range
2. extract the few facts that still matter
3. write those facts into the notepad
4. unload the file
5. continue without carrying the full file content

### Automatic Refresh

Loaded files and directories can be refreshed automatically with filesystem watchers.

If a watched file changes on disk:

- the workspace reloads the loaded ranges
- line range tracking is preserved
- the model does not need to manually reload just to see the latest content

## Tool Overview

### Directory Tools

- `dir.list`
- `dir.unload`

### File Tools

- `file.load`
- `file.peek`
- `file.edit`
- `file.create`
- `file.overwrite`
- `file.unload`

### Task Tools

- `task.notepad`
- `task.ask`
- `task.choose`
- `task.end`

### Todo Tools

- `todo.set`
- `todo.update`

### Choosing The Right File Tool

- use `file.edit` for small, local changes
- use `file.overwrite` when replacing most of a file or a large contiguous block
- use `file.create` when the target file does not exist
- use `file.peek` to verify content without loading it into workspace
- use `file.load` when the content needs to remain available in context

As a rule of thumb, a single `file.edit` operation should stay relatively small. Around 30 lines is a good target.

## Configuration

Configuration can be loaded from JSON or YAML.

Example:

- [examples/diogenes.config.yaml](./examples/diogenes.config.yaml)

Useful options:

- `security.watch.enabled`
- `security.watch.debounceMs`
- `security.interaction.enabled`
- `security.shell.enabled`

Notes:

- `security.interaction.enabled` disables `task.ask` and `task.choose`
- in the CLI, those tools are still only available in `--interactive`

## Advanced: Tool-Call Format

Most users do not need to think about the raw tool-call format unless they are working in socratic mode, testing prompts, or debugging parser behavior.

Tool calls are written as JSON inside a fenced `tool-call` block.

Example:

```tool-call
[
  {
    "tool": "file.peek",
    "params": {
      "path": "README.md",
      "start": 1,
      "end": 20
    }
  }
]
```

### Heredoc For Multi-Line Content

For multi-line file content, use heredoc rather than escaping newlines in JSON.

```tool-call
[
  {
    "tool": "file.overwrite",
    "params": {
      "path": "README.md",
      "content": { "$heredoc": "EOF" }
    }
  }
]
<<<EOF
# Title

Updated content
EOF
```

Rules:

1. put `{"$heredoc":"DELIM"}` in the JSON value
2. put `<<<DELIM` inside the same `tool-call` block
3. write the raw content next
4. close with a line containing only `DELIM`

## File Editing Notes

`file.edit` is the most precise writing tool, but also the easiest one to misuse.

For reliable edits:

1. inspect the target text first with `file.peek` or `file.load`
2. copy anchor text exactly
3. include nearby context when possible
4. if the same text appears multiple times, include context to disambiguate it
5. if the change is large, prefer `file.overwrite`

## Development

The repository is written in TypeScript and uses Vitest for tests.

During development:

```bash
pnpm run dev
pnpm test
```

If you are changing prompts, parsers, or file editing behavior, test both:

- focused unit tests
- full task execution flows

## License

Diogenes is released under the MIT License. See [LICENSE](./LICENSE).
