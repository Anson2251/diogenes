# ACP MVP Design

This document turns the ACP integration assessment into a concrete MVP design for Diogenes.

Date: 2026-03-26

## Goal

Build the smallest ACP server that is credible for editor integration without forcing a large runtime rewrite.

The MVP should:

- expose Diogenes over ACP using stdio
- support long-lived sessions while the process is alive
- stream model and tool progress as structured ACP session updates
- support cancellation
- keep Diogenes workspace state session-local

The MVP should not:

- implement durable session restore on day one
- persist full codebase snapshots
- expose terminal-native user elicitation tools
- mirror the full internal prompt into ACP

## Design Summary

The recommended MVP is:

1. a stdio ACP server
2. `initialize`
3. `session/new`
4. `session/prompt`
5. `session/cancel`
6. structured `session/update` notifications during a turn
7. in-memory session storage only
8. no `session/load` capability in v1

This keeps the protocol surface small and fits the current Diogenes architecture.

Operationally, the preferred entry point should be a dedicated ACP binary such as `diogenes-acp`, with `diogenes --acp` kept only as a development shortcut.

## Why This Fits The Current Codebase

Diogenes already has the runtime pieces needed for an ACP MVP:

- explicit workspace state in `WorkspaceManager`
- a long-lived runtime object in `DiogenesContextManager`
- streamed model output through `OpenAIClient`
- a complete tool-execution loop in `executeTask`

Relevant current files:

- `src/index.ts`
- `src/context/index.ts`
- `src/context/workspace.ts`
- `src/llm/openai-client.ts`
- `src/utils/logger.ts`

What is missing is a protocol boundary:

- there is no JSON-RPC transport
- there is no session manager
- there is no protocol-neutral event bus
- execution feedback is still shaped around logger methods and CLI output

## MVP Scope

### In Scope

- stdio ACP transport
- session creation
- prompt execution inside a session
- streamed text updates
- streamed tool lifecycle updates
- cooperative cancellation
- session-local workspace persistence while the process is alive
- non-interactive existing tools

### Out Of Scope

- `session/load`
- durable session persistence
- full conversation replay on reconnect
- protocol-native replacements for `task.ask` and `task.choose`
- transport beyond stdio
- complete workspace mirroring into the client UI

## Session Model

The correct mapping for Diogenes is:

- one ACP session maps to one `DiogenesContextManager`
- one prompt turn maps to one execution run against that session
- workspace state persists across turns inside that session

This preserves the main value of Diogenes: explicit accumulated workspace state rather than stateless one-shot execution.

## Session Lifecycle

### 1. Server Initialize

The server responds to ACP initialization and advertises:

- stdio transport
- prompt support
- cancellation support
- session creation support
- no `loadSession` capability

The production launch path should be the dedicated ACP entrypoint, not the general CLI.

### 2. Session Create

On `session/new`:

- validate `cwd`
- create a new `DiogenesContextManager`
- disable terminal interaction tools
- bind runtime events to the ACP session
- return `sessionId`

### 3. Prompt Turn

On `session/prompt`:

- validate that the session exists
- reject if another run is already active in the session
- translate ACP prompt blocks into a Diogenes task input
- execute one full Diogenes run loop
- stream updates with `session/update`
- return `stopReason` when the turn completes

### 4. Cancellation

On `session/cancel`:

- mark the session run as cancelled
- abort the active LLM request
- stop before starting the next tool call
- emit cancellation updates

### 5. Session End

The MVP does not require a durable close path beyond normal process cleanup, but the session manager should support explicit in-memory disposal internally.

## Minimal Internal Architecture

Suggested structure:

```text
src/
  acp/
    server.ts
    stdio-transport.ts
    session-manager.ts
    session.ts
    event-bus.ts
    adapters/
      runtime-events-to-acp.ts
```

### Responsibilities

`server.ts`

- ACP method registration
- request validation
- wiring transport to session manager

`stdio-transport.ts`

