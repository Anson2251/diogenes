/**
 * Todo update tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";

export class TodoUpdateTool extends BaseTool {
    private workspace: any;

    constructor(workspace: any) {
        super({
            namespace: "todo",
            name: "update",
            description: "Update state of a todo item",
            params: {
                text: {
                    type: "string",
                    description: "Item text (must match exactly)",
                },
                state: {
                    type: "string",
                    description: '"done" | "active" | "pending"',
                },
            },
            returns: {
                success: "Whether operation succeeded",
            },
        });
        this.workspace = workspace;
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validated = params as { text: string; state: string };

        if (!["done", "active", "pending"].includes(validated.state)) {
            return this.error(
                "INVALID_STATE",
                `Invalid state: ${validated.state}`,
                { state: validated.state },
                'State must be "done", "active", or "pending"',
            );
        }

        const success = this.workspace.updateTodoItem(
            validated.text,
            validated.state as any,
        );

        if (success) {
            return this.success({ success: true });
        } else {
            return this.error(
                "NOT_FOUND",
                `Todo item not found: "${validated.text}"`,
                { text: validated.text },
                "Check if the todo item exists with exact text match",
            );
        }
    }
}
