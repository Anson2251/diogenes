import { z } from "zod";

import { AstService } from "../../ast/service";
import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";
import { formatAstToolError } from "./file-symbols";

const fileLoadSymbolSchema = z.object({
    path: z.string(),
    name: z.string(),
    kind: z.string().optional(),
});

type FileLoadSymbolParams = z.infer<typeof fileLoadSymbolSchema>;

export class FileLoadSymbolTool extends BaseTool<typeof fileLoadSymbolSchema> {
    protected schema = fileLoadSymbolSchema;
    private readonly workspace: WorkspaceManager;
    private readonly astService: AstService;

    constructor(workspace: WorkspaceManager, astService: AstService) {
        super({
            namespace: "file",
            name: "load-symbol",
            description: "Load a named symbol into workspace using AST ranges",
            params: {
                path: { type: "string", description: "File path" },
                name: { type: "string", description: "Symbol name" },
                kind: {
                    type: "string",
                    optional: true,
                    description: "Optional symbol kind filter",
                },
            },
            returns: {
                language: "Detected AST language",
                symbol: "Loaded symbol metadata",
                loaded_range: "Loaded symbol line range",
                total_lines: "Total lines in file",
            },
        });
        this.workspace = workspace;
        this.astService = astService;
    }

    async run(params: FileLoadSymbolParams): Promise<ToolResult> {
        const { path: filePath, name, kind } = params;

        try {
            const absolutePath = await this.workspace.resolveReadableFilePath(filePath);
            const language = this.astService.getSupportedLanguageForPath(absolutePath);
            if (!language) {
                return this.error(
                    "AST_UNSUPPORTED_LANGUAGE",
                    `AST is not supported for ${filePath}`,
                    { path: filePath },
                    "Use file.load with explicit line ranges for unsupported file types",
                );
            }

            const match = await this.astService.findSymbol(absolutePath, name, kind);
            if (match.status === "missing") {
                return this.error(
                    "AST_SYMBOL_NOT_FOUND",
                    `Symbol '${name}' not found in ${filePath}`,
                    {
                        path: filePath,
                        name,
                        kind,
                    },
                );
            }
            if (match.status === "ambiguous") {
                return this.error(
                    "AST_SYMBOL_AMBIGUOUS",
                    `Symbol '${name}' is ambiguous in ${filePath}`,
                    {
                        path: filePath,
                        name,
                        kind,
                        candidates: match.candidates?.map((candidate) => ({
                            name: candidate.name,
                            kind: candidate.kind,
                            start: candidate.range.start,
                            end: candidate.range.end,
                        })),
                    },
                );
            }

            const symbol = match.symbol!;
            const entry = await this.workspace.loadFile(
                filePath,
                symbol.range.start,
                symbol.range.end,
            );

            return this.success({
                language,
                symbol: {
                    name: symbol.name,
                    kind: symbol.kind,
                    start: symbol.range.start,
                    end: symbol.range.end,
                    exported: symbol.exported,
                    detail: symbol.detail,
                },
                loaded_range: [symbol.range.start, symbol.range.end],
                total_lines: entry.totalLines,
            });
        } catch (error) {
            return formatAstToolError(this, filePath, error, "load symbol");
        }
    }
}