- stdio JSON-RPC framing and dispatch

`session-manager.ts`

- create sessions
- look up sessions
- enforce one active run per session
- cancel or dispose sessions

`session.ts`

- own one `DiogenesContextManager`
- own session-local message history
- own active run state
- expose `prompt()` and `cancel()`

`event-bus.ts`

- define protocol-neutral execution events
- allow multiple subscribers

`runtime-events-to-acp.ts`

- translate runtime events to ACP session updates

## Required Runtime Refactor

The most important code change is not the ACP transport. It is extracting a reusable turn runner from `executeTask`.

Today `executeTask` directly combines:

- message assembly
- streaming callbacks
- tool-call parsing
- tool execution
- task completion handling
- logger output

For ACP, this should become a protocol-neutral runner with hooks or events.

Recommended internal events:

- `run.started`
- `run.iteration.started`
- `llm.stream.delta`
- `llm.stream.completed`
- `tool.calls.parsed`
- `tool.execution.started`
- `tool.execution.completed`
- `context.warning`
- `run.completed`
- `run.failed`
- `run.cancelled`

The CLI logger can subscribe to these events. The ACP adapter can subscribe to the same events. This keeps ACP from becoming a second runtime.

## ACP Mapping

### Required ACP Methods

The MVP should implement:

- `initialize`
- `session/new`
- `session/prompt`
- `session/cancel`

The MVP should not advertise:

- `session/load`

### `session/prompt` Result

At the end of a turn, return only the final `stopReason`.

Likely mappings:

- normal completion -> `end_turn`
- max iteration or safety limit -> `max_turn_requests`
- explicit cancellation -> `cancelled`
- refusal if intentionally surfaced later

### Session Updates

The ACP client should receive structured updates during execution.

Minimum useful update set:

- streamed assistant text chunks
- parsed tool calls
- tool started
- tool completed
- optional plan/workspace summary updates

The adapter should prefer native ACP structures over terminal text.

## Recommended Update Mapping

### LLM Output

Map model text deltas to assistant-message chunk updates.

Do not forward terminal formatting.

Reasoning text, if surfaced at all, should be attached carefully via metadata or a separate optional update path. It should not be mixed back into assistant message history.

### Tool Calls

When tool calls are parsed:

- emit ACP tool call entries
- assign stable per-turn tool call IDs
- include raw input parameters

When tool execution progresses:

- emit `tool_call_update` with status transitions
- include raw output on completion

### Workspace Summary

ACP does not need the full internal prompt or full workspace serialization.

For MVP, expose only coarse summaries:

- loaded directories count
- loaded files count
- total loaded lines
- todo count
- notepad line count

These can be sent either through plan-like updates or `_meta.diogenes.workspaceSummary`.

## Session State

The session object should own:

```ts
type DiogenesSessionState = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  contextManager: DiogenesContextManager;
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
  activeRun: null | {
    runId: string;
    startedAt: string;
    cancelled: boolean;
  };
  fingerprint: SessionFingerprint;
};
```

Notes:

- `messageHistory` is session conversation state, not a serialized prompt dump
- `contextManager` remains the source of truth for workspace state
- `activeRun` is needed for cancellation and reentrancy checks

## Persistence Strategy

### MVP Decision

Do not implement durable session persistence in v1.

Use in-memory session state only.

Rationale:

- ACP does not require `session/load` for a minimal server
- Diogenes already gets value from persistent in-process state
- durable restore is much harder than serializing JSON because file ranges must be reconciled with the current filesystem
- this avoids prematurely defining the wrong restore semantics

### What Survives In MVP

While the server process is alive, each session retains:

- message history
- loaded directories
- loaded file ranges
- todos
- notepad contents
- tool-result-derived context already stored in the runtime

### What Does Not Survive

If the process exits:

- session IDs are invalid
- loaded workspace state is lost
- clients must create a new session

This limitation should be explicitly documented in the server capabilities and user-facing docs.

