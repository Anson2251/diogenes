# Tree-Sitter API Design

Date: 2026-04-01

## Goal

Define the internal AST service API and the first public AST-backed `file.*` tool contracts before implementation.

This document is intentionally focused on interfaces and behavior, not parser internals.

## Design Principles

- keep tree-sitter as an internal service layer
- keep the public tool surface under `file.*`
- return compact, inspectable structures rather than raw AST dumps
- preserve the current workspace model and line-based file loading
- treat unsupported-language behavior as normal and explicit, not exceptional runtime corruption

## Internal Service Boundary

### Proposed module boundary

```txt
src/ast/
  service.ts
  languages.ts
  cache.ts
  symbols.ts

src/utils/
  tree-sitter-asset-manager.ts
```

### Main service interface

```ts
export interface AstService {
  getSupportedLanguageForPath(filePath: string): AstLanguageId | null;
  getGrammarStatus(language: AstLanguageId): Promise<AstGrammarStatus>;
  parseFile(filePath: string): Promise<ParsedAstFile>;
  listSymbols(filePath: string, options?: ListSymbolsOptions): Promise<AstSymbol[]>;
  findSymbol(filePath: string, name: string, options?: FindSymbolOptions): Promise<AstSymbolMatchResult>;
  getNodeAt(filePath: string, position: AstPosition): Promise<AstNodeLookupResult>;
}
```

The tool layer should only consume this interface and should not depend on parser-specific classes.

### Asset manager interface

```ts
export interface TreeSitterAssetManager {
  ensureStorageReady(): Promise<void>;
  ensureGrammar(language: AstLanguageId): Promise<ManagedGrammarStatus>;
  getGrammarPath(language: AstLanguageId): Promise<string>;
  getManifest(): Promise<TreeSitterManifest>;
}
```

`AstService` should depend on `TreeSitterAssetManager` for grammar acquisition and local path resolution.

The asset manager should own CDN fallback behavior. `AstService` should only care about obtaining a local grammar path.

## Core Internal Types

### Language identity

```ts
export type AstLanguageId = "typescript" | "tsx" | "javascript";
```

This should stay intentionally small in phase 1.

### Position and range

```ts
export interface AstPosition {
  line: number;
  column: number;
}

export interface AstLineRange {
  start: number;
  end: number;
}

export interface AstByteRange {
  start: number;
  end: number;
}
```

Tools should expose line ranges, not byte ranges. Byte ranges may still be useful internally.

### Parsed file model

```ts
export interface ParsedAstFile {
  path: string;
  absolutePath: string;
  language: AstLanguageId;
  sourceHash?: string;
  totalLines: number;
  root: AstNodeSummary;
}
```

The parsed file model should not expose raw tree-sitter node objects outside the service.

### Node summary

```ts
export interface AstNodeSummary {
  type: string;
  range: AstLineRange;
  byteRange?: AstByteRange;
  textPreview?: string;
}
```

### Symbol model

```ts
export type AstSymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "variable"
  | "export";

export interface AstSymbol {
  name: string;
  kind: AstSymbolKind;
  language: AstLanguageId;
  path: string;
  range: AstLineRange;
  exported?: boolean;
  detail?: string;
  parentName?: string;
}
```

`detail` is optional and should be short. Examples:

- `async function`
- `const arrow function`
- `export class`

### Grammar status

```ts
export type AstGrammarAvailability =
  | "available"
  | "missing"
  | "unsupported"
  | "failed";

export interface AstGrammarStatus {
  language: AstLanguageId;
  availability: AstGrammarAvailability;
  grammarPath?: string;
  reason?: string;
}

export interface ManagedGrammarStatus {
  language: AstLanguageId;
  grammarPath?: string;
  sourceUrl?: string;
  sourceHost?: string;
  availability: "available" | "downloaded" | "missing" | "failed";
  reason?: string;
}

export interface TreeSitterManifest {
  version: number;
  package: string;
  packageVersion: string;
  grammars: Record<string, {
    file: string;
    sourceUrl: string;
    sourceHost: string;
    downloadedAt: string;
    size: number;
  }>;
}
```

## Error Model

The service should normalize failures into a small set of semantic cases.

### Proposed service error codes

```ts
export type AstServiceErrorCode =
  | "AST_UNSUPPORTED_LANGUAGE"
  | "AST_GRAMMAR_MISSING"
  | "AST_GRAMMAR_DOWNLOAD_FAILED"
  | "AST_GRAMMAR_LOAD_FAILED"
  | "AST_PARSE_FAILED"
  | "AST_SYMBOL_NOT_FOUND"
  | "AST_SYMBOL_AMBIGUOUS"
  | "AST_NODE_NOT_FOUND";
```

### Proposed service error shape

```ts
export interface AstServiceError extends Error {
  code: AstServiceErrorCode;
  details?: Record<string, unknown>;
}
```

The tool layer can map these to the existing `ToolResult` error structure.

## Service Methods

### `getSupportedLanguageForPath`

Purpose:

- determine whether a file extension is eligible for AST support

Behavior:

- returns `null` when the file extension is not supported in phase 1
- does not verify grammar presence on disk

### `getGrammarStatus`

Purpose:

- report whether the grammar for a supported language is locally available and loadable

