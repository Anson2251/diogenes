# ACP Integration Plan

This document records the current assessment for integrating Diogenes with ACP, the Agent Client Protocol.

Date: 2026-03-26

## Summary

Diogenes is a good candidate for ACP integration.

Much of the original integration plan is now implemented in `src/acp/`.

Current implemented ACP shape includes:

- stdio JSON-RPC transport
- `initialize`, `session/new`, `session/load`, `session/list`, `session/prompt`, `session/cancel`, and `session/restore`
- managed persisted sessions with replayable ACP-visible history
- session-scoped snapshots and host-controlled restore
- Diogenes-specific ACP extension methods under `_diogenes/session/*`
- discoverable ACP-local slash commands exposed through `available_commands_update`

This document is still useful as architectural background, but `docs/acp-server.md` is the better reference for current behavior.

The project already has most of the runtime pieces needed for an ACP agent:

- a task execution loop
- a structured tool registry
- explicit workspace state
- streamed model output
- CLI entrypoints for both autonomous and step-by-step operation

What it does not have yet is a protocol adapter. Today, Diogenes is a local runtime with a CLI. ACP integration would add a transport and session layer so editors and other ACP clients can drive the agent programmatically.

The recommended path is:

1. keep the current runtime intact
2. add a dedicated ACP adapter layer under `src/acp/`
3. start with a minimal stdio-based ACP server
4. map existing runtime events into structured ACP session updates
5. defer interactive user-elicitation features until the base session flow is stable

## What ACP Is

ACP, Agent Client Protocol, is a protocol for communication between a client such as an editor or IDE and an agent runtime.

At a high level:

- the client starts or connects to an agent
- the client opens a session
- the client sends prompts and context
- the agent streams progress and results back as structured events

The protocol is conceptually close to LSP in shape:

- JSON-RPC 2.0 messages
- session-oriented lifecycle
- structured notifications and requests
- transport commonly over stdio

Relevant references:

- ACP overview: https://agentclientprotocol.com/protocol/overview
- ACP schema: https://agentclientprotocol.com/protocol/schema
- ACP GitHub organization: https://github.com/agentclientprotocol
- TypeScript SDK: https://agentclientprotocol.github.io/typescript-sdk/
- GitHub Copilot CLI ACP server reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server

## Why ACP Fits Diogenes

Diogenes already models the world in a way that is compatible with ACP:

- it has a long-lived execution model
- it already separates the agent runtime from the terminal UI reasonably well
- it exposes tool execution clearly
- it has inspectable workspace state
- it can stream incremental output from the LLM client

This means ACP integration is mostly an architectural adaptation, not a product pivot.

## Current Runtime Shape

Relevant current modules:

- `src/index.ts`
  - `createDiogenes`
  - `executeTask`
- `src/context/index.ts`
  - `DiogenesContextManager`
- `src/context/workspace.ts`
  - file, directory, todo, and notepad state
- `src/tools/`
  - tool implementations
- `src/llm/openai-client.ts`
  - streaming OpenAI-compatible client
- `src/cli.ts`
  - default mode, interactive mode, and socratic mode

From an ACP point of view, the main issue is not missing agent logic. The issue is that the current public interface is shaped for a terminal process, not for a protocol client.

## Architectural Gap

### What Diogenes Already Has

- model invocation
- streamed model chunks
- task loop
- workspace management
- tool execution
- terminal interaction support

### What ACP Requires That Diogenes Does Not Yet Expose Cleanly

- a JSON-RPC transport
- protocol initialization
- session creation and session ownership
- structured progress events
- protocol-level cancellation
- structured final results
- explicit client-to-agent message mapping

## Recommended Architecture

Add a new ACP layer without rewriting the existing runtime.

Suggested top-level structure:

```text
src/
  acp/
    server.ts
    transport.ts
    session-manager.ts
    session.ts
    adapters/
      logger-to-acp.ts
      context-to-acp.ts
      tool-results-to-acp.ts
    types.ts
```

### Design Principle

ACP should be an adapter over the runtime, not a second runtime.

