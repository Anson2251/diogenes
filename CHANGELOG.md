# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog and this project currently tracks alpha-stage releases.

## [0.1.0-alpha.3] - 2026-04-09

### Added

- Tree-sitter AST navigation tools and AST-backed file exploration flows
- Comprehensive bundled CLI e2e coverage, including command parsing, model flows, and session flows
- Unified ACP command surface on the main CLI: `diogenes acp`, `diogenes acp init`, `diogenes acp doctor`
- ACP stdio debug mirroring via `--debug-stdio-file`
- ACP e2e coverage for the unified command path (`tests/e2e/acp-command.test.ts`)

### Changed

- Unified ACP and main CLI entrypoints around `src/cli.ts`; ACP now runs through `diogenes acp`
- ACP options in the main CLI now include `--env-file` and `--debug-stdio-file`
- Bundling config was split and simplified around the CLI target; release artifacts now publish `bundle/cli.cjs`
- README and ACP docs were rewritten to use the unified ACP command surface
- CLI-facing quick-start and setup docs were refreshed for current command behavior
- Dependencies were updated to current pinned versions

### Fixed

- AST tool registration issues that could prevent AST tools from being available in some runs
- Redundant LLM config paths in AST-related runtime setup
- Several CLI user-error output paths now return cleaner, non-stack-trace messages

### Notes

- Breaking change: the dedicated ACP entrypoint has been removed (`diogenes-acp`, `dist/acp-cli.js`, `bundle/acp-server.cjs`)
- Recommended migration:
  - `diogenes-acp` -> `diogenes acp`
  - `diogenes-acp init` -> `diogenes acp init`
  - `diogenes-acp doctor` -> `diogenes acp doctor`
  - `node dist/acp-cli.js` -> `node dist/cli.js acp`
  - `node bundle/acp-server.cjs` -> `node bundle/cli.cjs acp`
- The legacy `diogenes --acp` flag remains available as a compatibility shortcut

## [0.1.0-alpha.2] - 2026-04-01

### Added

**Setup & Diagnostics**

- `diogenes init` and `diogenes doctor` commands for managed config discovery, provider readiness, and snapshot diagnostics
- `diogenes-acp init` and `diogenes-acp doctor` commands for ACP setup, config examples, and health checks
- ACP slash commands `/init` and `/doctor`
- Post-connect ACP status messages after `session/new` and `session/load`

**Model Management**

- `diogenes model path`, `model providers`, and `model show <provider/model>`
- `diogenes model add-provider <provider> --style ...`
- `diogenes model add <provider/model> --name ...`
- `diogenes model default --clear`

**ACP Logging**

- File-based ACP logging with `pino`
- Managed ACP log files under `storage/logs/`
- Daily ACP log rotation with `acp-YYYY-MM-DD.log`
- Automatic gzip compression for older ACP logs

### Changed

- ACP setup and help flows now describe managed config files and the current model-management workflow
- `diogenes-acp` now uses `commander` for argument parsing and help output
- ACP diagnostics now show the active log directory and current log file path
- README now includes a file-based configuration guide for `config.yaml` and `models.yaml`
- Provider API key help now documents the generic `<PROVIDER>_API_KEY` convention instead of a fixed provider list

### Fixed

- ACP session creation and startup no longer fail hard when `restic` is unavailable; snapshots degrade cleanly instead
- ACP can automatically acquire `restic` from the latest GitHub release and persist the resolved binary path in managed config
- Snapshot diagnostics now classify `restic` failures by phase and kind, such as `init/timeout` or `verify/spawn`
- Windows managed `restic` extraction now uses `Expand-Archive` for `.zip` assets instead of relying on `tar`

### Notes

- `models.yaml` remains the source of truth for provider/model definitions, but is now intended to be managed through `diogenes model ...` commands or advanced manual edits
- Provider API keys continue to resolve from environment variables derived from the provider name, such as `OPENAI_API_KEY` or `CLAUDE_PROXY_API_KEY`

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
