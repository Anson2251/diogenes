# Tree-Sitter Integration Plan

Date: 2026-04-01

## Goal

Reduce the "blind editing" problem by giving Diogenes a structured view of source files without changing the core file-first tool model.

The first release should let the model answer questions such as:

- what top-level symbols exist in this file
- which function or class contains this line
- load the exact symbol body instead of guessing a line range

This should improve navigation and edit targeting while preserving the current explicit workspace model.

## Current Codebase Findings

These findings are based on the current implementation under `src/`.

### What already exists

- file access and workspace state are already explicit through `file.load`, `file.peek`, `file.edit`, and `file.unload`
- file loading is line-range based and integrates with workspace watchers
- `file.edit` already has a strong text-anchor workflow for small edits
- tool registration is centralized and simple in `src/create-diogenes.ts`
- managed runtime assets already have a precedent through the local storage layout used for sessions and restic

Relevant files:

- `src/tools/file/file-load.ts`
- `src/tools/file/file-peek.ts`
- `src/tools/file/file-edit.ts`
- `src/context/workspace.ts`
- `src/create-diogenes.ts`
- `src/utils/restic-manager.ts`

### What is causing friction

- the model currently navigates files by line ranges and text anchors rather than syntax structure
- the model can only infer whether a region is a function, class, object literal, JSX subtree, or import block
- `file.edit` can be precise, but precision depends on the model first finding and copying the right local text context
- repeated patterns in code make anchor selection ambiguous
- there is no tool that exposes symbols, parent nodes, or syntax-aware ranges

## Product Direction

Diogenes should stay file-first, not compiler-first.

That means:

- tree-sitter should be an internal runtime capability, not a primary user-facing abstraction
- the main public surface should remain under `file.*`
- AST-backed tools should return compact, human-inspectable results instead of raw parser dumps
- the first release should focus on structured reading and navigation, not AST rewriting

Recommended approach:

1. integrate `web-tree-sitter` with wasm grammars as a runtime service
2. expose a small number of AST-backed `file.*` tools
3. keep actual file writes on `file.edit` for the first phase
4. use AST ranges to help the model load the right content before editing

## Scope

### In scope

- integrate `web-tree-sitter` in the Node runtime
- store wasm grammars in Diogenes-managed local storage under `storage/tree-sitter/`
- download missing grammars on demand from a pinned upstream source list with mirror fallback
- support a small initial language set focused on TypeScript and JavaScript
- add AST-backed file navigation tools
- cache parse results and refresh them when files change
- document failure behavior when grammar support is unavailable

### Out of scope

- AST-based write tools such as `file.replace_node` or `file.edit_symbol`
- full raw AST query tools exposed directly to the model
- broad multi-language support in the first pass
- dynamic resolution of `latest` grammar versions at runtime
- replacing the current line-based workspace model

## Runtime Architecture

### 1. Add an AST service layer

Add a new internal module under `src/ast/` that owns parser lifecycle, grammar resolution, and syntax queries.

Suggested structure:

```txt
src/ast/
  service.ts
  cache.ts
  languages.ts
  symbols.ts
```

Recommended responsibilities:

- `languages.ts`: map file extensions to grammar ids and wasm file names
- `service.ts`: initialize `web-tree-sitter`, load grammars, parse files, expose query helpers
- `cache.ts`: track parser instances and parsed trees by file path
- `symbols.ts`: extract compact symbol data for supported languages

The tool layer should depend on `AstService`, not on `web-tree-sitter` directly.

### 2. Use wasm grammars from managed local storage

Store grammar assets alongside other runtime-managed data, not inside session state.

Recommended layout:

```txt
storage/
  sessions/
  tree-sitter/
    grammars/
      tree-sitter-typescript.wasm
      tree-sitter-tsx.wasm
      tree-sitter-javascript.wasm
    manifest.json
```

Why this layout is recommended:

- grammars are shared runtime assets, not session-specific data
- multiple sessions can reuse one local grammar cache
- session cleanup should not affect parser resources
- future updates to grammars remain independent from session snapshots

Suggested runtime lookup order:

1. explicit config override if later added
2. managed local storage under `storage/tree-sitter/`
3. pinned on-demand download into managed local storage through `TreeSitterAssetManager`
4. if unavailable, disable AST-backed tools for that language with a clear error

### 3. Keep AST state separate from workspace state

