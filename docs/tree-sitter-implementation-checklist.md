# Tree-Sitter Implementation Checklist

Date: 2026-04-01

## Purpose

This checklist turns `docs/tree-sitter-integration-plan.md` into an execution-oriented implementation sequence.

The focus is still phase-1 read-only AST support:

- syntax-aware navigation
- syntax-aware file loading
- no AST-backed writes yet

## Exit Criteria For Phase 1

Phase 1 is complete when all of the following are true:

- Diogenes can resolve managed tree-sitter storage paths
- Diogenes can load wasm grammars for supported languages from local managed storage
- Diogenes can parse `.ts`, `.tsx`, and `.js` files on demand
- `file.symbols` returns useful top-level symbols for supported files
- `file.load_symbol` loads the correct line range into workspace for unique symbols
- `file.node_at` returns the containing node and a compact parent chain
- unsupported files fail clearly without breaking normal file tools
- relevant tests cover path resolution, grammar loading, parsing, and tool behavior

## Phase 1 Work Breakdown

### 1. Storage Layout And Asset Policy

Status target:

- managed tree-sitter storage exists independently of sessions

Checklist:

- define managed storage layout under `storage/tree-sitter/`
- define `grammars/` subdirectory naming
- define `manifest.json` format for local grammar metadata
- define the pinned upstream package source list and version constants
- define first-use download flow into managed storage
- define behavior when a grammar file is missing or unreadable

Decisions to lock:

- grammar assets are shared runtime resources, not session state
- grammar assets are not included in session snapshots
- phase 1 uses pinned on-demand downloads, not `latest`
- phase 1 uses a pinned CDN fallback list, not arbitrary hosts

Primary files likely affected later:

- `src/utils/app-paths.ts`
- a new `src/utils/tree-sitter-manager.ts`

### 2. Dependency And Packaging Strategy

Status target:

- runtime and bundling strategy are explicit before implementation starts

Checklist:

- add `web-tree-sitter` as the runtime parser dependency
- define the pinned upstream package version and CDN fallback policy
- define how build and bundle outputs coexist with managed grammar downloads
- define how CLI and ACP entrypoints both locate the same managed grammar storage
- define expected behavior when running from source versus built output

Decisions to lock:

- JS code may be bundled, grammar wasm remains a runtime asset
- tools should never require explicit grammar loading from the model

### 3. AST Service Skeleton

Status target:

- one internal service owns parser and grammar lifecycle

Checklist:

- create `src/ast/` module boundary
- define `AstService` public interface
- define `TreeSitterAssetManager` public interface
- define extension-to-language mapping
- define parser cache structure
- define parsed-file cache structure
- define error model for unsupported language, missing grammar, parse failure, and missing file
- define initialization policy for `Parser.init()` and per-language lazy loading

Primary files likely affected later:

- `src/ast/service.ts`
- `src/ast/languages.ts`
- `src/ast/cache.ts`
- `src/ast/symbols.ts`

### 4. Language Mapping And Symbol Extraction

Status target:

- supported languages return compact, consistent symbol lists

Checklist:

- define grammar ids for `.ts`, `.tsx`, `.js`, `.jsx`
- define a normalized symbol model used by tools
- define extraction rules for top-level declarations
- define exported symbol detection where practical
- define ambiguity behavior when multiple symbols share the same name
- decide whether nested methods are included in phase 1 or deferred

Recommended phase-1 symbol kinds:

- function
- class
- interface
- type
- enum
- variable
- export

Recommended phase-1 simplification:

- prioritize top-level declarations
- skip deep semantic interpretation that requires type analysis

### 5. File Tool Surface

Status target:

- AST capability is exposed through a minimal `file.*` surface

Checklist:

- define `file.symbols`
- define `file.load_symbol`
- define `file.node_at`
- define exact result shapes and error shapes for each tool
- define compact formatting for CLI display and LLM formatting
- define how each tool behaves for unsupported extensions
- define how each tool behaves when grammar assets exist but parsing fails

Decisions to lock:

- do not add raw `ast.*` tools in phase 1
- do not add AST-backed write tools in phase 1
- `file.load_symbol` should reuse existing workspace loading rather than inventing parallel context storage

### 6. Registration And Runtime Wiring

Status target:

- AST tools can be registered like other tools without special-case plumbing in the model loop

Checklist:

- define how `createDiogenes()` constructs `AstService`
- define how AST tools receive both `WorkspaceManager` and `AstService`
- define whether `AstService` should be exposed from the public package entrypoint
- define whether runtime diagnostics need any user-facing surfacing in phase 1

Primary files likely affected later:

- `src/create-diogenes.ts`
- `src/index.ts`

### 7. Prompt And Documentation Updates

Status target:

- the model is taught when to use AST-backed tools and when not to use them

Checklist:

- add brief guidance for `file.symbols`
- add brief guidance for `file.load_symbol`
- add brief guidance for `file.node_at`
- explain that writes still go through `file.edit`
- update README or advanced docs only after tool semantics stabilize

Prompt rules to preserve:

- use AST tools to navigate supported languages
- use normal file tools for unsupported languages
- prefer compact context loads over raw AST dumps

### 8. Test Plan

Status target:

- phase-1 behavior is covered at unit and tool level

Checklist:

- add path-resolution tests for tree-sitter storage directories
- add grammar-manager tests for local asset initialization
- add grammar-manager tests for pinned URL generation and manifest behavior
- add grammar-manager tests for mirror fallback from `unpkg.com` to `npm.elemecdn.com`
- add language-mapping tests
- add symbol extraction tests for TS, TSX, and JS fixtures
- add `file.symbols` tool tests
- add `file.load_symbol` tool tests
- add `file.node_at` tool tests
- add failure-path tests for unsupported language and missing grammar
- add one task-flow integration test proving AST reads improve normal file editing flow

### 9. Rollout Constraints

Status target:

- implementation stays bounded and reviewable

Checklist:

- keep phase 1 read-only from the AST perspective
- keep grammar downloads pinned and whitelist-driven
- avoid integrating ast-grep in the same milestone
- avoid refactoring `WorkspaceManager` beyond what is necessary for reuse
- avoid exposing parser-internal types directly in public tool results

## Suggested Review Order

Review work in this order:

1. storage and packaging policy
2. `AstService` API surface
3. normalized symbol model
4. `file.*` tool APIs
5. tests and prompt guidance

This order reduces the chance of redoing tool contracts after runtime details change.

## Open Questions To Resolve Before Coding

These should be explicitly answered before implementation starts:

1. Should `.jsx` use the same grammar path as `.js` in phase 1, or should it wait until JSX-specific behavior is verified?
2. Should `file.symbols` include nested class methods in phase 1, or only top-level declarations?
3. For `file.load_symbol`, should ambiguous symbol names hard-fail or return candidates?
4. Should the initial implementation stay strictly synchronous on AST tool calls, or is there any later need for optional prefetch?
5. Should `AstService` be public API in `src/index.ts`, or remain internal until stabilized?

## Recommended Initial Milestone

If the work should be split into small reviewable PRs, the cleanest order is:

1. storage-path and grammar-manager scaffolding only
2. `TreeSitterAssetManager` plus pinned download policy only
3. `AstService` plus language mapping only
4. `file.symbols`
5. `file.load_symbol` and `file.node_at`
6. prompt and docs updates

This keeps the first visible user-facing surface small while still proving the architecture.
