/**
 * Directory unload tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";

export class DirUnloadTool extends BaseTool {
    private workspace: any;

    constructor(workspace: any) {
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

    async execute(params: unknown): Promise<ToolResult> {
        const validated = params as { path: string };

        const success = this.workspace.unloadDirectory(validated.path);

        if (success) {
            return this.success({ success: true });
        } else {
            return this.error(
                "NOT_FOUND",
                `Directory ${validated.path} not found in workspace`,
                { path: validated.path },
                "Check if the directory was previously loaded",
            );
        }
    }
}
