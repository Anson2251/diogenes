/**
 * Directory listing tool
 */

import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const dirListSchema = z.object({
    path: z.string(),
});

type DirListParams = z.infer<typeof dirListSchema>;

export class DirListTool extends BaseTool<typeof dirListSchema> {
    protected schema = dirListSchema;
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

    async run(params: DirListParams): Promise<ToolResult> {
        const { path } = params;

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
