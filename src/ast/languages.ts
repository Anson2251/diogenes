import * as path from "path";

import type { ManagedGrammarLanguage } from "../utils/tree-sitter-asset-manager";

export type AstLanguageId = ManagedGrammarLanguage;

const EXTENSION_TO_LANGUAGE: Record<string, AstLanguageId> = {
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".mts": "typescript",
    ".cts": "typescript",
    ".tsx": "tsx",
    ".py": "python",
};

export function getAstLanguageForFilePath(filePath: string): AstLanguageId | null {
    const extension = path.extname(filePath).toLowerCase();
    return EXTENSION_TO_LANGUAGE[extension] ?? null;
}
