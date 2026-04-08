import { z } from "zod";

import { AstService, AstServiceError } from "../../ast/service";
import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { TREE_SITTER_WASMS_SOURCE_BASE_URLS } from "../../utils/tree-sitter-asset-manager";
import { BaseTool } from "../base-tool";

const fileSymbolsSchema = z.object({
    path: z.string(),
    kinds: z.array(z.string()).optional(),
});

type FileSymbolsParams = z.infer<typeof fileSymbolsSchema>;

export class FileSymbolsTool extends BaseTool<typeof fileSymbolsSchema> {
    protected schema = fileSymbolsSchema;
    private readonly workspace: WorkspaceManager;
    private readonly astService: AstService;

    constructor(workspace: WorkspaceManager, astService: AstService) {
        super({
            namespace: "file",
            name: "symbols",
            description: "List top-level symbols in a supported source file",
            params: {
                path: { type: "string", description: "File path" },
                kinds: {
                    type: "array",
                    optional: true,
                    description: "Optional symbol kinds to include",
                },
            },
            returns: {
                language: "Detected AST language",
                symbols: "Top-level symbols with line ranges",
            },
        });
        this.workspace = workspace;
        this.astService = astService;
    }

    async run(params: FileSymbolsParams): Promise<ToolResult> {
        const { path: filePath, kinds } = params;

        try {
            const absolutePath = await this.workspace.resolveReadableFilePath(filePath);
            const language = this.astService.getSupportedLanguageForPath(absolutePath);
            if (!language) {
                return this.error(
                    "AST_UNSUPPORTED_LANGUAGE",
                    `AST is not supported for ${filePath}`,
                    { path: filePath },
                    "Use file.load or file.peek for unsupported file types",
                );
            }

            const symbols = await this.astService.listSymbols(absolutePath);
            const filtered = kinds?.length
                ? symbols.filter((symbol) => kinds.includes(symbol.kind))
                : symbols;

            return this.success({
                language,
                symbols: filtered.map((symbol) => ({
                    name: symbol.name,
                    kind: symbol.kind,
                    start: symbol.range.start,
                    end: symbol.range.end,
                    exported: symbol.exported,
                    detail: symbol.detail,
                })),
            });
        } catch (error) {
            return formatAstToolError(this, filePath, error, "list symbols");
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (!result.success || !Array.isArray(result.data?.symbols)) {
            return undefined;
        }

        const language =
            typeof result.data.language === "string" ? result.data.language : "unknown";
        const lines = result.data.symbols
            .map((symbol) => toFormattedSymbolLine(symbol))
            .filter((line): line is string => line !== null);

        return `\x1b[32m✓\x1b[0m ${language} symbols:\n${lines.join("\n")}`;
    }
}

interface FormattedSymbol {
    name: string;
    kind: string;
    start: number;
    end: number;
}

const formattedSymbolSchema = z.object({
    name: z.string(),
    kind: z.string(),
    start: z.number(),
    end: z.number(),
});

function toFormattedSymbolLine(symbol: unknown): string | null {
    const parsed = formattedSymbolSchema.safeParse(symbol);
    if (!parsed.success) {
        return null;
    }

    const symbolValue: FormattedSymbol = parsed.data;
    return `${symbolValue.kind} ${symbolValue.name} (${symbolValue.start}-${symbolValue.end})`;
}

export function formatAstToolError(
    tool: BaseTool<any>,
    filePath: string,
    error: unknown,
    action: string,
): ToolResult {
    if (error instanceof AstServiceError) {
        const suggestion =
            error.code === "AST_GRAMMAR_LOAD_FAILED"
                ? "Check the cached grammar file and try the command again"
                : error.code === "AST_UNSUPPORTED_LANGUAGE"
                  ? "Use file.load or file.peek for unsupported file types"
                  : error.code.startsWith("AST_GRAMMAR")
                    ? `Check network access to ${TREE_SITTER_WASMS_SOURCE_BASE_URLS.map((url) => new URL(url).host).join(", ")}`
                    : undefined;

        return tool.error(
            error.code,
            error.message,
            { path: filePath, ...(error.details || {}) },
            suggestion,
        );
    }

    return tool.error(
        "FILE_ERROR",
        `Failed to ${action} for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        { path: filePath },
    );
}
