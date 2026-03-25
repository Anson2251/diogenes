/**
 * Directory listing tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";

export class DirListTool extends BaseTool {
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "dir",
            name: "list",
            description: "List directory contents and load into workspace",
            params: {
                path: { type: "string", description: "Directory path" },
            },
            returns: {},
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for dir.list",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { path } = validation.data as { path: string };

        try {
            const entries = await this.workspace.loadDirectory(path);
            const files = entries.filter((entry) => entry.type === "FILE").length;
            const dirs = entries.filter((entry) => entry.type === "DIR").length;

            return this.success({
                count: entries.length,
                files,
                dirs,
            });
        } catch (error) {
            return this.error(
                "PATH_NOT_FOUND",
                `Failed to list directory ${path}: ${error instanceof Error ? error.message : String(error)}`,
                { path },
                "Check if the directory exists and you have permission to read it",
            );
        }
    }
}
