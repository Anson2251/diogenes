# Diogenes

A TypeScript framework for building LLM-driven coding agents with explicit, inspectable context.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Status**: Alpha (v0.1.0-alpha.2). Expect API and prompt changes before `1.0.0`.

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
- persisted ACP replay logs so loaded sessions can replay the original ACP-visible event stream
- session-scoped snapshots with restore support and automatic safety snapshots
- Diogenes ACP extensions such as `_diogenes/session/get`, `_diogenes/session/snapshots`, and `_diogenes/session/prune`
- discoverable local ACP slash commands such as `/help`, `/init`, `/doctor`, `/session`, `/restore`, `/snapshots`, and `/snapshot`

When ACP snapshots are enabled, Diogenes now tries to resolve `restic` in this order:

- explicit `resticBinary` / `DIOGENES_RESTIC_BINARY`
- `restic` from `PATH`
- automatic download of the latest matching release from GitHub into the managed data directory

If that still fails, ACP stays usable and session snapshots are degraded to disabled for that runtime.

ACP restore is available both through host APIs (`session/restore`, `_diogenes/session/restore`) and through `/restore <snapshot-id>` inside a session. Every restore creates a safety snapshot first so the restore itself can be undone.

ACP-local slash commands are implemented through a modular registry under `src/acp/slash-commands/`.

See [docs/acp-server.md](./docs/acp-server.md) for usage details and [docs/acp-integration.md](./docs/acp-integration.md) for architecture notes.

### Setup Helpers

Use these built-in commands to inspect first-run state:

```bash
diogenes init
diogenes doctor
diogenes-acp init
diogenes-acp doctor
```

`init` prints the shortest next steps. `doctor` prints config paths, provider environment readiness, and snapshot/restic status.

`diogenes-acp init` also prints:

- the exact ACP launch command as `node <path-to-acp-cli>`
- the environment variable keys to provide
- a ready-to-copy ACP config example snippet

### Model Commands

Diogenes also ships local model management helpers:

```bash
diogenes model list
diogenes model providers
diogenes model show openai/gpt-4o
diogenes model add-provider proxy --style openai --base-url https://example.com/v1
diogenes model add proxy/gpt-4.1 --name "GPT 4.1 Proxy" --context-window 128000
diogenes model default openai/gpt-4o-mini
diogenes model default --clear
diogenes model path
```

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
- `file.remove`

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

### Config Files Guide

Diogenes manages two user-facing config files in its config directory:

- `config.yaml`: runtime and security settings
- `models.yaml`: provider and model catalog

Use these commands to find them:

```bash
diogenes init
diogenes doctor
diogenes model path
diogenes-acp init
diogenes-acp doctor
```

Typical locations:

- macOS: `~/Library/Application Support/diogenes/`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/diogenes/`
- Windows: `%APPDATA%\diogenes\`

Both files are auto-generated on first run, so most users do not need to create them manually.

Use `config.yaml` when you want to change runtime behavior such as:

- workspace root
- shell or watch security settings
- snapshot defaults
- a default `llm.model`

Use `models.yaml` when you want to change model catalog data such as:

- adding a provider
- adding a model under a provider
- changing `baseURL`
- changing `supportsToolRole`
- changing per-model token or temperature defaults
- changing the default `provider/model`

Useful options:

- `security.watch.enabled`
- `security.watch.debounceMs`
- `security.interaction.enabled`
- `security.shell.enabled`

Notes:

- `security.interaction.enabled` disables `task.ask` and `task.choose`
- in the CLI, those tools are still only available in `--interactive`

### Runtime Config Example

Example `config.yaml`:

```yaml
llm:
  model: openai/gpt-4o

security:
  workspaceRoot: /absolute/path/to/workspace
  interaction:
    enabled: false
  watch:
    enabled: true
    debounceMs: 250
  snapshot:
    enabled: true
    autoBeforePrompt: true
```

### Models Configuration

Models are configured in `models.yaml` in the config directory:

```yaml
providers:
  openai:
    style: openai
    baseURL: https://api.openai.com/v1
    supportsToolRole: false
    models:
      gpt-4o:
        name: GPT-4o
        description: Most capable GPT-4 model
        contextWindow: 128000
        maxTokens: 4096
        temperature: 0.7

  claude-proxy:
    style: anthropic
    baseURL: https://your-provider.example.com/v1
    supportsToolRole: false
    models:
      claude-sonnet:
        name: Claude Sonnet
        contextWindow: 200000

  openrouter:
    style: openai
    baseURL: https://openrouter.ai/api/v1
    supportsToolRole: false
    models:
      auto:
        name: Auto
        description: Let OpenRouter choose
        contextWindow: 128000

default: openai/gpt-4o
```

#### Provider Style

Each provider must declare which wire protocol it speaks:

- `style: openai`
- `style: anthropic`

Optional provider capability flags:

- `supportsToolRole: true | false`

Diogenes only uses `style` to choose the client. It does not infer protocol style from the provider name or `baseURL`.

#### API Key Convention

API keys are loaded from environment variables derived from the provider name:

- `openai` -> `OPENAI_API_KEY`
- `claude-proxy` -> `CLAUDE_PROXY_API_KEY`
- `openrouter` -> `OPENROUTER_API_KEY`

#### Model Reference Format

Models are referenced as `provider/model`, e.g.:

- `openai/gpt-4o`
- `claude-proxy/claude-sonnet`
- `openrouter/auto`

#### CLI Models Commands

The easiest way to manage `models.yaml` is through the CLI:

```bash
diogenes model list
diogenes model providers
diogenes model show openai/gpt-4o
diogenes model add-provider proxy --style openai --base-url https://example.com/v1
diogenes model add proxy/gpt-4.1 --name "GPT 4.1 Proxy" --context-window 128000
```

Show, set, or clear the default model:

```bash
diogenes model default
diogenes model default openai/gpt-4o
diogenes model default --clear
```

Use a specific model for a task:

```bash
diogenes -m claude-proxy/claude-sonnet "your task"
```

#### Resolution Order

1. CLI `-m` or `--model` flag
2. `DIOGENES_MODEL` environment variable
3. `default` in `models.yaml`
4. `llm.model` in `config.yaml`

When a `provider/model` format is used, the config from `models.yaml` is applied, including `style`, `baseURL`, token settings, and provider-specific API key lookup.

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