Behavior:

- should not parse a file
- may consult `TreeSitterAssetManager` for local availability status without forcing a full parse

### `parseFile`

Purpose:

- parse a supported file and return a normalized parsed-file representation

Behavior:

- resolves language from file extension
- ensures grammar availability
- performs parsing synchronously as part of the current AST-backed request
- reparses when cached data is stale
- throws normalized service errors on failure

### `listSymbols`

Purpose:

- extract compact symbol information from a supported file

Suggested options:

```ts
export interface ListSymbolsOptions {
  kinds?: AstSymbolKind[];
  includeNested?: boolean;
}
```

Phase-1 recommendation:

- default `includeNested` to `false`

### `findSymbol`

Purpose:

- resolve a symbol by name for `file.load_symbol`

Suggested options:

```ts
export interface FindSymbolOptions {
  kind?: AstSymbolKind;
  includeNested?: boolean;
}
```

Suggested result:

```ts
export interface AstSymbolMatchResult {
  status: "unique" | "missing" | "ambiguous";
  symbol?: AstSymbol;
  candidates?: AstSymbol[];
}
```

Recommended behavior:

- exact-name matching only in phase 1
- return ambiguity explicitly instead of guessing

### `getNodeAt`

Purpose:

- identify the syntax node containing a given position

Suggested result:

```ts
export interface AstNodeLookupResult {
  language: AstLanguageId;
  node: AstNodeSummary;
  parents: AstNodeSummary[];
}
```

Recommended parent chain behavior:

- nearest parent first
- omit root-level noise when it does not add value
- keep the chain short and inspectable

## Tool Contracts

The public tool layer should remain stable even if the internal parser implementation evolves.

## `file.symbols`

### Purpose

- list main declarations in a file for syntax-aware navigation

### Params

```ts
{
  path: string;
  kinds?: string[];
}
```

### Result

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

### Tool error behavior

- unsupported extension -> clear tool error explaining that AST support is unavailable for this file type
- supported extension but missing grammar -> clear tool error explaining that local grammar assets are unavailable
- parse failure -> clear tool error with the file path and a concise reason

### Output design notes

- sort by source order
- keep results compact
- avoid returning raw node text except when needed for disambiguation later

## `file.load_symbol`

### Purpose

- load the exact line range of a named symbol into the current file workspace

### Params

```ts
{
  path: string;
  name: string;
  kind?: string;
}
```

### Result

```ts
{
  language: string;
  symbol: {
    name: string;
    kind: string;
    start: number;
    end: number;
    exported?: boolean;
    detail?: string;
  };
  loaded_range: [number, number];
  total_lines: number;
}
```

### Tool error behavior

- no symbol match -> return a normal tool error with `AST_SYMBOL_NOT_FOUND`
- ambiguous symbol name -> return a tool error with candidate names and ranges
- workspace load failure -> return existing file-load style error semantics

### Design notes

- this tool should convert AST range to normal file workspace range
- this tool should not create a separate AST workspace

## `file.node_at`

### Purpose

- tell the model what syntax node contains a specific source position

### Params

```ts
{
  path: string;
  line: number;
  column?: number;
}
```

### Result

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

### Tool error behavior

- out-of-range position -> normal tool error
- unsupported language -> normal tool error
- parse failure -> normal tool error

### Design notes

- `text_preview` should be short and safe for prompt use
- this tool is primarily for starting from diagnostics, suspicious lines, or repeated patterns

## Formatting Expectations

Tool results should be optimized for:

- compact LLM consumption
- readable CLI display
- easy human inspection in ACP logs or replay

Recommended formatting style:

- one symbol per line in CLI formatter for `file.symbols`
- show `name`, `kind`, and `start-end`
- avoid large embedded snippets by default

## Caching Contract

The cache contract should remain internal but the behavior should be stable.

Expected behavior:

- repeated symbol lookups on unchanged files should reuse parsed data
- stale cache should be invalidated based on file metadata
- cache invalidation should not change visible workspace state

Suggested internal cache shape:

```ts
export interface AstCacheEntry {
  absolutePath: string;
  language: AstLanguageId;
  mtimeMs: number;
  size: number;
  totalLines: number;
  parsedAt: number;
}
```

The actual parser tree can stay in implementation-specific memory structures.

## Non-Goals For This API

This design intentionally does not define:

- raw AST dump APIs
- generic tree queries exposed to the model
- tree-sitter query language exposure
- AST-backed code rewrite contracts
- semantic analysis beyond syntax structure

Those can be revisited later if phase-1 usage proves a need.

## Review Questions

These are the main questions to answer during design review:

1. Is `AstService` the right internal boundary, or should grammar management be a separate injectable dependency?
2. Is the phase-1 symbol model too narrow or too broad?
3. Should `file.load_symbol` support nested symbols in phase 1?
4. Is the ambiguity contract for repeated symbol names sufficient?
5. Should any AST diagnostic surface be exposed beyond these three tools in phase 1?

## Recommendation

The recommended phase-1 API is:

- internal `AstService` with normalized parsed-file, symbol, and node lookup APIs
- public `file.symbols`
- public `file.load_symbol`
- public `file.node_at`

This keeps the external model simple while preserving room to evolve the internal parser implementation later.
