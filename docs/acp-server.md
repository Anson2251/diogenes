# ACP Server

This document explains how to run Diogenes as an ACP server.

## Status

The current ACP server is an MVP.

Supported:

- stdio transport
- `initialize`
- `session/new`
- `session/prompt`
- `session/cancel`
- in-memory sessions
- streamed `session/update` notifications

Not yet supported:

- durable session restore
- `session/load`
- protocol-native user elicitation

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

Sessions are currently in-memory only.

If the ACP server process exits:

- sessions are lost
- session IDs are no longer valid
- the client must create a new session

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
