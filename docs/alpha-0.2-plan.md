# Alpha 0.2 Plan

Date: 2026-03-31

## Goal

Reduce first-run friction for CLI and ACP users without changing the core runtime model.

Alpha 0.2 should make Diogenes feel usable after:

- installing the package
- setting one provider API key
- running one obvious command

## Current Codebase Findings

These findings are based on the current implementation in `src/` and the current user-facing docs.

### What already exists

- first run already auto-generates managed `config.yaml`
- first run already auto-generates managed `models.yaml`
- default providers already exist for `openai`, `anthropic`, and `openrouter`
- CLI and ACP both already use provider-scoped API key resolution
- ACP is available through `diogenes acp`

Relevant files:

- `src/utils/config-bootstrap.ts`
- `src/cli.ts`
- `src/cli.ts`
- `src/utils/model-resolver.ts`

### What is causing friction

- docs currently teach `models.yaml` as a primary setup surface instead of an advanced override surface
- there is no `init`, `doctor`, or similar setup-oriented command
- there is no IDE/editor config installer for ACP clients
- ACP session snapshots are enabled by default and require `restic` at session creation time
- missing `restic` can fail ACP session startup instead of degrading gracefully

Relevant files:

- `README.md`
- `docs/acp-server.md`
- `src/config/default-prompts.ts`
- `src/acp/session-manager.ts`
- `src/snapshot/manager.ts`
- `src/utils/restic.ts`
- `tests/session-manager.test.ts`

## Product Direction

Alpha 0.2 should treat the following as the default happy path:

1. user installs Diogenes
2. user sets `OPENAI_API_KEY` or another provider key
3. user runs `diogenes` or connects an editor to `diogenes acp`
4. advanced config stays optional

This release should not try to redesign the runtime, ACP protocol layer, or snapshot architecture. It should focus on setup UX and failure behavior.

## Scope

### In scope

- reposition `models.yaml` as optional advanced config
- add setup and diagnostics commands
- make ACP usable without preinstalling `restic`
- document a clear first-run path for CLI and ACP
- provide editor integration templates or installers for common editors

### Out of scope

- replacing `restic` with a new snapshot backend
- changing the core tool model or workspace model
- broad ACP protocol expansion beyond setup-related improvements
- major LLM/provider abstraction redesign

## Planned Changes

### 1. Make zero-config model setup the primary path

Desired outcome:

- most users do not need to manually open or edit `models.yaml`
- users can succeed with only environment variables and defaults

Planned work:

- update README quick-start flow to lead with provider API key setup
- explicitly document that `models.yaml` is auto-generated on first run
- move detailed `models.yaml` editing guidance under an advanced section
- keep `models.yaml` for custom providers, custom base URLs, and model catalog overrides

Implementation notes:

- preserve current managed config generation in `src/utils/config-bootstrap.ts`
- avoid removing `models.yaml`; this release is about changing the default experience, not deleting configurability

### 2. Add setup-oriented CLI commands

Desired outcome:

- users can discover what is missing without reading source or guessing config paths

Planned commands:

- `diogenes doctor`
- `diogenes init`
- `diogenes config path`
- ACP local `/doctor`
- ACP local `/init`

Minimum `doctor` checks:

- managed config directory path
- managed data directory path
- whether `config.yaml` exists
- whether `models.yaml` exists
- which known provider API keys are configured
- whether `restic` is available
- whether ACP snapshots will be enabled or degraded

Minimum `init` behavior:

- ensure managed config files exist
- print config locations
- detect configured providers from environment variables
- explain the next successful CLI command
- explain the next successful ACP/editor integration step

Implementation candidates:

- `src/cli.ts`
- `src/utils/app-paths.ts`
- `src/utils/config-bootstrap.ts`
- a new helper for setup diagnostics under `src/utils/`

### 3. Remove `restic` as a default ACP startup blocker

Desired outcome:

- ACP should still start and create sessions when `restic` is missing
- snapshot features should degrade clearly instead of crashing setup

Planned behavior:

- when snapshot support is configured but `restic` is unavailable locally, Diogenes should first try to acquire it automatically
- if managed acquisition fails, ACP session creation should still not fail
- snapshot capability should be disabled for that session
- metadata and user-visible messaging should clearly state why snapshots are unavailable
- `doctor` should surface this before the user reaches the editor integration step

Implementation options:

