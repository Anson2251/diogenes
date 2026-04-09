# Tree-Sitter WASM Management

Date: 2026-04-01

## Goal

Define how Diogenes acquires, stores, validates, and loads tree-sitter wasm grammars for AST-backed file tools.

The management model should be:

- simpler than the existing `restic` acquisition path
- deterministic across CLI and ACP entrypoints
- explicit about local state and failure reasons
- flexible enough to support additional languages later

## Recommendation

The recommended phase-1 strategy is:

1. use `web-tree-sitter`
2. download grammar wasm files on demand from a fixed package version using a managed CDN fallback list
3. cache them under Diogenes-managed local storage in `storage/tree-sitter/`
4. record local grammar state in `manifest.json`
5. always load grammars from local managed storage, never directly from remote URLs

This is recommended over a restic-style acquisition flow because tree-sitter grammars are plain wasm assets:

- no platform-specific asset selection is needed
- no archive extraction is needed
- no executable permission changes are needed
- no binary execution is needed for verification

## Why A Download Mechanism Is Reasonable

The `tree-sitter-wasms` package currently exposes language wasm files with stable per-file URLs.

Example package root:

- `https://unpkg.com/tree-sitter-wasms@0.1.13/out/`
- `https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/`

Example grammar URLs:

- `https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm`
- `https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-tsx.wasm`
- `https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm`
- `https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm`
- `https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-tsx.wasm`
- `https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm`

Because each grammar is an ordinary static wasm file, Diogenes can fetch exactly the file it needs without any platform branching.

Recommended source policy:

- try `unpkg.com` first as the primary upstream CDN
- if that fails, retry with `npm.elemecdn.com`

This is especially useful for users in mainland China, where `unpkg.com` can be slow or unavailable.

## Scope

### In scope

- fixed-version grammar download from a known package source
- local caching of downloaded grammars
- manifest-based bookkeeping
- synchronous acquisition during the first AST-backed request that needs a grammar
- reuse across multiple sessions and entrypoints
- clear failure reporting when a grammar cannot be downloaded or loaded

### Out of scope

- downloading arbitrary grammar URLs supplied by the model
- resolving the latest version dynamically at runtime
- including grammar files in session snapshots
- user-facing grammar management tools in phase 1
- integrity-signature infrastructure beyond basic metadata checks in phase 1

## Storage Layout

Recommended local storage layout:

```txt
storage/
  sessions/
  tree-sitter/
    manifest.json
    grammars/
      tree-sitter-javascript.wasm
      tree-sitter-typescript.wasm
      tree-sitter-tsx.wasm
```

Why this layout is recommended:

- grammars are shared runtime assets, not session data
- multiple sessions can reuse the same local cache
- pruning session state should not affect grammars
- session restore should not need to restore runtime assets

## Versioning Strategy

Phase 1 should use one pinned upstream package version.

Recommended config constants:

