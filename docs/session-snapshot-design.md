# Session Snapshot Design

Date: 2026-03-26

## Goal

Add a session-scoped snapshot system that protects the codebase from unsafe LLM edits without turning Diogenes into a long-lived hidden-memory system.

The snapshot system should:

- create a snapshot automatically before each user prompt is executed
- allow the LLM to create additional defensive snapshots during a session
- snapshot the full workspace file tree
- optionally snapshot Diogenes session state together with the file tree
- delete all snapshots when the session ends

The snapshot system should not:

- let the LLM restore or delete snapshots
- become a durable cross-session memory layer
- silently restore hidden state without an explicit system or user action

## Design Summary

The recommended model is:

1. each ACP session owns a dedicated temporary snapshot repository
2. the repository stores full-workspace snapshots through `restic`
3. each snapshot may also include serialized Diogenes session state
4. the runtime creates one automatic snapshot before each `session/prompt`
5. the LLM may call a single tool, `snapshot.create`
6. restore and cleanup remain host-controlled operations
7. when the session ends, the temporary snapshot repository is removed

This keeps the system aligned with the safety goal: the LLM can create checkpoints, but it cannot roll the user backward on its own.

## Why `restic`

The workspace snapshot should cover the entire file tree, not just loaded files.

`restic` is a good fit because it already solves:

- recursive full-tree snapshots
- incremental storage
- deduplication
- snapshot enumeration
- snapshot restore

Diogenes should not reimplement file-tree backup semantics itself.

**Two-System Architecture**

The snapshot system uses two complementary layers:

1. **Restic (Repository Layer)**: Handles version control, encryption, deduplication, and cross-session persistence
2. **Transactional File Operations (Application Layer)**: Handles atomic workspace replacement with rollback support

Restic stores historical snapshots efficiently, but cannot provide atomic in-place replacement with gitignore preservation. The application layer implements transaction semantics using staging and rollback directories to ensure safe workspace replacement.

This separation allows:
- Restic to focus on what it does best (versioned, deduplicated storage)
- Application code to handle safety semantics (atomicity, gitignore preservation, error recovery)

## Snapshot Object

A session snapshot is a single logical object composed of two parts:

1. workspace snapshot
   - stored by `restic`
   - covers the entire session workspace root

2. session state snapshot
   - stored by Diogenes as serialized metadata
   - describes the Diogenes runtime state associated with the workspace snapshot

The two parts are linked by a manifest entry.

## Why Saving Diogenes State Is Acceptable

This design introduces some tension with the earlier MVP preference for in-memory session state only, but it does not fundamentally break the Diogenes design philosophy if the following rules are kept:

- snapshots are explicit objects
- snapshots are session-scoped and temporary
- snapshots are not used as a hidden memory layer
- restoring a snapshot is an explicit event
- the restored workspace remains the source of truth for file content

The important distinction is that this is a visible checkpoint system, not implicit persistence.

## Scope Boundary

The snapshot system is not the same thing as durable session restore.

It is intended for:

- defensive rollback
- debugging bad edits
- short-lived session checkpoints

It is not intended for:

- reconnecting to old sessions after arbitrary process restarts
- building long-term memory
- replacing the filesystem as the source of truth

## Repository Model

Each session should use its own temporary snapshot repository.

Recommended layout:

```text
<tmp>/diogenes-snapshots/
  <session-id>/
    repo/
    state/
    manifest.json
```

Where:

- `repo/` is the `restic` repository
- `state/` stores serialized Diogenes state files
- `manifest.json` records the logical snapshot entries

This is preferred over a shared repository because it avoids:

- cross-session cleanup complexity
- accidental deletion of another session's snapshots
- `forget`/`prune` coordination issues
- repo locking problems between unrelated sessions

When the session ends, the whole directory can be deleted.

## Snapshot Manifest

Suggested shape:

```ts
type SessionSnapshotManifest = {
  sessionId: string;
  cwd: string;
  createdAt: string;
  snapshots: SessionSnapshotEntry[];
};

type SessionSnapshotEntry = {
  snapshotId: string;
  createdAt: string;
  trigger: "before_prompt" | "llm_manual" | "system_manual";
  turn: number;
  label?: string;
  resticSnapshotId: string;
  diogenesStatePath?: string | null;
};
```

The manifest is the session-local source of truth for what snapshots exist.

## Diogenes State Shape

If session state is included, the saved payload should be minimal and explicit:

```ts
type PersistedDiogenesState = {
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
};
```

Important:

- save workspace selections, not duplicated full file text
- on restore, file contents should be reloaded from the restored filesystem
- do not treat serialized file content as authoritative

## Lifecycle