1. Recommended for alpha 0.2: auto-download managed `restic` from GitHub releases
2. Fallback for alpha 0.2: graceful disable when acquisition fails
3. Possible later: bundled per-platform `restic`

Alpha 0.2 recommendation:

- add a managed `restic` acquisition path before snapshot initialization
- store the downloaded binary under Diogenes-managed local data rather than requiring `PATH` changes
- if download, extraction, permission setup, or verification fails, disable snapshots for that session and continue
- do not block alpha 0.2 on bundling binaries into the package

Suggested acquisition flow:

1. check configured `resticBinary` if explicitly provided
2. check `restic` from `PATH`
3. check for an already-downloaded managed binary in the Diogenes data directory
4. detect platform and architecture
5. download the matching GitHub release asset
6. extract and verify by running `restic version`
7. persist the managed binary path for future sessions
8. if any step fails, continue with snapshots disabled

Suggested storage layout:

- managed binaries under a subdirectory of the Diogenes local data dir
- per-version install paths so upgrades do not overwrite a binary in use
- platform-specific executable naming, including `.exe` on Windows

Implementation candidates:

- `src/acp/session-manager.ts`
- `src/snapshot/manager.ts`
- `src/utils/restic.ts`
- `src/utils/app-paths.ts`
- a new managed-downloader helper under `src/utils/`
- session metadata and ACP status surfaces in `src/acp/session.ts`

Test updates likely needed:

- managed binary discovery should be preferred after first successful download
- failed GitHub download should degrade cleanly
- downloaded binary should be verified before use
- Windows executable naming and path handling should be covered in tests
- ACP session creation should succeed without `restic`
- snapshot commands should report unavailable state clearly
- existing failure-path tests should be revised to match degraded behavior where appropriate

### 4. Add editor integration guidance and automation

Desired outcome:

- users do not need to hand-author ACP config for common editors

Planned deliverables:

- editor config templates in `docs/` or `examples/`
- one installation command or one print-config command for common editors

Possible command surface:

- `diogenes ide print-config vscode`
- `diogenes ide print-config cursor`
- `diogenes ide print-config zed`
- optional later: `diogenes ide install <editor>`

Alpha 0.2 recommendation:

- ship `print-config` first
- add direct file installation only if the editor config locations are stable enough across platforms

Implementation candidates:

- `src/cli.ts`
- new editor-template helpers under `src/utils/` or `src/acp/`
- new docs pages for editor setup

### 5. Rewrite the docs around a single happy path

Desired outcome:

- the first 5 minutes of docs match the easiest successful setup path

Planned doc changes:

- rewrite `README.md` quick start
- document `diogenes doctor` and `diogenes init`
- document that `models.yaml` is auto-generated and optional
- document snapshot degradation behavior when `restic` is missing
- add editor-specific ACP setup examples

Primary docs to update:

- `README.md`
- `docs/acp-server.md`
- `CHANGELOG.md`

New docs likely needed:

- `docs/editor-setup.md`
- `docs/setup-troubleshooting.md`

## Release Priorities

### Must do

- document auto-generated config and models behavior
- add `doctor`
- add `init`
- make ACP usable when `restic` is missing
- rewrite quick start around environment-variable-first setup

### Should do

- add `config path`
- add editor `print-config` support for at least one editor
- expose snapshot unavailability clearly in session/status surfaces

### Could do

- add direct editor config installation
- add richer environment diagnostics for more providers

## Risks

### Snapshot degradation may hide missing capability

If snapshots are silently disabled, users may assume restore exists when it does not.

Mitigation:

- make disabled state explicit in CLI and ACP status surfaces
- include exact reason text, such as `restic not found`

### Docs may drift from actual command behavior

The current docs already overemphasize manual config surfaces.

Mitigation:

- update docs in the same milestone as command changes
- keep examples aligned with tested command output

### Editor integration paths vary by editor and platform

Mitigation:

- start with `print-config`
- defer auto-install if platform-specific paths are too brittle for alpha 0.2

## Proposed Milestone Order

1. Add setup diagnostics and init command surface
2. Change ACP snapshot startup behavior to degrade without `restic`
3. Rewrite quick-start and setup docs
4. Add editor config templates and `print-config`

## Definition Of Done

Alpha 0.2 is successful if:

- a new user can run the CLI with only an API key and no manual config editing
- a new ACP/editor user can start a session without installing `restic`
- docs clearly distinguish default setup from advanced customization
- setup problems can be diagnosed with one built-in command
