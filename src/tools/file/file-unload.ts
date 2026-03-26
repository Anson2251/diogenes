/**
 * File unload tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";

export class FileUnloadTool extends BaseTool {
    private workspace: any;

    constructor(workspace: any) {
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

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for file.unload",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { path } = validation.data as { path: string };

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
