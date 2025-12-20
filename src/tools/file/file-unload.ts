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
        const validated = params as { path: string };

        const success = this.workspace.unloadFile(validated.path);

        if (success) {
            return this.success({ success: true });
        } else {
            return this.error(
                "NOT_FOUND",
                `File ${validated.path} not found in workspace`,
                { path: validated.path },
                "Check if the file was previously loaded",
            );
        }
    }
}