## Snapshot Strategy

### MVP Decision

Do not persist a full codebase snapshot.

Instead, maintain a lightweight session fingerprint that describes the code state the session has observed.

This is sufficient for warning about drift without trying to version-control the workspace.

### Session Fingerprint

Suggested shape:

```ts
type SessionFingerprint = {
  cwd: string;
  gitHead?: string | null;
  createdAt: string;
  files: Array<{
    path: string;
    mtimeMs: number;
    size: number;
  }>;
};
```

The fingerprint should cover loaded files, not the entire repository.

### Why Not Persist Full File Content

For Diogenes, the filesystem should remain the source of truth.

Persisting full file text would create hard questions immediately:

- what if the file changed outside the agent
- what if line ranges moved
- what if the repo HEAD changed
- what if the client reconnects from a different machine state

Those are not MVP problems. The correct first step is to track drift, not to solve full replay.

## Future Durable Session Design

Durable sessions can be added after the MVP, but the restore model should be:

1. load persisted session metadata
2. recreate a fresh `DiogenesContextManager`
3. restore workspace selections, not stale file text
4. reload current file contents from disk
5. compare fingerprint data
6. emit drift warnings when the filesystem has changed

If persistence is later added, the minimum persisted shape should be:

```ts
type PersistedSession = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
  workspace: {
    loadedDirectories: string[];
    loadedFiles: Array<{
      path: string;
      ranges: Array<{ start: number; end: number }>;
    }>;
    todo: Array<{ text: string; state: "done" | "active" | "pending" }>;
    notepad: string[];
  };
  fingerprint: SessionFingerprint;
};
```

Even in that future design, persisted session data should not be treated as an authoritative code snapshot.

## Tool Exposure Rules

For ACP sessions:

- keep `task.notepad`
- keep file and directory tools
- keep todo tools
- keep shell execution only if current security config allows it
- disable `task.ask`
- disable `task.choose`

The reason is simple: those interaction tools are currently terminal-native and do not yet have protocol-native semantics.

## Cancellation Semantics

Cancellation must be cooperative.

The MVP should guarantee:

- the active LLM stream is aborted immediately
- no new tool call starts after cancellation is observed

The MVP does not need to guarantee interruption of an already-running side-effecting tool.

This is acceptable for v1 and matches the current runtime shape.

## Error Handling

Errors should be surfaced as structured failures.

Categories to handle explicitly:

- invalid session ID
- concurrent prompt on a busy session
- parse error from model output
- tool execution error
- run-level fatal error
- cancellation

The session should survive a bad turn unless the runtime becomes unusable.

## Testing Strategy

### Unit Tests

- session manager creates and isolates sessions
- session prompt rejects unknown or busy sessions
- cancellation flips session run state
- event adapter maps runtime events to ACP updates

### Integration Tests

- `session/new` then `session/prompt` success path
- tool-call execution produces ACP tool updates
- cancellation during stream returns `cancelled`
- workspace state persists across multiple prompts in the same session
- a second session does not see the first session's workspace state

### Deferred Tests

These should wait until durable persistence exists:

- load existing session
- restore workspace selections across process restart
- detect fingerprint drift during restore

## Recommended Implementation Order

1. extract a protocol-neutral turn runner from `executeTask`
2. add runtime events
3. adapt the CLI logger to those events
4. add ACP session and session manager
5. add stdio ACP server
6. add cancellation wiring
7. add tests

## Non-Goals For The MVP

Avoid the following in the first implementation:

- persisting full file contents
- trying to reconstruct the exact internal prompt for the client
- adding protocol support for every runtime detail
- supporting every ACP capability immediately
- coupling ACP directly to workspace internals

## Recommendation

Ship the ACP MVP as an in-memory, stdio-based, cancellable session server.

Treat session persistence and codebase snapshotting as a separate second milestone.

That keeps the first version small, honest, and aligned with the current strengths of Diogenes.
