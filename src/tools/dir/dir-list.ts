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
            returns: {
                items: "Array of directory entries with name and type",
            },
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validated = params as { path: string };

        try {
            const items = await this.workspace.loadDirectory(validated.path);

            return this.success({
                items: items.map((item) => ({
                    name: item.name,
                    type: item.type,
                })),
            });
        } catch (error) {
            return this.error(
                "PATH_NOT_FOUND",
                `Failed to list directory ${validated.path}: ${error instanceof Error ? error.message : String(error)}`,
                { path: validated.path },
                "Check if the directory exists and you have permission to read it",
            );
        }
    }
}
