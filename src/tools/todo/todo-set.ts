/**
 * Todo set tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult, TodoItem } from "../../types";

export class TodoSetTool extends BaseTool {
    private workspace: any;

    constructor(workspace: any) {
        super({
            namespace: "todo",
            name: "set",
            description: "Overwrite entire todo list",
            params: {
                items: {
                    type: "array<object>",
                    description: "Array of todo items with text and state",
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
                "Invalid parameters for todo.set",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { items } = validation.data as {
            items: Array<{ text: string; state: string }>;
        };

        if (!Array.isArray(items)) {
            return this.error(
                "INVALID_PARAM",
                "Items must be an array",
                { items },
                "Provide an array of todo items with text and state properties",
            );
        }

        const validatedItems: TodoItem[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || typeof item !== "object") {
                return this.error(
                    "INVALID_ITEM",
                    `Item at index ${i} is not an object`,
                    { index: i, item },
                    "Each todo item must be an object with text and state properties",
                );
            }

            if (typeof item.text !== "string") {
                return this.error(
                    "INVALID_ITEM",
                    `Item at index ${i} has invalid text property`,
                    { index: i, item },
                    "Todo item text must be a string",
                );
            }

            if (!["done", "active", "pending"].includes(item.state)) {
                return this.error(
                    "INVALID_ITEM",
                    `Item at index ${i} has invalid state: ${item.state}`,
                    { index: i, item },
                    'Todo item state must be "done", "active", or "pending"',
                );
            }

            validatedItems.push({
                text: item.text,
                state: item.state as "done" | "active" | "pending",
            });
        }

        this.workspace.setTodoItems(validatedItems);

        return this.success({ success: true, items: validatedItems });
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.items) {
            const items = result.data.items as TodoItem[];
            const lines = items.map((item) => {
                const icon = item.state === "done" ? "✓" : item.state === "active" ? "→" : "○";
                return `  ${icon} ${item.text}`;
            });
            return `\x1b[32m\x1b[1m✓\x1b[0m Set ${items.length} todo items:\n${lines.join("\n")}`;
        }
        return undefined;
    }
}