```ts
const TREE_SITTER_WASMS_PACKAGE = "tree-sitter-wasms";
const TREE_SITTER_WASMS_VERSION = "0.1.13";
const TREE_SITTER_WASMS_SOURCE_BASE_URLS = [
  `https://unpkg.com/${TREE_SITTER_WASMS_PACKAGE}@${TREE_SITTER_WASMS_VERSION}/out`,
  `https://npm.elemecdn.com/${TREE_SITTER_WASMS_PACKAGE}@${TREE_SITTER_WASMS_VERSION}/out`,
];
```

Important rule:

- do not fetch `latest`
- do not resolve version numbers dynamically at runtime
- do not allow arbitrary CDN hosts outside the internal source list

This keeps behavior deterministic and reviewable.

### Why this differs from `restic`

Diogenes should not treat tree-sitter grammars and `restic` as the same kind of managed asset.

Recommended distinction:

- `restic` is an external executable dependency
- tree-sitter grammars are runtime semantic assets

Why `restic` can reasonably prefer the latest compatible release:

- it is an external CLI boundary rather than part of Diogenes prompt semantics
- newer upstream releases can improve OS and platform compatibility without requiring Diogenes source changes
- Diogenes primarily depends on command availability and stable command-line behavior, not on `restic` internals

Why tree-sitter grammars should stay pinned:

- grammar changes can directly affect AST node shapes, symbol extraction, and node boundaries
- those changes can alter `file.symbols`, `file.load_symbol`, and `file.node_at` behavior
- using a fixed grammar version makes AST-backed tool behavior easier to reproduce, test, and debug

In short:

- `restic` should optimize for availability across machines
- tree-sitter grammars should optimize for deterministic runtime behavior

## Supported Grammar Registry

Grammar downloads should only be allowed through an internal whitelist.

Suggested phase-1 registry shape:

```ts
export interface ManagedGrammarDefinition {
  language: string;
  fileName: string;
  sourceUrls: string[];
  extensions: string[];
}
```

Example entries:

```ts
[
  {
    language: "javascript",
    fileName: "tree-sitter-javascript.wasm",
    sourceUrls: [
      "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm",
      "https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-javascript.wasm",
    ],
    extensions: [".js", ".jsx", ".mjs", ".cjs"],
  },
  {
    language: "typescript",
    fileName: "tree-sitter-typescript.wasm",
    sourceUrls: [
      "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm",
      "https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm",
    ],
    extensions: [".ts", ".mts", ".cts"],
  },
  {
    language: "tsx",
    fileName: "tree-sitter-tsx.wasm",
    sourceUrls: [
      "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-tsx.wasm",
      "https://npm.elemecdn.com/tree-sitter-wasms@0.1.13/out/tree-sitter-tsx.wasm",
    ],
    extensions: [".tsx"],
  },
];
```

This registry should be internal and owned by the runtime, not by the model.

## Manifest Format

The manifest should record what is present locally and where it came from.

Suggested phase-1 format:

```json
{
  "version": 1,
  "package": "tree-sitter-wasms",
  "packageVersion": "0.1.13",
  "grammars": {
    "typescript": {
      "file": "grammars/tree-sitter-typescript.wasm",
      "sourceUrl": "https://unpkg.com/tree-sitter-wasms@0.1.13/out/tree-sitter-typescript.wasm",
      "sourceHost": "unpkg.com",
      "downloadedAt": "2026-04-01T12:00:00.000Z",
      "size": 2450000
    }
  }
}
```

Phase-1 recommended fields:

- manifest version
- upstream package name
- upstream package version
- grammar file relative path
- source URL
- source host
- download timestamp
- file size

Possible later additions:

- checksum
- last-verified timestamp
- local state flags for corruption recovery

## Manager Responsibilities

Introduce a dedicated internal asset manager.

Suggested name:

- `TreeSitterAssetManager`

Suggested responsibilities:

- resolve the tree-sitter storage directory
- maintain the managed grammar registry
- read and write `manifest.json`
- ensure a grammar exists locally before parser load
- download missing grammars from the managed source URL list
- write downloads safely using temporary files and atomic rename
- provide deterministic local paths to `AstService`

Suggested high-level interface:

```ts
export interface TreeSitterAssetManager {
  ensureStorageReady(): Promise<void>;
  ensureGrammar(language: string): Promise<ManagedGrammarStatus>;
  getGrammarPath(language: string): Promise<string>;
  getManifest(): Promise<TreeSitterManifest>;
}
```

## Download Flow

Recommended grammar acquisition flow:

1. determine the required grammar from file extension
2. check whether the language is supported by the internal registry
3. ensure `storage/tree-sitter/` and `storage/tree-sitter/grammars/` exist
4. read `manifest.json` if present
5. check whether the expected wasm file exists locally
6. if the file exists, return the local path
7. if the file is missing, fetch it from the first reachable URL in the pinned source list
8. write the download to a temporary file in the same directory
9. rename the temporary file to the final wasm path atomically
10. update `manifest.json`
11. return the local wasm path to the AST service

Phase-1 timing rule:

- do not prefetch grammars in the background
- do not parse files speculatively
- acquire the grammar and parse the file only when an AST-backed tool explicitly requests that file

Important implementation rules:

- never load wasm directly from the network URL
- never let the model specify the URL or grammar file name
- always use a temp file before finalizing a download
- only update the manifest after the file is fully written
- retry the next configured mirror before failing the acquisition

## Failure Handling

Failures should be explicit and categorized.

Recommended failure categories:

- unsupported language
- storage initialization failed
- grammar download failed
- grammar file missing after download
- grammar load failed
- manifest read or write failed

Recommended behavior:

- AST-backed tools should fail clearly for the requested file
- normal non-AST file tools should continue to work unchanged
- a failed download should not poison future runs permanently if the file can be retried later

## Corruption And Retry Strategy

Phase 1 should support simple self-healing behavior.

Recommended behavior:

- if manifest says a grammar exists but the file is missing, redownload it
- if a download is interrupted, the temp file should be ignored or cleaned up next time
- if grammar load fails, surface the error clearly and leave the file in place for manual inspection or future repair

Possible later enhancement:

- delete and redownload if checksum validation fails

## Concurrency Considerations

Multiple sessions may attempt to acquire the same grammar concurrently.

Phase-1 recommended behavior:

- keep downloads idempotent
- use per-language in-process locking where practical
- write through temp files and atomic rename
- tolerate the case where another process finishes the download first

The main goal is to avoid partially written wasm files becoming visible as final assets.

## Interaction With `AstService`

The AST service should not know how to download grammars.

Recommended division of responsibilities:

- `TreeSitterAssetManager`: resolve and ensure local grammar asset
- `AstService`: load wasm from a local path, initialize parser, parse file, answer queries

Suggested flow:

1. tool requests AST info for a file
2. `AstService` determines the needed language
3. `AstService` asks `TreeSitterAssetManager` for the local grammar path
4. asset manager downloads if needed and returns the local path
5. `AstService` loads the wasm via `web-tree-sitter`
6. tool returns normalized result data

## Security And Control

Recommended constraints:

- only allow downloads from the pinned internal source host list
- only allow downloads for an internal whitelist of supported grammars
- do not expose arbitrary network fetching through the tool surface
- do not let model prompts modify the grammar source URL

If a future config option is added for advanced users, it should remain outside the normal model tool surface.

## CLI And ACP Behavior

The managed grammar cache should be shared by:

- `diogenes`
- `diogenes acp`
- any internal runtime path that uses the same app data directory

This means:

- the first successful grammar download benefits later sessions automatically
- ACP and CLI should not manage separate grammar caches
- AST-backed behavior should be consistent across entrypoints

## Observability

Phase 1 does not require a user-facing grammar management command, but local state should still be inspectable in logs and docs.

Useful internal log events later:

- grammar cache hit
- grammar missing locally
- grammar download started
- grammar download finished
- grammar download failed
- grammar loaded successfully

Possible later UX additions:

- `diogenes doctor` can report installed grammars
- `diogenes init` can mention first-use grammar download behavior

## Tradeoffs

### Benefits

- smaller package size than bundling many grammars directly
- simpler than platform-specific binary management
- easy to extend to new languages later
- deterministic local caching after first acquisition
- reproducible AST behavior across machines running the same Diogenes version

### Costs

- first use of a new language may require network access
- AST-backed features can fail in offline environments if the grammar is not already cached
- package-source availability becomes relevant for first-time grammar acquisition

## Optional Hybrid Strategy

If desired later, Diogenes can adopt a hybrid model:

- bundle a small core grammar set for JS and TS
- download less common grammars on demand

This is not necessary for phase 1, but the asset manager design should not block it.

## Recommended Phase-1 Decision

The recommended phase-1 wasm management policy is:

1. pin `tree-sitter-wasms` to one version
2. maintain an internal whitelist of supported grammars
3. download missing grammar files on demand from a pinned CDN fallback list: `unpkg.com` first, `npm.elemecdn.com` second
4. cache them under `storage/tree-sitter/grammars/`
5. track them in `manifest.json`
6. load only from local cached files
7. fail AST-backed tools clearly when acquisition or loading fails

This gives Diogenes a simple, maintainable wasm management path that is materially easier than the current `restic` binary acquisition model.
