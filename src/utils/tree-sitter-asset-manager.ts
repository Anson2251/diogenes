import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { ensureDiogenesAppDirs, type DiogenesAppPaths } from "./app-paths";

export const TREE_SITTER_WASMS_PACKAGE = "@vscode/tree-sitter-wasm";
export const TREE_SITTER_WASMS_VERSION = "0.3.0";
export const TREE_SITTER_WASMS_SOURCE_BASE_URLS = [
    `https://unpkg.com/${TREE_SITTER_WASMS_PACKAGE}@${TREE_SITTER_WASMS_VERSION}/wasm`,
    `https://npm.elemecdn.com/${TREE_SITTER_WASMS_PACKAGE}@${TREE_SITTER_WASMS_VERSION}/wasm`,
] as const;

export type ManagedGrammarLanguage = "javascript" | "typescript" | "tsx" | "python";

export interface ManagedGrammarDefinition {
    language: ManagedGrammarLanguage;
    fileName: string;
    sourceUrls: string[];
    extensions: string[];
}

export interface ManagedGrammarStatus {
    language: ManagedGrammarLanguage;
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
    grammars: Record<
        string,
        {
            file: string;
            sourceUrl: string;
            sourceHost: string;
            downloadedAt: string;
            size: number;
        }
    >;
}

export interface TreeSitterAssetManagerOptions {
    appPaths?: DiogenesAppPaths;
    fetchImpl?: typeof fetch;
}

const MANIFEST_VERSION = 1;

const treeSitterManifestEntrySchema = z.object({
    file: z.string(),
    sourceUrl: z.string(),
    sourceHost: z.string(),
    downloadedAt: z.string(),
    size: z.number(),
});

const treeSitterManifestSchema = z.object({
    version: z.number().optional(),
    package: z.string().optional(),
    packageVersion: z.string().optional(),
    grammars: z.record(z.string(), treeSitterManifestEntrySchema).optional(),
});

const MANAGED_GRAMMARS: Record<ManagedGrammarLanguage, ManagedGrammarDefinition> = {
    javascript: {
        language: "javascript",
        fileName: "tree-sitter-javascript.wasm",
        sourceUrls: TREE_SITTER_WASMS_SOURCE_BASE_URLS.map(
            (baseUrl) => `${baseUrl}/tree-sitter-javascript.wasm`,
        ),
        extensions: [".js", ".jsx", ".mjs", ".cjs"],
    },
    typescript: {
        language: "typescript",
        fileName: "tree-sitter-typescript.wasm",
        sourceUrls: TREE_SITTER_WASMS_SOURCE_BASE_URLS.map(
            (baseUrl) => `${baseUrl}/tree-sitter-typescript.wasm`,
        ),
        extensions: [".ts", ".mts", ".cts"],
    },
    tsx: {
        language: "tsx",
        fileName: "tree-sitter-tsx.wasm",
        sourceUrls: TREE_SITTER_WASMS_SOURCE_BASE_URLS.map(
            (baseUrl) => `${baseUrl}/tree-sitter-tsx.wasm`,
        ),
        extensions: [".tsx"],
    },
    python: {
        language: "python",
        fileName: "tree-sitter-python.wasm",
        sourceUrls: TREE_SITTER_WASMS_SOURCE_BASE_URLS.map(
            (baseUrl) => `${baseUrl}/tree-sitter-python.wasm`,
        ),
        extensions: [".py"],
    },
};

export class TreeSitterAssetManager {
    private readonly fetchImpl: typeof fetch;
    private readonly appPathsPromise: Promise<DiogenesAppPaths>;
    private readonly inFlight: Map<ManagedGrammarLanguage, Promise<ManagedGrammarStatus>> =
        new Map();

    constructor(options: TreeSitterAssetManagerOptions = {}) {
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.appPathsPromise = options.appPaths
            ? Promise.resolve(options.appPaths)
            : ensureDiogenesAppDirs();
    }

    static getSupportedGrammars(): ManagedGrammarDefinition[] {
        return Object.values(MANAGED_GRAMMARS).map((grammar) => ({
            ...grammar,
            sourceUrls: [...grammar.sourceUrls],
            extensions: [...grammar.extensions],
        }));
    }

    getGrammarForExtension(extension: string): ManagedGrammarDefinition | null {
        const normalized = extension.toLowerCase();
        return (
            Object.values(MANAGED_GRAMMARS).find((grammar) =>
                grammar.extensions.includes(normalized),
            ) ?? null
        );
    }

    async ensureStorageReady(): Promise<void> {
        const appPaths = await this.appPathsPromise;
        await fs.promises.mkdir(appPaths.treeSitterDir, { recursive: true });
        await fs.promises.mkdir(appPaths.treeSitterGrammarsDir, { recursive: true });
    }