### 1. Session Creation

On `session/new`:

- create the ACP session as today
- create a dedicated temporary snapshot workspace for that session
- initialize the session manifest
- initialize a `SnapshotManager` bound to the session

### 2. Automatic Snapshot Before Prompt

Before executing each `session/prompt`:

- increment the prompt turn counter
- create a full `restic` snapshot of the workspace root
- serialize Diogenes state if state snapshots are enabled
- append a manifest entry with `trigger: "before_prompt"`

This automatic snapshot is the main safety baseline.

### 3. LLM-Created Snapshot

During a session, the LLM may call `snapshot.create`.

That tool should:

- create another full snapshot
- optionally attach a short LLM-provided label or reason
- record the snapshot in the same session manifest

The tool exists only to create additional defensive checkpoints before risky edits.

### 4. Session Restore

Restore is allowed only through the host system or explicit user control.

The LLM must not be able to invoke restore.

If restore is implemented, the flow should be:

1. stop the active run
2. restore the workspace from the chosen `restic` snapshot
3. create a fresh `DiogenesContextManager`
4. reload persisted workspace selections from the restored filesystem
5. restore todo, notepad, and message history if state restore is enabled
6. mark the restore as an explicit session event in logs or updates

### 5. Session End

When the session is disposed:

- stop any active run
- remove the entire temporary snapshot directory for that session
- clear in-memory references

This satisfies the requirement that session snapshots are deleted when the session closes.

## Permissions Model

The permission boundary is deliberate.

### LLM Permissions

Allowed:

- create a snapshot

Not allowed:

- restore a snapshot
- delete a snapshot
- manage the underlying repository directly

### Host Or User Permissions

Allowed:

- list session snapshots
- inspect snapshot metadata
- restore a snapshot
- delete session snapshots
- dispose the snapshot repository

This preserves the safety purpose of the system.

## Tool Surface

The LLM-facing tool surface should stay minimal.

Recommended tool:

```ts
snapshot.create({
  label?: string;
  reason?: string;
})
```

Recommended result:

```ts
{
  snapshot_id: string;
  created_at: string;
  trigger: "llm_manual";
  label?: string;
}
```

Do not expose:

- `snapshot.restore`
- `snapshot.delete`
- arbitrary `restic` command execution

Those operations are too powerful for the stated safety goal.

## Restore Semantics

If full session restore is supported, it must restore both:

- the file tree
- the Diogenes session state associated with that file tree

This avoids the worst form of mismatch between restored code and session memory.

However, restore should still recreate runtime state from persisted metadata rather than reviving in-memory objects directly.

In particular:

- rebuild `DiogenesContextManager`
- restore workspace selections
- reload file contents from the restored disk
- restore todo and notepad
- restore message history only if the product semantics explicitly define snapshot restore as session rollback

If product semantics later decide that only code should roll back, message history can be excluded. That is a product decision, not a technical requirement.

## Implementation Structure

Suggested additions:

```text
src/
  snapshot/
    manager.ts
    restic-client.ts
    manifest-store.ts
    state-serializer.ts
    types.ts
  tools/
    snapshot/
      snapshot-create.ts
```

Responsibilities:

`restic-client.ts`

- initialize repo
- create snapshot
- list snapshots
- restore snapshot

`state-serializer.ts`

- serialize Diogenes session metadata
- deserialize persisted metadata

`manifest-store.ts`

- read and write `manifest.json`
- append entries safely

`manager.ts`

- coordinate `restic`, state serialization, and manifest updates
- expose session-friendly operations
- clean up session snapshot storage

`snapshot-create.ts`

- the only LLM-facing snapshot tool

## Concrete TypeScript Interfaces

Suggested internal types:

```ts
type SnapshotTrigger = "before_prompt" | "llm_manual" | "system_manual";

type SnapshotCreateInput = {
  trigger: SnapshotTrigger;
  turn: number;
  label?: string;
  reason?: string;
};

type SnapshotCreateResult = {
  snapshotId: string;
  createdAt: string;
  trigger: SnapshotTrigger;
  turn: number;
  label?: string;
  resticSnapshotId: string;
  diogenesStatePath?: string | null;
};

type SnapshotRestoreInput = {
  snapshotId: string;
};

type SnapshotSummary = {
  snapshotId: string;
  createdAt: string;
  trigger: SnapshotTrigger;
  turn: number;
  label?: string;
};
```

Suggested `SnapshotManager` interface:

```ts
interface SnapshotManager {
  initialize(): Promise<void>;
  createSnapshot(input: SnapshotCreateInput): Promise<SnapshotCreateResult>;
  listSnapshots(): Promise<SnapshotSummary[]>;
  restoreSnapshot(input: SnapshotRestoreInput): Promise<void>;
  cleanup(): Promise<void>;
}
```

