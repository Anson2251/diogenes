# ACP Session Management Design

Date: 2026-03-26

## Goal

Strengthen ACP session lifecycle management so session-scoped features such as snapshots, temporary resources, and future restore flows have a correct owner and cleanup boundary.

This design should:

- define a clear session lifecycle
- introduce explicit session disposal
- define session-owned resource management
- preserve the current one-active-run-per-session model
- make prompt, cancel, and cleanup behavior explicit

This design should not:

- introduce durable session restore by itself
- change the core Diogenes runtime model
- move snapshot logic into `DiogenesContextManager`

## Current State

Today the ACP layer already supports:

- `initialize`
- `session/new`
- `session/prompt`
- `session/cancel`
- per-session `DiogenesContextManager`
- per-session message history
- one active run per session

Current gaps:

- no explicit `disposeSession()` path
- no session state machine beyond `activeRun !== null`
- no formal ownership model for session-scoped resources
- no cleanup hook for future resources such as snapshot repositories
- no server shutdown cleanup contract

In short: the runtime can create and use sessions, but it does not yet manage their full lifecycle.

## Design Summary

The recommended model is:

1. `ACPServer` owns one `SessionManager`
2. `SessionManager` owns all `ACPSession` instances
3. each `ACPSession` owns:
   - one `DiogenesContextManager`
   - message history
   - active run state
   - session-scoped resources
4. sessions have explicit lifecycle states
5. sessions can be explicitly disposed
6. disposal cancels active work first, then cleans up owned resources

This keeps session ownership local and makes later snapshot integration straightforward.

## Lifecycle States

Recommended session lifecycle:

```ts
type SessionLifecycleState =
  | "active"
  | "running"
  | "disposing"
  | "disposed";
```

Semantics:

- `active`
  - session exists and can accept a new prompt
- `running`
  - a prompt turn is in progress
  - no second prompt is allowed
- `disposing`
  - cleanup has started
  - no new work is allowed
- `disposed`
  - session is dead
  - no operations are allowed

This is intentionally small. The current code does not need a more complex state graph yet.

## State Transitions

Recommended transitions:

```text
new session -> active
active -> running
running -> active
active -> disposing
running -> disposing
disposing -> disposed
```

Disallowed transitions:

- `disposed -> active`
- `disposed -> running`
- `disposing -> running`

## Session Invariants

The session layer should enforce these invariants:

- a session has at most one active run
- a disposed session cannot be reused
- cleanup runs at most once
- session-owned resources are cleaned in disposal order
- cancellation is best-effort immediate, but disposal waits for prompt completion or cancellation exit

## Ownership Model

Each `ACPSession` should be the owner of all session-scoped resources.

Initial owned resources:

- `DiogenesContextManager`
- in-memory `messageHistory`
- active run state

Future owned resources:

- `SnapshotManager`
- temp directories
- per-session caches
- future session fingerprints

This means `SessionManager` should not know the cleanup internals of individual resources. It should delegate disposal to the session object.

## ACPSession Shape

Suggested internal shape:

```ts
class ACPSession {
  readonly sessionId: string;
  readonly cwd: string;
  readonly createdAt: string;

  private lifecycleState: SessionLifecycleState;
  private updatedAt: string;
  private disposePromise: Promise<void> | null;
  private messageHistory: ConversationMessage[];
  private activeRun: ActiveRunState | null;
  private readonly resources: SessionResourceRegistry;
  private diogenes: ReturnType<typeof createDiogenes>;
}
```

Suggested active run shape:

```ts
type ActiveRunState = {
  id: string;
  cancelled: boolean;
  streamedContent: string;
  emittedContentLength: number;
  nextToolCallSequence: number;
  toolCallIds: Map<string, string>;
};
```

## Session Resource Registry

Add a small internal abstraction for owned resources:

```ts
interface SessionOwnedResource {
  dispose(): Promise<void> | void;
}

class SessionResourceRegistry {
  register(name: string, resource: SessionOwnedResource): void;
  disposeAll(): Promise<void>;
}
```

Purpose:

- centralize cleanup ordering
- make snapshot integration a session concern instead of a global concern
- keep `ACPSession.dispose()` readable

This abstraction can stay private to the ACP layer.

## SessionManager Responsibilities

`SessionManager` should be the canonical index of live sessions.

Recommended responsibilities:

- create sessions
- look up sessions
- cancel sessions
- dispose sessions
- dispose all sessions on server shutdown
- reject duplicate cleanup

Recommended interface:

```ts
class SessionManager {
  createSession(cwd: string): ACPSession;
  getSession(sessionId: string): ACPSession | undefined;
  cancelSession(sessionId: string): boolean;
  disposeSession(sessionId: string): Promise<boolean>;
  disposeAllSessions(): Promise<void>;
  listSessions(): ACPSession[];
}
```

Behavior notes:

- `disposeSession()` returns `false` if the session does not exist
- after successful disposal, the session is removed from the map
- `disposeAllSessions()` should be safe to call multiple times

## ACPServer Responsibilities

`ACPServer` should remain thin.

