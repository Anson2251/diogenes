/**
 * Todo set tool
 */

import { z } from "zod";

import type { WorkspaceManager } from "../../context/workspace";

import { ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const todoItemSchema = z.object({
    text: z.string(),
    state: z.enum(["done", "active", "pending"]),
});

const todoSetSchema = z.object({
    items: z.array(todoItemSchema),
});

type TodoSetParams = z.infer<typeof todoSetSchema>;

export class TodoSetTool extends BaseTool<typeof todoSetSchema> {
    protected schema = todoSetSchema;
    private workspace: WorkspaceManager;

    constructor(workspace: WorkspaceManager) {
        super({
            namespace: "todo",
            name: "set",
            description: "Overwrite entire todo list",
            params: {
                items: {
                    type: "array",
                    description: "Array of todo items with text and state",
                },
            },
            returns: {
                success: "Whether operation succeeded",
            },
        });
        this.workspace = workspace;
    }

    run(params: TodoSetParams): ToolResult {
        const { items } = params;

        this.workspace.setTodoItems(items);

        return this.success({ success: true, items });
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.items && Array.isArray(result.data.items)) {
            const lines: string[] = [];
            for (const item of result.data.items) {
                const parsed = todoItemSchema.safeParse(item);
                if (parsed.success) {
                    const icon =
                        parsed.data.state === "done"
                            ? "✓"
                            : parsed.data.state === "active"
                              ? "→"
                              : "○";
                    lines.push(`  ${icon} ${parsed.data.text}`);
                }
            }
            return `\x1b[32m\x1b[1m✓\x1b[0m Set ${lines.length} todo items:\n${lines.join("\n")}`;
        }
        return undefined;
    }
}