Suggested `ResticClient` interface:

```ts
interface ResticClient {
  initRepo(): Promise<void>;
  backup(paths: string[]): Promise<{ snapshotId: string }>;
  snapshots(): Promise<Array<{ id: string; time: string }>>;
  restore(snapshotId: string, target: string): Promise<void>;
}
```

Suggested `DiogenesStateSerializer` interface:

```ts
interface DiogenesStateSerializer {
  serialize(params: {
    cwd: string;
    diogenes: DiogenesContextManager;
    messageHistory: ConversationMessage[];
    createdAt: string;
    updatedAt: string;
  }): Promise<{ statePath: string }>;

  deserialize(statePath: string): Promise<PersistedDiogenesState>;
}
```

## ACP Integration Points

Recommended wiring:

- `SessionManager.createSession()` creates a `SnapshotManager`
- `ACPSession.prompt()` creates the automatic pre-prompt snapshot before calling `runTaskLoop()`
- `ACPSession` owns the prompt turn counter used in snapshot metadata
- session disposal triggers snapshot cleanup

This keeps snapshot orchestration at the ACP session boundary, which is the right lifecycle owner.

### ACPSession Changes

`ACPSession` should gain:

```ts
private snapshotManager: SnapshotManager;
private promptTurn = 0;
```

Recommended prompt flow:

1. validate session is idle
2. increment `promptTurn`
3. call `snapshotManager.createSnapshot({ trigger: "before_prompt", turn: promptTurn })`
4. if snapshot creation fails, reject the prompt
5. proceed to `runTaskLoop()`
6. retain the existing cancellation flow

Recommended disposal flow:

1. cancel active run if needed
2. call `snapshotManager.cleanup()`
3. clear session references

### SessionManager Changes

`SessionManager` should gain explicit disposal support:

```ts
disposeSession(sessionId: string): Promise<boolean>;
disposeAllSessions(): Promise<void>;
```

This is needed so session-end cleanup has a defined lifecycle hook instead of relying only on process exit.

### DiogenesContextManager Changes

`DiogenesContextManager` does not need to become snapshot-aware.

Keep the snapshot boundary outside the core runtime:

- snapshot state is collected by reading existing public getters
- restore rebuilds a fresh context manager and rehydrates it

This is preferable to teaching the runtime about `restic`.

## State Extraction And Rehydration

The serializer should read only explicit, already-visible state.

### Extraction

Use:

- `ACPSession.messageHistory`
- `diogenes.getWorkspaceManager().getDirectoryWorkspace()`
- `diogenes.getWorkspaceManager().getFileWorkspace()`
- `diogenes.getWorkspaceManager().getTodoWorkspace()`
- `diogenes.getWorkspaceManager().getNotepadWorkspace()`

Persist:

- loaded directory paths only
- loaded file paths plus ranges only
- todo items
- notepad lines
- message history

Do not persist:

- watcher handles
- loaded file text as the source of truth
- internal prompt-builder token counters
- live LLM client objects

### Rehydration

Restore should rebuild state in this order:

1. create a new `DiogenesContextManager`
2. restore todo items
3. restore notepad lines
4. reload directories by path
5. reload files by path and range from disk
6. inject restored `messageHistory` into the owning session

This order keeps the restored runtime consistent with the restored filesystem.

## Restic Execution Model

`restic` should be wrapped as a narrow infrastructure dependency.

Recommended command model:

- `restic init`
- `restic backup <cwd>`
- `restic snapshots --json`
- `restic restore <snapshot-id> --target <dir>`

The wrapper should be responsible for:

- setting `RESTIC_REPOSITORY`
- setting `RESTIC_PASSWORD` or `RESTIC_PASSWORD_FILE`
- normalizing stdout and stderr
- converting failures into typed application errors

Do not expose raw shell command composition to the LLM.

### Restore Strategy

Prefer restore into a staging directory first, then replace the workspace contents in a controlled step.

Reason:

- direct in-place restore increases the chance of partial state if restore fails midway
- staging makes validation easier
- staging makes it easier to preserve or explicitly remove ignored transient files

**Transactional Replacement**

The workspace replacement is implemented as a file-system level transaction to ensure atomicity:

```
1. Identify gitignored files/directories (to preserve them)
2. Backup non-gitignored entries to `<session-temp>/restore-staging/rollback-<uuid>`
3. Delete non-gitignored entries from workspace
4. Copy staged restore entries to workspace
5. Delete rollback directory on success

On failure:
  1. Clean workspace (non-gitignored entries only)
  2. Restore from rollback directory
  3. Gitignored files remain untouched throughout
```

