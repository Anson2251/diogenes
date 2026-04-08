import type { Node } from "web-tree-sitter";
import type * as WebTreeSitter from "web-tree-sitter";

import * as fs from "fs";
import * as path from "path";

import type { AstCacheEntry } from "./cache";

import {
    TreeSitterAssetManager,
    type ManagedGrammarStatus,
} from "../utils/tree-sitter-asset-manager";
import { getAstLanguageForFilePath, type AstLanguageId } from "./languages";
import {
    extractSymbols,
    summarizeNode,
    type AstNodeSummary,
    type AstPosition,
    type AstSymbol,
} from "./symbols";

export type AstGrammarAvailability = "available" | "missing" | "unsupported" | "failed";

export interface AstGrammarStatus {
    language: AstLanguageId;
    availability: AstGrammarAvailability;
    grammarPath?: string;
    reason?: string;
}

export interface ParsedAstFile {
    path: string;
    absolutePath: string;
    language: AstLanguageId;
    totalLines: number;
    root: AstNodeSummary;
}

export interface AstSymbolMatchResult {
    status: "unique" | "missing" | "ambiguous";
    symbol?: AstSymbol;
    candidates?: AstSymbol[];
}

export interface AstNodeLookupResult {
    language: AstLanguageId;
    node: AstNodeSummary;
    parents: AstNodeSummary[];
}

export class AstServiceError extends Error {
    code: string;
    details?: Record<string, unknown>;

    constructor(code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "AstServiceError";
        this.code = code;
        this.details = details;
    }
}

export class AstService {
    private readonly assetManager: TreeSitterAssetManager;
    private readonly parserWasmPath: string;
    private readonly parserModulePromise: Promise<typeof WebTreeSitter>;
    private readonly parserInitPromise: Promise<void>;
    private readonly parsers: Map<AstLanguageId, WebTreeSitter.Parser> = new Map();
    private readonly languages: Map<AstLanguageId, Promise<WebTreeSitter.Language>> = new Map();
    private readonly cache: Map<string, AstCacheEntry> = new Map();

    constructor(assetManager: TreeSitterAssetManager) {
        this.assetManager = assetManager;
        this.parserWasmPath = this.resolveParserWasmPath();
        this.parserModulePromise = import("web-tree-sitter");
        this.parserInitPromise = this.initParser();
    }

    getSupportedLanguageForPath(filePath: string): AstLanguageId | null {
        return getAstLanguageForFilePath(filePath);
    }

    async getGrammarStatus(language: AstLanguageId): Promise<AstGrammarStatus> {
        const status = await this.assetManager.ensureGrammar(language);
        return mapGrammarStatus(status);
    }

    async parseFile(filePath: string): Promise<ParsedAstFile> {
        const entry = await this.getOrParseFile(filePath);
        return {
            path: filePath,
            absolutePath: entry.absolutePath,
            language: entry.language,
            totalLines: entry.totalLines,
            root: summarizeNode(entry.tree.rootNode),
        };
    }

    async listSymbols(filePath: string): Promise<AstSymbol[]> {
        const entry = await this.getOrParseFile(filePath);
        return extractSymbols(entry.language, filePath, entry.tree.rootNode);
    }

    async findSymbol(filePath: string, name: string, kind?: string): Promise<AstSymbolMatchResult> {
        const symbols = await this.listSymbols(filePath);
        const matches = symbols.filter(
            (symbol) => symbol.name === name && (!kind || symbol.kind === kind),
        );

        if (matches.length === 0) {
            return { status: "missing" };
        }
        if (matches.length > 1) {
            return { status: "ambiguous", candidates: matches };
        }
        return { status: "unique", symbol: matches[0] };
    }

    async getNodeAt(filePath: string, position: AstPosition): Promise<AstNodeLookupResult> {
        const entry = await this.getOrParseFile(filePath);
        const point = {
            row: Math.max(0, position.line - 1),
            column: Math.max(0, position.column || 0),
        };
        const leafNode = entry.tree.rootNode.namedDescendantForPosition(point);
        if (!leafNode) {
            throw new AstServiceError("AST_NODE_NOT_FOUND", `No AST node found at ${filePath}`);
        }

        const node = selectDisplayNode(leafNode);

        const parents: AstNodeSummary[] = [];
        let current = node.parent;
        while (current && current.type !== "program") {
            parents.push(summarizeParentNode(current));
            current = current.parent;
        }

        return {
            language: entry.language,
            node: summarizeNode(node),
            parents,
        };
    }

