/**
 * Directory unload tool
 */

import { z } from "zod";

import type { WorkspaceManager } from "../../context/workspace";

import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const dirUnloadSchema = z.object({
    path: z.string(),
});

type DirUnloadParams = z.infer<typeof dirUnloadSchema>;

export class DirUnloadTool extends BaseTool<typeof dirUnloadSchema> {
    protected schema = dirUnloadSchema;
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "dir",
            name: "unload",
            description: "Remove directory from workspace",
            params: {
                path: { type: "string", description: "Directory path" },
            },
            returns: {
                success: "Whether operation succeeded",
            },
        });
        this.workspace = workspace;
    }

    run(params: DirUnloadParams): ToolResult {
        const { path } = params;

        const success = this.workspace.unloadDirectory(path);

        if (success) {
            return this.success({ success: true, path });
        } else {
            return this.error(
                "NOT_FOUND",
                `Directory ${path} not found in workspace`,
                { path },
                "Check if the directory was previously loaded",
            );
        }
    }
}
