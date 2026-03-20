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
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for todo.update",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { text, state } = validation.data as {
            text: string;
            state: string;
        };

        if (!["done", "active", "pending"].includes(state)) {
            return this.error(
                "INVALID_STATE",
                `Invalid state: ${state}`,
                { state },
                'State must be "done", "active", or "pending"',
            );
        }

        const success = this.workspace.updateTodoItem(text, state as any);

        if (success) {
            return this.success({ success: true, text, state });
        } else {
            return this.error(
                "NOT_FOUND",
                `Todo item not found: "${text}"`,
                { text },
                "Check if the todo item exists with exact text match",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data) {
            const { text, state } = result.data as { text: string; state: string };
            const stateIcon = state === "done" ? "✓" : state === "active" ? "→" : "○";
            return `\x1b[32m\x1b[1m${stateIcon}\x1b[0m "${text}" → ${state}`;
        }
        return undefined;
    }
}
