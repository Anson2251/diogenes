/**
 * File unload tool
 */

import { z } from "zod";

import type { WorkspaceManager } from "../../context/workspace";

import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const fileUnloadSchema = z.object({
    path: z.string(),
});

type FileUnloadParams = z.infer<typeof fileUnloadSchema>;

export class FileUnloadTool extends BaseTool<typeof fileUnloadSchema> {
    protected schema = fileUnloadSchema;
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "file",
            name: "unload",
            description: "Remove file from workspace",
            params: {
                path: { type: "string", description: "File path" },
            },
            returns: {
                success: "Whether operation succeeded",
            },
        });
        this.workspace = workspace;
    }

    run(params: FileUnloadParams): ToolResult {
        const { path } = params;

        const success = this.workspace.unloadFile(path);

        if (success) {
            return this.success({ success: true, path });
        } else {
            return this.error(
                "NOT_FOUND",
                `File ${path} not found in workspace`,
                { path },
                "Check if the file was previously loaded",
            );
        }
    }
}
