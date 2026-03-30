/**
 * File remove tool - Delete a file from the filesystem
 */

import * as fs from "fs";
import * as path from "path";
import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const fileRemoveSchema = z.object({
    path: z.string(),
    force: z.boolean().optional().default(false),
});

type FileRemoveParams = z.infer<typeof fileRemoveSchema>;

export class FileRemoveTool extends BaseTool<typeof fileRemoveSchema> {
    protected schema = fileRemoveSchema;
    private workspace: WorkspaceManager;
    private workspaceRoot: string;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "remove",
            description: `Delete a file from the filesystem.

Use this when you want to permanently delete a file.
- The file must exist and be within the workspace
- If force is true, missing files are silently ignored
- The file is also removed from workspace if loaded`,
            params: {
                path: { type: "string", description: "File path to delete" },
                force: {
                    type: "bool",
                    optional: true,
                    description: "If true, missing files don't cause an error",
                },
            },
            returns: {
                path: "Deleted file path",
                existed: "Whether the file existed before deletion",
                workspace_removed: "Whether the file was removed from workspace",
            },
        });
        this.workspace = workspace;
        this.workspaceRoot = workspace.getWorkspaceRoot();
    }

    async run(params: FileRemoveParams): Promise<ToolResult> {
        const { path: filePath, force } = params;

        try {
            const absolutePath = this.resolvePath(filePath);

            // Check if file exists
            let existed = false;
            try {
                await fs.promises.stat(absolutePath);
                existed = true;
            } catch (error) {
                if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") {
                    throw error;
                }
                // File doesn't exist
                if (!force) {
                    return this.error(
                        "FILE_NOT_FOUND",
                        `File ${filePath} does not exist`,
                        { path: filePath },
                        "Check the file path or set force: true to ignore missing files",
                    );
                }
            }

            // Remove from workspace first
            const workspaceRemoved = this.workspace.unloadFile(filePath);

            // Delete the file if it exists
            if (existed) {
                await fs.promises.unlink(absolutePath);
            }

            return this.success({
                path: filePath,
                existed,
                workspace_removed: workspaceRemoved,
                _diff: {
                    path: absolutePath,
                    oldText: existed ? "(file content)" : null,
                    newText: null,
                },
            });
        } catch (error) {
            return this.error(
                "FILE_REMOVE_ERROR",
                `Failed to remove file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
                { path: filePath },
                "Check that the file is not in use and you have write permissions",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (
            result.success &&
            result.data &&
            typeof result.data.path === "string" &&
            typeof result.data.existed === "boolean"
        ) {
            const existed = result.data.existed;
            const workspaceRemoved = result.data.workspace_removed === true;

            let message = `\x1b[32m\x1b[1m✓\x1b[0m `;
            if (existed) {
                message += `Deleted ${result.data.path}`;
            } else {
                message += `File ${result.data.path} was already missing`;
            }

            if (workspaceRemoved) {
                message += ` (removed from workspace)`;
            }

            return message;
        }
        return undefined;
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