    private async getOrParseFile(filePath: string): Promise<AstCacheEntry> {
        const language = this.getSupportedLanguageForPath(filePath);
        if (!language) {
            throw new AstServiceError(
                "AST_UNSUPPORTED_LANGUAGE",
                `AST is not supported for ${filePath}`,
            );
        }

        const absolutePath = path.resolve(filePath);
        const stat = await fs.promises.stat(absolutePath);
        if (!stat.isFile()) {
            throw new AstServiceError("AST_PARSE_FAILED", `Path ${filePath} is not a file`);
        }

        const cached = this.cache.get(absolutePath);
        if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
            return cached;
        }

        const source = await fs.promises.readFile(absolutePath, "utf8");
        const parser = await this.getParser(language);
        const newTree = parser.parse(source);
        if (!newTree) {
            throw new AstServiceError("AST_PARSE_FAILED", `Failed to parse ${filePath}`);
        }

        if (cached) {
            cached.tree.delete();
        }

        const entry: AstCacheEntry = {
            absolutePath,
            language,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            totalLines: source.split("\n").length,
            source,
            tree: newTree,
            parsedAt: Date.now(),
        };
        this.cache.set(absolutePath, entry);
        return entry;
    }

    private async getParser(language: AstLanguageId): Promise<WebTreeSitter.Parser> {
        await this.parserInitPromise;
        const parserModule = await this.parserModulePromise;

        const existing = this.parsers.get(language);
        if (existing) {
            return existing;
        }

        const parser = new parserModule.Parser();
        parser.setLanguage(await this.getLanguage(language));
        this.parsers.set(language, parser);
        return parser;
    }

    private async getLanguage(language: AstLanguageId): Promise<WebTreeSitter.Language> {
        const existing = this.languages.get(language);
        if (existing) {
            return existing;
        }

        const loader = (async () => {
            let grammarPath = "";
            try {
                grammarPath = await this.assetManager.getGrammarPath(language);
                const parserModule = await this.parserModulePromise;
                return await parserModule.Language.load(grammarPath);
            } catch (error) {
                throw new AstServiceError(
                    "AST_GRAMMAR_LOAD_FAILED",
                    `Failed to load grammar ${language}: ${error instanceof Error ? error.message : String(error)}`,
                    { language, grammarPath },
                );
            }
        })();

        this.languages.set(language, loader);
        return loader;
    }

    private async initParser(): Promise<void> {
        const parserModule = await this.parserModulePromise;
        await parserModule.Parser.init({
            locateFile: () => this.parserWasmPath,
        });
    }

    private resolveParserWasmPath(): string {
        const entryPath = require.resolve("web-tree-sitter");
        return path.join(path.dirname(entryPath), "web-tree-sitter.wasm");
    }
}

function mapGrammarStatus(status: ManagedGrammarStatus): AstGrammarStatus {
    if (status.availability === "available" || status.availability === "downloaded") {
        return {
            language: status.language,
            availability: "available",
            grammarPath: status.grammarPath,
        };
    }

    return {
        language: status.language,
        availability: status.availability === "missing" ? "missing" : "failed",
        grammarPath: status.grammarPath,
        reason: status.reason,
    };
}

function summarizeParentNode(node: Node): AstNodeSummary {
    return {
        type: node.type,
        range: {
            start: node.startPosition.row + 1,
            end: node.endPosition.row + 1,
        },
    };
}

function selectDisplayNode(node: Node): Node {
    let current: Node | null = node;

    while (current?.parent && shouldSkipDisplayNode(current)) {
        current = current.parent;
    }

    return current ?? node;
}

function shouldSkipDisplayNode(node: Node): boolean {
    return (
        node.type === "identifier" ||
        node.type === "property_identifier" ||
        node.type === "type_identifier" ||
        node.type === "statement_block"
    );
}
