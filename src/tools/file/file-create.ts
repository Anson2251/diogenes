import * as fs from "fs";
import * as path from "path";
import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";

interface FileCreateParams {
    path: string;
    content: string | string[];
}

export class FileCreateTool extends BaseTool {
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
                    type: "content",
                    description: "Full file content. Prefer {\"$heredoc\":\"EOF\"} for multi-line content.",
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

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.create",
                { errors: validation.errors },
                "Provide a path and file content",
            );
        }

        const { path: filePath, content } = validation.data as FileCreateParams;

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

            const workspaceUpdate = existingEntry
                ? await this.workspace.reloadFileWithRangesContent(filePath, serialized, existingEntry.ranges)
                : undefined;

            return this.success({
                path: filePath,
                total_lines: lines.length,
                workspace_update: workspaceUpdate
                    ? {
                        loaded_ranges: workspaceUpdate.ranges,
                        total_lines_in_workspace: workspaceUpdate.content.length,
                    }
                    : undefined,
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
        if (result.success && result.data) {
            return `\x1b[32m\x1b[1m✓\x1b[0m Created ${result.data.path} (${result.data.total_lines} lines)`;
        }
        return undefined;
    }

    validateParams(params: unknown): { valid: boolean; errors: string[]; data?: unknown } {
        const base = super.validateParams(params);
        if (!base.valid || !base.data) {
            return base;
        }

        const data = base.data as FileCreateParams;
        const errors: string[] = [];

        if (!this.isSupportedContent(data.content)) {
            errors.push("content: Expected string or array of strings");
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return { valid: true, errors: [], data };
    }

    private isSupportedContent(content: unknown): content is string | string[] {
        return typeof content === "string" ||
            (Array.isArray(content) && content.every((line) => typeof line === "string"));
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
            throw new Error(
                `Path ${resolved} is outside workspace root ${this.workspaceRoot}`,
            );
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
