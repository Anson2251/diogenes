# ACP Server

This document explains how to run Diogenes as an ACP server.

## Status

The current ACP server is functional and session-aware, but still evolving.

Supported:

- stdio transport
- `initialize`
- `session/new`
- `session/load`
- `session/list`
- `session/prompt`
- `session/cancel`
- persisted managed sessions
- streamed `session/update` notifications
- session-scoped snapshots
- host-controlled `session/restore`
- Diogenes ACP session extension methods
- discoverable ACP-local slash commands

Not yet supported:

- protocol-native user elicitation
- non-stdio transports
- richer ACP-facing docs for all extension payloads

## Recommended Entry Point

Use the dedicated ACP binary:

```bash
diogenes-acp
```

Or, before installation:

```bash
node dist/acp-cli.js
```

This is the preferred entry point for ACP clients and editor integrations.

There is also a development shortcut through the general CLI:

```bash
diogenes --acp
```

That mode exists for convenience, but ACP clients should prefer `diogenes-acp`.

## Build And Bundle

Build the project:

```bash
pnpm run build
```

Create the dedicated ACP bundle:

```bash
pnpm run bundle:acp
```

This produces:

```text
bundle/acp-server.cjs
```

## Configuration

The ACP server accepts the same core model and workspace configuration as the main CLI.

### Command-Line Options

```bash
diogenes-acp \
  --env-file /path/to/.env.acp \
  --config-file /path/to/diogenes.config.yaml \
  --api-key "$OPENAI_API_KEY" \
  --model gpt-4o \
  --workspace /path/to/repo \
  --max-iterations 20
```

Supported options:

- `--api-key`
- `--model`
- `--base-url`
- `--workspace`
- `--config-file`
- `--env-file`
- `--max-iterations`

### Environment Variables

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `DIOGENES_MODEL`
- `DIOGENES_WORKSPACE`

### Config Files

JSON and YAML config files are supported.

Example:

- `examples/diogenes.config.yaml`

If you want the ACP server to read a specific env file instead of the default process environment, pass:

```bash
diogenes-acp --env-file /path/to/.env.acp
```

If you want to provide an explicit config file path, pass:

```bash
diogenes-acp --config-file /path/to/diogenes.config.yaml
```

## Session Behavior

Each ACP session gets its own Diogenes runtime instance.

That means:

- workspace state is isolated per session
- loaded files and directories persist across prompts within the same session
- todos and notepad state persist across prompts within the same session
- snapshots belong to the session, not to a global snapshot registry

Sessions are persisted under the managed Diogenes local data directory.

That persistence stores session metadata, lightweight session state, and a persisted ACP replay log so a later ACP server process can load the session again and replay the original ACP-visible update stream.

If the ACP server process exits:

- live in-memory sessions end
- persisted sessions can be listed and loaded again through ACP
- empty sessions with no messages are deleted when they are disposed

## Session Management Surface

The ACP server currently supports these standard session methods:

- `session/new`
- `session/load`
- `session/list`
- `session/prompt`
- `session/cancel`
- `session/restore`

Diogenes also exposes session management extensions for richer host tooling:

- `_diogenes/session/get`
- `_diogenes/session/snapshots`
- `_diogenes/session/dispose`
- `_diogenes/session/delete`
- `_diogenes/session/prune`
- `_diogenes/session/restore`

Custom capability metadata is advertised under `_meta.diogenes` during `initialize`.

## Slash Commands

ACP sessions expose a small set of local slash commands through `available_commands_update` and persisted `availableCommands` metadata.

Current built-ins:

- `/help`
- `/session`
- `/restore`
- `/snapshots`
- `/snapshot`

Notes:

- `/commands` is an alias for `/help`
- `/status` is an alias for `/session`
- these commands are handled locally inside the ACP session layer and do not require an LLM round-trip
- command-specific metadata lives in `availableCommands[*]._meta.diogenes`
- commands are registered through a dedicated modular registry under `src/acp/slash-commands/`

## Persisted ACP Replay

`session/load` replays a persisted ACP update log instead of reconstructing ACP events from `messageHistory`.

That means:

- Diogenes stores the `session/update` payloads originally sent to the ACP client
- load replay can preserve ACP-specific structures such as `tool_call`, `tool_call_update`, and structured diff content
- `messageHistory` remains part of runtime/session state, but is no longer the canonical source for ACP replay

Example metadata shape:

```json
{
  "name": "snapshot",
  "description": "Create a defensive session snapshot",
  "input": { "hint": "optional label for the snapshot" },
  "_meta": {
    "diogenes": {
      "kind": "session_snapshot",
      "invocations": ["/snapshot"],
      "example": "/snapshot before-risky-edit"
    }
  }
}
```

## Snapshot Restore Semantics

Snapshot restore remains user-driven, but ACP hosts and ACP-local slash commands can both initiate it.

That means:

- the ACP host may call `session/restore` or `_diogenes/session/restore`
- ACP clients may also invoke `/restore <snapshot-id>` as a normal user command inside the session
- every restore automatically creates a safety snapshot before applying the target snapshot
- restore completion surfaces the `safetySnapshotId` under `_meta.diogenes`

Restore lifecycle notifications are emitted through `session/update` using:

- `snapshot_restore_started`
- `snapshot_restore_completed`
- `snapshot_restore_failed`

After a successful restore, Diogenes also emits a user-visible assistant message summarizing the restored snapshot and the safety snapshot created for undo.

## Tool Behavior In ACP Sessions

ACP sessions disable terminal-native interaction tools:

- `task.ask`
- `task.choose`

Other normal tools remain available, subject to normal security configuration.

## Output Model

The ACP server emits:

- streamed assistant text chunks
- tool-call creation events
- tool-call status updates
- prompt completion with `stopReason`

The server does not mirror the full internal Diogenes prompt into ACP updates.

## Recommended Client Launch

If your ACP client accepts a command plus args, prefer one of:

```json
{
  "command": "diogenes-acp",
  "args": [
    "--env-file", "/path/to/.env.acp",
    "--config-file", "/path/to/diogenes.config.yaml",
    "--workspace", "/path/to/repo"
  ]
}
```

Or:

```json
{
  "command": "node",
  "args": ["dist/acp-cli.js", "--workspace", "/path/to/repo"]
}
```

For bundled deployment:

```json
{
  "command": "node",
  "args": ["bundle/acp-server.cjs", "--workspace", "/path/to/repo"]
}
```

## Related Documents

- `docs/acp-integration.md`
- `docs/acp-mvp-design.md`