Recommended responsibilities:

- request validation
- session method routing
- background response handling
- server shutdown cleanup

Recommended additions:

- expose `dispose()` on `ACPServer`
- call `sessionManager.disposeAllSessions()` from `dispose()`

If a future ACP method such as `session/close` is added, `ACPServer` should map it to `SessionManager.disposeSession()`.

## Prompt Semantics

Prompt execution should remain session-local, but lifecycle checks should be stricter.

Recommended `prompt()` preconditions:

- server initialized
- session exists
- session state is `active`

On prompt start:

- session state becomes `running`
- `updatedAt` is refreshed
- active run object is created

On prompt completion:

- message history is committed
- `updatedAt` is refreshed
- state returns to `active`

On failure:

- active run is cleared
- state returns to `active` unless disposal has started

## Cancel Semantics

Cancel remains cooperative.

Recommended behavior:

- `cancel()` only affects the current run
- if there is no active run, `cancel()` is a no-op
- cancellation sets `activeRun.cancelled = true`
- cancellation aborts the active LLM request
- prompt completion returns `stopReason: "cancelled"`

Important:

- cancel does not dispose the session
- after cancellation completes, the session returns to `active`

This distinction matters because later features may want to cancel a run but keep the session alive.

## Dispose Semantics

Disposal is stronger than cancel.

Recommended `dispose()` flow inside `ACPSession`:

1. if already disposed, return immediately
2. if disposal already started, return the existing `disposePromise`
3. set state to `disposing`
4. cancel active run if present
5. wait for the active prompt flow to exit
6. dispose all owned resources
7. clear message history and ephemeral references
8. set state to `disposed`

Recommended rules:

- disposal must be idempotent
- no new prompt may begin once disposal starts
- resource cleanup errors should be collected and surfaced, not silently dropped

## Concurrency Rules

The ACP layer should rely on simple, explicit rules instead of broad locking.

Rules:

- `prompt()` may run only in `active`
- `cancel()` may run in `running`
- `dispose()` may run in `active` or `running`
- once `dispose()` starts, all new `prompt()` calls fail

This is enough for the current single-threaded request flow.

## Error Model

Recommended session-layer errors:

- `UNKNOWN_SESSION`
- `SESSION_BUSY`
- `SESSION_DISPOSING`
- `SESSION_DISPOSED`
- `SESSION_DISPOSAL_FAILED`

Suggested mapping:

- unknown session -> existing `-32001`
- busy session -> existing `-32002`
- disposing/disposed -> `-32003`
- disposal failed -> `-32004`

This gives session lifecycle failures clearer semantics than generic execution errors.

## Metadata

The session should expose lightweight metadata for diagnostics and future admin features.

Suggested shape:

```ts
type SessionMetadata = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  updatedAt: string;
  state: SessionLifecycleState;
  hasActiveRun: boolean;
};
```

This is useful for:

- debugging
- tests
- future ACP admin methods
- future snapshot manifests

## Recommended Code Changes

Primary files:

- `src/acp/session.ts`
- `src/acp/session-manager.ts`
- `src/acp/server.ts`
- `src/acp/types.ts`

Recommended changes:

### `src/acp/session.ts`

- add explicit lifecycle state
- add `dispose()` support
- add idempotent cleanup path
- add internal resource registry
- make prompt/cancel lifecycle checks explicit

### `src/acp/session-manager.ts`

- add `disposeSession()`
- add `disposeAllSessions()`
- optionally add `listSessions()`

### `src/acp/server.ts`

- add `dispose()`
- wire future `session/close` easily, even if not added yet
- ensure background prompt handling respects disposed sessions

### `src/acp/types.ts`

- add lifecycle-related types only if they help shared ACP code
- keep private internals private when possible

## Testing Plan

Minimum new tests:

1. a session starts in `active`
2. prompt moves the session to `running` and back to `active`
3. prompt on a disposed session fails
4. dispose during idle transitions the session to `disposed`
5. dispose during running cancels the run and cleans up afterward
6. double dispose is safe
7. `disposeSession()` removes the session from `SessionManager`
8. `disposeAllSessions()` cleans every session

Recommended integration tests:

- background prompt + dispose race
- cancel followed by dispose
- failed cleanup surfaces an error

## Why This Comes Before Snapshots

Snapshots are session-scoped resources.

Without strong session lifecycle management:

- there is no safe place to initialize snapshot infrastructure
- there is no safe place to clean it up
- restore semantics cannot be anchored to a stable session owner
- session-end deletion becomes fragile

So the correct sequencing is:

1. strengthen ACP session management
2. add session-owned resource cleanup
3. attach snapshot infrastructure

## Recommended V1

The pragmatic first step is:

1. add lifecycle state to `ACPSession`
2. add `dispose()` to `ACPSession`
3. add `disposeSession()` and `disposeAllSessions()` to `SessionManager`
4. add `dispose()` to `ACPServer`
5. add tests for prompt/cancel/dispose transitions

Once that is in place, snapshot work can proceed on a stable lifecycle boundary.
