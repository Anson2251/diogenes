# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project currently tracks alpha-stage releases.

## [0.1.0-alpha.1] - 2026-03-30

### Added

**Core Framework**

- LLM-driven agent runtime with explicit context management
- Workspace system with `Directory Workspace`, `File Workspace`, `Todo`, and `Notepad` sections
- File range loading and editing with line-level precision
- Automatic filesystem watching and refresh for loaded files and directories

**CLI Modes**

- Default one-shot task execution mode
- Interactive mode for multi-turn sessions with `task.ask` and `task.choose` support
- Socratic mode for step-by-step manual control with debug commands

**Tools**

- Directory tools: `dir.list`, `dir.unload`
- File tools: `file.load`, `file.peek`, `file.edit`, `file.create`, `file.overwrite`, `file.unload`, `file.remove`
- Task tools: `task.notepad`, `task.ask`, `task.choose`, `task.end`
- Todo tools: `todo.set`, `todo.update`

**ACP (Agent Communication Protocol) Server**

- Dedicated ACP server for editor integration
- Persisted managed sessions with `session/load` and `session/list`
- Streamed `session/update` notifications for assistant text, tool calls, plans, and restore lifecycle
- Persisted ACP replay logs for loaded sessions
- Session-scoped snapshots with restore support and automatic safety snapshots
- Diogenes ACP extensions: `_diogenes/session/get`, `_diogenes/session/snapshots`, `_diogenes/session/prune`
- ACP slash commands: `/help`, `/session`, `/restore`, `/snapshots`, `/snapshot`

**Model Configuration**

- Provider-based model configuration through `models.yaml`
- `provider/model` model resolution for CLI and ACP startup flows
- Explicit provider `style` selection for `openai` and `anthropic` protocol families
- Provider-scoped API key resolution via `<PROVIDER>_API_KEY`
- `diogenes models` commands for listing available models and managing the default model
- Anthropic client support alongside OpenAI-compatible client
- Optional `supportsToolRole` provider capability flag
- `models.example.yaml` with commented examples

**Configuration & Security**

- JSON and YAML configuration file support
- Managed configuration with isolated storage paths
- Security settings for filesystem watching, interaction, and shell execution
- Gitignore-aware file access (blocked reading of gitignored files)

**Developer Experience**

- Pre-commit hooks with automatic formatting
- Comprehensive test suite with Vitest
- Bundle support for CLI and ACP server

### Changed

- Removed `--api-key` as a supported user-facing configuration path
- Removed `llm.apiKey` as a supported user-facing config file input
- CLI help and README document provider-scoped API key environment variables
- Model list output shows provider style, tool-role support, and expected API key variable

### Fixed

- Preserved tool-result context for providers supporting tool-role messages
- Safe fallback handling for Anthropic-style providers (degrading `tool` messages to user-visible content)
- Isolated config bootstrap tests from real local storage paths
- Improved missing API key errors with exact expected environment variable name
- Stabilized ACP session reload behavior
- Preserved gitignored files during snapshot restore
- Fixed ACP toolCallId collisions across iterations
- Hardened file.edit content normalization and validation

### Notes

- This is an alpha release and configuration behavior may still evolve
- Provider definitions must declare `style`
- API keys must be supplied through environment variables matching the provider name (e.g., `OPENAI_API_KEY` or `CLAUDE_PROXY_API_KEY`)
- `supportsToolRole` should stay `false` unless the target provider is known to support tool-role messages correctly