`WorkspaceManager` should continue to own:

- path validation
- file loading and unloading
- directory loading
- watch lifecycle
- visible workspace state

`AstService` should own:

- parser initialization
- tree caching
- node lookup
- symbol extraction

`TreeSitterAssetManager` should own:

- grammar registry
- grammar version policy
- local grammar cache paths
- manifest management
- on-demand grammar download and recovery

This separation avoids overloading `workspace.ts` with parser-specific concerns.

## Tool Plan

The first release should add a minimal set of AST-backed file tools.

### 1. `file.symbols`

Purpose:

- list the main symbols in a file so the model can navigate by structure instead of by line guessing

Suggested params:

```ts
{
  path: string;
  kinds?: string[];
}
```

Suggested result shape:

```ts
{
  language: string;
  symbols: Array<{
    name: string;
    kind: string;
    start: number;
    end: number;
    exported?: boolean;
    detail?: string;
  }>;
}
```

Initial symbol kinds should focus on:

- function
- class
- interface
- type
- enum
- const or variable declarations with clear names
- export assignments or export declarations where practical

### 2. `file.load_symbol`

Purpose:

- load the line range for a named symbol into the existing file workspace

Suggested params:

```ts
{
  path: string;
  name: string;
  kind?: string;
}
```

Suggested behavior:

- resolve the symbol from the AST service
- convert its node range to line numbers
- call the existing workspace file loader with that range
- return both symbol metadata and the loaded range

This tool preserves the current visible workspace model while making selection syntax-aware.

### 3. `file.node_at`

Purpose:

- explain what syntax node contains a given line and column

Suggested params:

```ts
{
  path: string;
  line: number;
  column?: number;
}
```

Suggested result shape:

```ts
{
  language: string;
  node: {
    type: string;
    start: number;
    end: number;
    text_preview: string;
  };
  parents: Array<{
    type: string;
    start: number;
    end: number;
  }>;
}
```

This is especially useful when the model starts from a line number or an error location and needs surrounding structural context.

### Not planned for phase 1

Do not add these in the first pass:

- `file.ast`
- `ast.query`
- `file.edit_symbol`
- `file.replace_node`

These add surface area and complexity before the core navigation benefits are proven.

## Language Support Plan

### Phase 1 languages

Start with:

- `.ts` -> TypeScript grammar
- `.tsx` -> TSX grammar
- `.js` -> JavaScript grammar
- `.jsx` -> JavaScript grammar or JSX-capable grammar depending on package choice

Rationale:

- the repository itself is TypeScript-heavy
- these languages cover the main authoring surface for Diogenes users and this codebase
- symbol extraction is relatively straightforward compared to more irregular formats

### Later languages

Possible follow-up languages:

- JSON
- Python
- Go
- Rust
- YAML
- TOML

These should only be added after the initial service and tool model are stable.

## Parsing and Caching Strategy

### Initial implementation

The first implementation should prefer correctness and simplicity over maximum parser sophistication.

Recommended behavior:

- lazily initialize `web-tree-sitter` once per process
- lazily load each grammar once when first needed
- parse entire files on demand
- cache parsed results by absolute path, file size, and modified time
- invalidate and reparsed cached entries when the file changes on disk

This is sufficient for a first release because the main value comes from syntax-aware navigation, not incremental editing.

### Watch integration

The existing watcher model should remain the source of truth for visible workspace refresh.

AST cache invalidation should be simpler:

- when a file-backed AST tool runs, compare current file metadata against the cache entry
- if the file changed, reparse before answering
- do not try to reflect AST state directly into workspace state

This keeps the two systems loosely coupled.

## Managed Asset Initialization

The first implementation should avoid background prefetch. Grammar acquisition and parsing should both happen synchronously when an AST-backed tool actually needs a file.

Recommended initial asset flow:

1. define an internal whitelist of supported grammars and pinned source URLs
2. when an AST-backed tool is called, ensure `storage/tree-sitter/grammars/` exists
3. if the needed grammar is not cached locally, download it into managed storage
4. load the grammar from managed storage
5. parse the requested file synchronously and answer the tool call
6. write or update `manifest.json` to record installed grammars and their pinned package version

This keeps runtime behavior deterministic while avoiding hidden background work.

Possible later enhancement:

- add hybrid support for bundled core grammars plus on-demand download for less common languages

