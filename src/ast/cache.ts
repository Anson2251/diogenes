import type { Tree } from "web-tree-sitter";

import type { AstLanguageId } from "./languages";

export interface AstCacheEntry {
    absolutePath: string;
    language: AstLanguageId;
    mtimeMs: number;
    size: number;
    totalLines: number;
    source: string;
    tree: Tree;
    parsedAt: number;
}
