import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { computeMyersLineDiffHunks } from "../../utils/str";
import { BaseTool } from "../base-tool";

const fileOverwriteSchema = z.object({
    path: z.string(),
    content: z.union([z.string(), z.array(z.string())]),
});

type FileOverwriteParams = z.infer<typeof fileOverwriteSchema>;

export class FileOverwriteTool extends BaseTool<typeof fileOverwriteSchema> {
    protected schema = fileOverwriteSchema;
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "overwrite",
            description: `Overwrite an entire file with new content.

Use this when replacing most or all of a file.
- Prefer heredoc for multi-line content
- Do not use this for small targeted edits`,
            params: {
                path: { type: "string", description: "Existing file path" },
                content: {
                    type: "string",
                    description:
                        'Full replacement content. Prefer {"$heredoc":"EOF"} for multi-line content.',
                },
            },
            returns: {
                path: "Overwritten file path",
                total_lines: "Total lines written",
                workspace_update: "Workspace reload result for already loaded ranges",
            },
        });
        this.workspace = workspace;
        this.workspaceRoot = workspace.getWorkspaceRoot();
    }

    async run(params: FileOverwriteParams): Promise<ToolResult> {
        const { path: filePath, content } = params;

        try {
            const absolutePath = this.resolvePath(filePath);
            this.validateContent(content);

            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) {
                throw new Error(`Path ${filePath} is not a file`);
            }

            const previousContent = await fs.promises.readFile(absolutePath, "utf-8");
            const lines = this.normalizeContent(content);
            const serialized = lines.join("\n");
            await fs.promises.writeFile(absolutePath, serialized, "utf-8");

            const existingEntry = this.workspace.getFileEntry(filePath);
            let workspaceUpdateResult = undefined;
            if (
                existingEntry !== undefined &&
                existingEntry !== null &&
                typeof existingEntry === "object"
            ) {
                if ("ranges" in existingEntry && Array.isArray(existingEntry.ranges)) {
                    const rangesSchema = z.array(z.object({ start: z.number(), end: z.number() }));
                    const rangesParsed = rangesSchema.safeParse(existingEntry.ranges);
                    if (rangesParsed.success) {
                        workspaceUpdateResult = this.workspace.reloadFileWithRangesContent(
                            filePath,
                            serialized,
                            rangesParsed.data,
                        );
                    }
                }
            }

            let workspaceUpdate = undefined;
            if (
                workspaceUpdateResult !== undefined &&
                workspaceUpdateResult !== null &&
                typeof workspaceUpdateResult === "object"
            ) {
                const wsResult = workspaceUpdateResult;
                const rangesValue = "ranges" in wsResult ? wsResult.ranges : undefined;
                const contentValue = "content" in wsResult ? wsResult.content : undefined;
                const rangesArray = Array.isArray(rangesValue) ? rangesValue : [];
                const contentIsObj = contentValue !== null && typeof contentValue === "object";
                const contentObj = contentIsObj ? contentValue : undefined;
                const lengthValue =
                    contentObj !== undefined && "length" in contentObj
                        ? contentObj.length
                        : undefined;
                const lengthNum = typeof lengthValue === "number" ? lengthValue : 0;
                workspaceUpdate = {
                    loaded_ranges: rangesArray,
                    total_lines_in_workspace: lengthNum,
                };
            }

            return this.success({
                path: filePath,
                total_lines: lines.length,
                workspace_update: workspaceUpdate,
                _diff: {
                    path: absolutePath,
                    oldText: previousContent,
                    newText: serialized,
                    hunks: computeMyersLineDiffHunks(previousContent, serialized),
                },
            });
        } catch (error) {
            return this.error(
                "FILE_OVERWRITE_ERROR",
                `Failed to overwrite file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath },
                "Check that the file exists, is inside the workspace, and is writable",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (
            result.success &&
            result.data &&
            typeof result.data.path === "string" &&
            typeof result.data.total_lines === "number"
        ) {
            return `\x1b[32m\x1b[1m✓\x1b[0m Overwrote ${result.data.path} (${result.data.total_lines} lines)`;
        }
        return undefined;
    }

    private isSupportedContent(content: unknown): content is string | string[] {
        return (
            typeof content === "string" ||
            (Array.isArray(content) && content.every((line) => typeof line === "string"))
        );
    }

    private validateContent(content: unknown): asserts content is string | string[] {
        if (!this.isSupportedContent(content)) {
            throw new Error("Content must be a string or array of strings");
        }
    }

    private normalizeContent(content: string | string[]): string[] {
        return typeof content === "string" ? content.split("\n") : content;
    }

    private resolvePath(inputPath: string): string {
        const resolved = path.isAbsolute(inputPath)
            ? path.resolve(inputPath)
            : path.resolve(this.workspaceRoot, inputPath);
        const relative = path.relative(this.workspaceRoot, resolved);
        if (relative.startsWith("..") || relative === "..") {
            throw new Error(`Path ${resolved} is outside workspace root ${this.workspaceRoot}`);
        }
        return resolved;
    }
}