That means:

- `DiogenesContextManager` remains the core runtime object
- ACP sessions create and own a context manager instance
- ACP transport code never reaches into file editing or workspace internals directly unless necessary
- terminal-specific formatting stays out of ACP responses

## Session Model

A reasonable first mapping is:

- one ACP session maps to one `DiogenesContextManager`
- one ACP prompt turn maps to one execution request against that session
- session-local workspace state persists across prompts unless explicitly reset

This is a better fit than mapping every prompt to a fresh runtime, because Diogenes already benefits from persistent workspace state.

## Proposed ACP Session Lifecycle

### Phase 1: Initialize

The ACP server starts and handles protocol initialization.

At this stage it should advertise:

- server name and version
- supported transports
- supported session capabilities
- any limitations in the MVP implementation

### Phase 2: New Session

The client creates a session.

The server should:

- create a new `DiogenesContextManager`
- apply config derived from launch options or client-supplied configuration
- create per-session logger/event bindings
- return a stable session identifier

### Phase 3: Prompt Session

The client sends a prompt or task into the session.

The server should:

- transform the ACP prompt payload into a Diogenes task request
- execute the task loop
- stream incremental updates back to the client
- return a final completion or failure result

### Phase 4: Cancel

The client cancels the active run.

The server should:

- cancel the active model request if possible
- stop further tool execution for the current turn
- emit a structured cancellation update

### Phase 5: Session Update

During execution, the client should receive structured updates instead of terminal text.

Examples:

- model started
- model produced text
- tool call parsed
- tool execution started
- tool execution completed
- context warning emitted
- task completed

## Event Mapping

Today, a lot of Diogenes execution feedback flows through terminal-oriented logging.

ACP integration should not forward terminal-formatted strings. It should produce structured events.

### Current Sources Of Execution Feedback

- `Logger` events
- tool execution results
- parse errors
- context warnings
- final task completion result

### Recommended Refactor

Introduce a protocol-neutral event model first, then adapt it to:

- terminal logger output
- ACP session updates

Suggested internal event categories:

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

This refactor will pay off even if ACP work stops halfway, because it improves separation between the runtime and CLI presentation.

## Tooling And Interaction Considerations

### `task.ask` And `task.choose`

These tools are currently designed around terminal interaction.

That does not map cleanly to ACP by default.

For the MVP ACP server:

- do not expose `task.ask`
- do not expose `task.choose`

Instead:

- disable them in ACP sessions
- document that interactive elicitation is not yet supported

Later, if ACP elicitation or client-mediated user input is added, these tools can be revisited or replaced by a protocol-native mechanism.

### `task.notepad`

This tool fits ACP well because it is session-local state, not terminal behavior.

### Shell Execution

`shell.exec` can remain available, but ACP integration should be explicit about risk.

At minimum:

- honor current security config
- report command execution as structured updates
- make sure the client can distinguish command output from model output

## Workspace Mapping

Diogenes has an explicit workspace model that should remain internal to the runtime.

ACP does not require the protocol client to understand Diogenes workspace internals, but the session updates should expose enough structured information for a client to present useful progress.

For MVP:

- keep the current prompt-building strategy internal
- expose coarse-grained workspace summaries through session updates

Possible session update payloads:

- directories loaded count
- files loaded count
- total loaded lines
- notepad line count
- recent tool result summary

Do not try to mirror the entire prompt text into ACP events in the first version.

## Cancellation

ACP support is not credible without real cancellation semantics.

Current foundation:

- `OpenAIClient` already uses `AbortController`

Needed work:

- keep one active run token per ACP session
- expose cancellation through the ACP session layer
- propagate cancellation into model streaming
- make tool execution stop cleanly between tool calls

For the first implementation, cooperative cancellation is acceptable:

- abort model streaming immediately
- stop before the next tool call if tool execution is already in progress

## Error Handling

ACP clients need structured failures, not terminal prose.

That means:

- parse errors should be returned as machine-readable failures plus concise human-readable text
- tool failures should be surfaced as tool execution events
- session-level fatal errors should end the active run without necessarily destroying the session

