import * as fs from "fs";
import * as path from "path";
import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";

interface FileOverwriteParams {
    path: string;
    content: string | string[];
}

export class FileOverwriteTool extends BaseTool {
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
                    type: "content",
                    description: "Full replacement content. Prefer {\"$heredoc\":\"EOF\"} for multi-line content.",
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

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.overwrite",
                { errors: validation.errors },
                "Provide a path and replacement content",
            );
        }

        const { path: filePath, content } = validation.data as FileOverwriteParams;

        try {
            const absolutePath = this.resolvePath(filePath);
            this.validateContent(content);

            const stat = await fs.promises.stat(absolutePath);
            if (!stat.isFile()) {
                throw new Error(`Path ${filePath} is not a file`);
            }

            const lines = this.normalizeContent(content);
            const serialized = lines.join("\n");
            await fs.promises.writeFile(absolutePath, serialized, "utf-8");

            const existingEntry = this.workspace.getFileEntry(filePath);
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
        if (result.success && result.data) {
            return `\x1b[32m\x1b[1m✓\x1b[0m Overwrote ${result.data.path} (${result.data.total_lines} lines)`;
        }
        return undefined;
    }

    validateParams(params: unknown): { valid: boolean; errors: string[]; data?: unknown } {
        const base = super.validateParams(params);
        if (!base.valid || !base.data) {
            return base;
        }

        const data = base.data as FileOverwriteParams;
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
}
