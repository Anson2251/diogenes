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
        const validated = params as { path: string };

        try {
            await this.workspace.loadDirectory(validated.path);

            return this.success({});
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