The session should survive a bad turn when possible.

## MVP Scope

The first ACP implementation should be intentionally narrow.

Most of this MVP has now been exceeded.

### In Scope

- stdio transport
- JSON-RPC handling
- initialize flow
- session creation
- session loading and listing
- session prompt execution
- session updates for progress and completion
- cancellation
- existing non-interactive tools
- OpenAI-compatible LLM backend using the current client
- session-scoped snapshots
- host-controlled snapshot restore
- persisted managed session state

### Out Of Scope

- TCP transport
- protocol-native user elicitation
- multi-agent orchestration
- rich client-side workspace mirroring
- protocol support for every possible future Diogenes runtime event

## Current ACP-Specific Behaviors

### Session Persistence

ACP sessions are no longer in-memory only.

The current model is:

- session metadata is persisted under managed local storage
- lightweight state is persisted separately from snapshots
- `session/load` reconstructs a live session and replays ACP-visible history through `session/update`
- empty sessions with no messages are deleted on close instead of being kept as empty persisted records

### Session Extensions

In addition to standard ACP methods, Diogenes exposes host-oriented extensions:

- `_diogenes/session/get`
- `_diogenes/session/snapshots`
- `_diogenes/session/dispose`
- `_diogenes/session/delete`
- `_diogenes/session/prune`
- `_diogenes/session/restore`

Custom capability advertisement and custom payload fields live under `_meta.diogenes`.

### Local Slash Commands

ACP sessions also expose local slash commands for host/session features that should not depend on an LLM turn.

Current commands:

- `/help` and `/commands`
- `/session` and `/status`
- `/restore`
- `/snapshots`
- `/snapshot`

These commands are advertised through `available_commands_update` notifications and persisted `availableCommands` metadata.

### Restore Model

Restore is intentionally split across two layers:

- the ACP host performs actual restore by calling `session/restore` or `_diogenes/session/restore`
- the ACP session layer may explain restore through `/restore`, but cannot perform it directly

This keeps restore host-controlled while still making the workflow discoverable inside an ACP client.

## Suggested Implementation Order

### Step 1: Internal Event Layer

Refactor execution so structured runtime events exist independently from terminal logging.

This is the highest leverage step.

### Step 2: ACP Session Abstraction

Add a session object that wraps:

- `DiogenesContextManager`
- run state
- cancellation state
- event subscribers

### Step 3: ACP Stdio Server

Add stdio transport and minimum ACP message handling.

### Step 4: Prompt Execution Adapter

Map ACP session prompts into the existing Diogenes task execution loop.

### Step 5: Cancellation

Wire ACP cancel requests into the active model request and task loop.

### Step 6: Protocol Polishing

Improve event payloads, error surfaces, and configuration handling.

## Risks

### Risk: Logger-Centric Runtime

Some runtime feedback is still optimized for terminal presentation.

Mitigation:

- introduce structured internal events before deep ACP work

### Risk: Interactive Tool Semantics

`task.ask` and `task.choose` are terminal-native today.

Mitigation:

- disable them for ACP initially

### Risk: Tight Coupling Between Prompt Assembly And Execution

The current runtime strongly assumes internal prompt assembly.

Mitigation:

- keep that behavior for MVP
- only abstract prompt/resource boundaries once the ACP path is working

### Risk: Cancellation During Tool Chains

Tool execution is sequential and some tools may have side effects.

Mitigation:

- support cancellation between tool calls first
- avoid overpromising immediate interruption of every tool

## Recommendation

Proceed with ACP integration.

The best next step is not to start with wire protocol code. The best next step is to add a protocol-neutral event model and a session abstraction. Once those exist, an ACP stdio server should be relatively straightforward.

## Proposed Next Document

After this document, the next useful artifact should be:

- `docs/acp-mvp-design.md`

That document should define:

- concrete ACP methods to support in v1
- exact request and response mapping
- session state transitions
- internal interfaces needed in `src/acp/`
- test strategy for ACP server behavior
