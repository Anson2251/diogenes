import { z } from "zod";

import { AstService } from "../../ast/service";
import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";
import { formatAstToolError } from "./file-symbols";

const fileNodeAtSchema = z.object({
    path: z.string(),
    line: z.number(),
    column: z.number().optional(),
});

type FileNodeAtParams = z.infer<typeof fileNodeAtSchema>;

export class FileNodeAtTool extends BaseTool<typeof fileNodeAtSchema> {
    protected schema = fileNodeAtSchema;
    private readonly workspace: WorkspaceManager;
    private readonly astService: AstService;

    constructor(workspace: WorkspaceManager, astService: AstService) {
        super({
            namespace: "file",
            name: "node-at",
            description: "Show the syntax node at a given file position",
            params: {
                path: { type: "string", description: "File path" },
                line: { type: "number", description: "1-indexed line number" },
                column: {
                    type: "number",
                    optional: true,
                    description: "0-indexed column number",
                },
            },
            returns: {
                language: "Detected AST language",
                node: "Containing syntax node",
                parents: "Parent node chain",
            },
        });
        this.workspace = workspace;
        this.astService = astService;
    }

    async run(params: FileNodeAtParams): Promise<ToolResult> {
        const { path: filePath, line, column = 0 } = params;

        try {
            const absolutePath = await this.workspace.resolveReadableFilePath(filePath);
            const language = this.astService.getSupportedLanguageForPath(absolutePath);
            if (!language) {
                return this.error(
                    "AST_UNSUPPORTED_LANGUAGE",
                    `AST is not supported for ${filePath}`,
                    { path: filePath },
                    "Use file.peek or file.load for unsupported file types",
                );
            }

            const result = await this.astService.getNodeAt(absolutePath, { line, column });

            return this.success({
                language: result.language,
                node: {
                    type: result.node.type,
                    start: result.node.range.start,
                    end: result.node.range.end,
                    text_preview: result.node.textPreview,
                },
                parents: result.parents.map((parent) => ({
                    type: parent.type,
                    start: parent.range.start,
                    end: parent.range.end,
                })),
            });
        } catch (error) {
            return formatAstToolError(this, filePath, error, "resolve syntax node");
        }
    }
}