## Implementation Plan

### 1. Add core AST service modules

Planned files:

- `src/ast/service.ts`
- `src/ast/languages.ts`
- `src/ast/cache.ts`
- `src/ast/symbols.ts`

Key tasks:

- initialize `web-tree-sitter`
- define extension-to-grammar mapping
- add wasm path resolution under managed storage
- parse files and expose symbol and node helpers

### 2. Add managed grammar asset support

Implementation candidates:

- `src/utils/app-paths.ts`
- a new helper such as `src/utils/tree-sitter-asset-manager.ts`

Key tasks:

- resolve the tree-sitter storage directory
- define the supported grammar registry, pinned version constants, and source fallback list
- ensure grammar files exist locally or can be downloaded on demand
- support manifest creation and inspection
- expose deterministic local paths for wasm loading

### 3. Add AST-backed file tools

Planned files:

- `src/tools/file/file-symbols.ts`
- `src/tools/file/file-load-symbol.ts`
- `src/tools/file/file-node-at.ts`

Key tasks:

- define zod schemas
- produce compact tool results that fit the current tool style
- integrate with `WorkspaceManager` where line-range loading is needed
- register the tools in `src/create-diogenes.ts`

### 4. Update prompts and docs

Key docs and prompt surfaces:

- `README.md`
- `src/config/default-prompts.ts`
- possibly `docs/alpha-0.2-plan.md` if release scope is being tracked there

Prompt updates should teach the model:

- use `file.symbols` before guessing large structures in supported languages
- use `file.load_symbol` to bring a whole function or class into workspace
- use `file.node_at` when starting from an error line or suspicious location
- continue using `file.edit` for actual writes in phase 1

## Testing Plan

### Unit coverage

Add tests for:

- extension-to-grammar mapping
- grammar asset discovery and initialization
- symbol extraction from representative TypeScript and TSX files
- node lookup by line and column
- cache invalidation after file changes

### Tool coverage

Add tests for:

- `file.symbols` on supported and unsupported file types
- `file.load_symbol` for unique and ambiguous symbol names
- `file.node_at` on valid and out-of-range locations
- failure messages when grammar assets are missing or unavailable

### Integration coverage

Add task-flow tests showing:

1. model lists file symbols
2. model loads one symbol into workspace
3. model performs a normal `file.edit`

The point of the integration tests is to verify that AST-backed reading improves the existing editing workflow instead of replacing it.

## Risks and Tradeoffs

### 1. Tool sprawl

Risk:

- too many new AST tools could make the prompt heavier and confuse tool choice

Mitigation:

- start with only three tools
- keep them under `file.*`
- avoid raw query and rewrite tools in phase 1

### 2. Grammar asset distribution complexity

Risk:

- on-demand grammar acquisition adds network dependency on first use

Mitigation:

- keep grammar source URLs pinned to one package version
- cache grammars locally after first acquisition
- keep normal file tools fully usable without AST support

### 3. Incomplete language coverage

Risk:

- AST-backed behavior will initially be better for TypeScript than for other languages

Mitigation:

- make unsupported-language failures explicit and non-fatal
- keep existing file tools fully usable without AST support

### 4. Temptation to overbuild AST writes too early

Risk:

- adding syntax-aware write tools too soon will expand scope and create harder-to-debug failure modes

Mitigation:

- keep phase 1 read-only
- evaluate write tools only after navigation quality is proven in real task flows

## Recommended Phase Order

### Phase 1

- add `AstService`
- add managed grammar asset support
- support TS, TSX, and JS grammars
- ship `file.symbols`
- ship `file.load_symbol`
- ship `file.node_at`

### Phase 2

- improve symbol extraction quality
- add more language support
- refine prompt guidance and result formatting based on usage
- consider a lightweight diagnostics command for grammar availability

### Phase 3

- evaluate whether AST-backed write helpers are actually needed
- evaluate whether syntax-pattern search warrants a later `ast-grep` integration

## Recommendation

The recommended first implementation is:

1. use `web-tree-sitter` with wasm grammars
2. store grammars under managed local storage in `storage/tree-sitter/`
3. keep tree-sitter as an internal service layer
4. expose only a small set of AST-backed `file.*` tools
5. use AST for navigation first and keep writes on `file.edit`

This gives Diogenes a structural view of code without abandoning its current explicit workspace and file-tool model.