This ensures:
- **Atomicity**: Either fully restored or fully rolled back
- **Gitignore preservation**: Files listed in `.gitignore` are never deleted during restore
- **Safety**: Rollback provides a recovery path if anything fails

**Suggested restore flow:**

1. restore snapshot into `<session-temp>/restore-staging`
2. validate that the restored root looks sane
3. **transactionally replace workspace contents** (with rollback support)
4. rebuild `DiogenesContextManager`
5. rehydrate session state

This is more work than in-place restore, but safer.

## Failure Handling

Automatic snapshots should be treated as a required safety feature, not best-effort decoration.

Recommended behavior:

- if automatic pre-prompt snapshot creation fails, reject the prompt turn
- surface the failure clearly to the user or client
- do not continue into a risky edit session without the configured safety checkpoint

Possible future option:

- a config flag may allow degraded execution without snapshots for local development

But the default safety behavior should be strict.

## Configuration

Suggested config shape:

```ts
type SnapshotConfig = {
  enabled: boolean;
  includeDiogenesState: boolean;
  autoBeforePrompt: boolean;
  storageRoot: string;
  resticBinary: string;
  passwordEnvVar?: string;
};
```

Notes:

- `enabled` gates the whole feature
- `includeDiogenesState` controls whether session metadata is serialized
- `autoBeforePrompt` should default to `true`
- `storageRoot` should default to a temp directory
- `resticBinary` should default to `restic`

Recommended config location:

```ts
type SecurityConfig = {
  // existing fields...
  snapshot?: SnapshotConfig;
};
```

This keeps the feature grouped with other execution-safety controls.

## Tool Definition

Recommended tool definition:

```ts
{
  namespace: "snapshot",
  name: "create",
  description: "Create a defensive session snapshot before risky work",
  params: {
    label: { type: "string", optional: true, description: "Short label for the snapshot" },
    reason: { type: "string", optional: true, description: "Why this snapshot is useful" }
  },
  returns: {
    snapshot_id: "Session-local snapshot identifier",
    created_at: "Creation timestamp",
    trigger: "Snapshot trigger type"
  }
}
```

Recommended behavior:

- always maps to `trigger: "llm_manual"`
- does not accept repository paths or low-level restore parameters
- fails fast if session snapshots are disabled

## User-Facing ACP Semantics

Even if restore is host-controlled, ACP clients should still be able to display snapshot-related events.

Recommended future session updates:

- `snapshot_created`
- `snapshot_restore_started`
- `snapshot_restore_completed`
- `snapshot_restore_failed`

For v1, `snapshot.create` can rely on normal tool-call updates and does not require a new ACP event type immediately.

## Testing Plan

Minimum tests for v1:

1. creates an automatic snapshot before each prompt
2. rejects prompt execution if required auto snapshot creation fails
3. allows the LLM to create a manual snapshot through `snapshot.create`
4. records manifest entries with the correct turn and trigger
5. deletes the session snapshot directory on session disposal
6. restores a snapshot into a fresh runtime and reloads workspace selections correctly
7. does not allow the LLM to invoke restore

Recommended test layers:

- unit tests for `manifest-store`
- unit tests for `state-serializer`
- unit tests for `SnapshotManager`
- ACP integration tests for prompt lifecycle wiring

## Delivery Plan

Recommended implementation order:

### Phase 1

- add `snapshot/types.ts`
- add `manifest-store.ts`
- add `state-serializer.ts`
- add `SnapshotManager` with a mockable `ResticClient`
- add session lifecycle hooks and auto-before-prompt snapshot creation

### Phase 2

- add `snapshot.create` tool
- surface snapshot creation results in ACP tool updates
- add config plumbing and validation

### Phase 3

- add host-controlled restore flow
- add session disposal API
- rehydrate restored session state into a fresh runtime

### Phase 4

- add richer ACP session updates for restore lifecycle
- add CLI or host admin commands for manual restore and inspection

## Open Questions

Questions still to settle:

- should message history be restored or intentionally cleared after a snapshot restore
- should restore be exposed only in ACP host logic or also through a dedicated CLI command
- should snapshot creation be available outside ACP sessions
- should state snapshots be mandatory or configurable per session

## Recommended V1

The most pragmatic v1 is:

1. session-scoped temporary `restic` repo
2. automatic snapshot before each prompt
3. one LLM tool: `snapshot.create`
4. serialized Diogenes state stored alongside each snapshot
5. no LLM restore
6. session-end cleanup by deleting the whole temp snapshot directory

This version is small, explicit, and consistent with the stated goal of protecting the codebase from unsafe LLM edits.
