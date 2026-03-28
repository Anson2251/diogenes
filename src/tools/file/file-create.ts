import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const fileCreateSchema = z.object({
    path: z.string(),
    content: z.union([z.string(), z.array(z.string())]),
});

type FileCreateParams = z.infer<typeof fileCreateSchema>;

export class FileCreateTool extends BaseTool<typeof fileCreateSchema> {
    protected schema = fileCreateSchema;
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "create",
            description: `Create a new file with full content.

Use this when the file does not exist yet.
- Prefer heredoc for multi-line content
- Do not use this to modify an existing file
- If the file already exists, use file.edit or file.overwrite instead`,
            params: {
                path: { type: "string", description: "New file path" },
                content: {
                    type: "string",
                    description:
                        'Full file content. Prefer {"$heredoc":"EOF"} for multi-line content.',
                },
            },
            returns: {
                path: "Created file path",
                total_lines: "Total lines written",
                workspace_update: "Workspace reload result if the file was already loaded",
            },
        });
        this.workspace = workspace;
        this.workspaceRoot = workspace.getWorkspaceRoot();
    }

    async run(params: FileCreateParams): Promise<ToolResult> {
        const { path: filePath, content } = params;

        try {
            const absolutePath = this.resolvePath(filePath);
            this.validateContent(content);

            const existingEntry = this.workspace.getFileEntry(filePath);

            await this.ensureParentDirectory(absolutePath);

            try {
                await fs.promises.stat(absolutePath);
                return this.error(
                    "FILE_EXISTS",
                    `File ${filePath} already exists`,
                    { path: filePath },
                    "Use file.overwrite to replace the full file, or file.edit for targeted changes",
                );
            } catch (error) {
                if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
                    throw error;
                }
            }

            const lines = this.normalizeContent(content);
            const serialized = lines.join("\n");
            await fs.promises.writeFile(absolutePath, serialized, "utf-8");

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
                    oldText: null,
                    newText: serialized,
                },
            });
        } catch (error) {
            return this.error(
                "FILE_CREATE_ERROR",
                `Failed to create file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath },
                "Check that the parent directory is inside the workspace and writable",
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
            return `\x1b[32m\x1b[1m✓\x1b[0m Created ${result.data.path} (${result.data.total_lines} lines)`;
        }
        return undefined;
    }

    private validateContent(content: unknown): asserts content is string | string[] {
        if (!this.isSupportedContent(content)) {
            throw new Error("Content must be a string or array of strings");
        }
    }

    private isSupportedContent(content: unknown): content is string | string[] {
        return (
            typeof content === "string" ||
            (Array.isArray(content) && content.every((line) => typeof line === "string"))
        );
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

    private async ensureParentDirectory(absolutePath: string): Promise<void> {
        const parentDir = path.dirname(absolutePath);
        const relative = path.relative(this.workspaceRoot, parentDir);
        if (relative.startsWith("..") || relative === "..") {
            throw new Error(`Parent directory ${parentDir} is outside workspace root`);
        }
        await fs.promises.mkdir(parentDir, { recursive: true });
    }
}
