/**
 * Todo update tool
 */

import { z } from "zod";

import type { WorkspaceManager } from "../../context/workspace";

import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const todoUpdateSchema = z.object({
    text: z.string(),
    state: z.enum(["done", "active", "pending"]),
});

type TodoUpdateParams = z.infer<typeof todoUpdateSchema>;

export class TodoUpdateTool extends BaseTool<typeof todoUpdateSchema> {
    protected schema = todoUpdateSchema;
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
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

    run(params: TodoUpdateParams): ToolResult {
        const { text, state } = params;

        const success = this.workspace.updateTodoItem(text, state);

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
        if (
            result.success &&
            result.data &&
            typeof result.data.text === "string" &&
            typeof result.data.state === "string"
        ) {
            const text = result.data.text;
            const state = result.data.state;
            const stateIcon = state === "done" ? "✓" : state === "active" ? "→" : "○";
            return `\x1b[32m\x1b[1m${stateIcon}\x1b[0m "${text}" → ${state}`;
        }
        return undefined;
    }
}