    async ensureGrammar(language: ManagedGrammarLanguage): Promise<ManagedGrammarStatus> {
        const existing = this.inFlight.get(language);
        if (existing) {
            return existing;
        }

        const promise = this.ensureGrammarInternal(language).finally(() => {
            this.inFlight.delete(language);
        });
        this.inFlight.set(language, promise);
        return promise;
    }

    async getGrammarPath(language: ManagedGrammarLanguage): Promise<string> {
        const status = await this.ensureGrammar(language);
        if (!status.grammarPath) {
            throw new Error(status.reason ?? `Grammar ${language} is unavailable`);
        }
        return status.grammarPath;
    }

    async getManifest(): Promise<TreeSitterManifest> {
        await this.ensureStorageReady();
        const manifestPath = await this.getManifestPath();

        try {
            const content = await fs.promises.readFile(manifestPath, "utf8");
            const parsed: unknown = JSON.parse(content);
            return this.normalizeManifest(parsed);
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT") {
                return this.createEmptyManifest();
            }
            throw error;
        }
    }

    private async ensureGrammarInternal(
        language: ManagedGrammarLanguage,
    ): Promise<ManagedGrammarStatus> {
        await this.ensureStorageReady();

        const grammar = MANAGED_GRAMMARS[language];
        const grammarPath = await this.getAbsoluteGrammarPath(grammar.fileName);
        if (await this.fileExists(grammarPath)) {
            const manifest = await this.getManifest();
            const entry = manifest.grammars[language];
            return {
                language,
                grammarPath,
                sourceUrl: entry?.sourceUrl,
                sourceHost: entry?.sourceHost,
                availability: "available",
            };
        }

        let lastError: unknown;
        for (const sourceUrl of grammar.sourceUrls) {
            try {
                const response = await this.fetchImpl(sourceUrl);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const data = new Uint8Array(await response.arrayBuffer());
                const tempPath = `${grammarPath}.tmp-${process.pid}-${Date.now()}`;
                await fs.promises.writeFile(tempPath, data);
                await fs.promises.rename(tempPath, grammarPath);
                await this.updateManifest(language, grammar.fileName, sourceUrl, data.byteLength);

                return {
                    language,
                    grammarPath,
                    sourceUrl,
                    sourceHost: new URL(sourceUrl).host,
                    availability: "downloaded",
                };
            } catch (error) {
                lastError = error;
            }
        }

        return {
            language,
            availability: "failed",
            reason:
                lastError instanceof Error
                    ? `Failed to download grammar ${language} from configured mirrors (${grammar.sourceUrls.map((url) => new URL(url).host).join(", ")}): ${lastError.message}`
                    : `Failed to download grammar ${language} from configured mirrors (${grammar.sourceUrls.map((url) => new URL(url).host).join(", ")})`,
        };
    }

    private async updateManifest(
        language: ManagedGrammarLanguage,
        fileName: string,
        sourceUrl: string,
        size: number,
    ): Promise<void> {
        const manifest = await this.getManifest();
        manifest.grammars[language] = {
            file: path.posix.join("grammars", fileName),
            sourceUrl,
            sourceHost: new URL(sourceUrl).host,
            downloadedAt: new Date().toISOString(),
            size,
        };

        const manifestPath = await this.getManifestPath();
        await fs.promises.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    private normalizeManifest(manifest: unknown): TreeSitterManifest {
        const input = treeSitterManifestSchema.safeParse(manifest);
        const value = input.success ? input.data : null;
        return {
            version: value?.version || MANIFEST_VERSION,
            package: value?.package || TREE_SITTER_WASMS_PACKAGE,
            packageVersion: value?.packageVersion || TREE_SITTER_WASMS_VERSION,
            grammars: value?.grammars || {},
        };
    }

    private createEmptyManifest(): TreeSitterManifest {
        return {
            version: MANIFEST_VERSION,
            package: TREE_SITTER_WASMS_PACKAGE,
            packageVersion: TREE_SITTER_WASMS_VERSION,
            grammars: {},
        };
    }

    private async getManifestPath(): Promise<string> {
        const appPaths = await this.appPathsPromise;
        return path.join(appPaths.treeSitterDir, "manifest.json");
    }

    private async getAbsoluteGrammarPath(fileName: string): Promise<string> {
        const appPaths = await this.appPathsPromise;
        return path.join(appPaths.treeSitterGrammarsDir, fileName);
    }

    private async fileExists(filePath: string): Promise<boolean> {
        try {
            await fs.promises.access(filePath, fs.constants.R_OK);
            return true;
        } catch {
            return false;
        }
    }
}
