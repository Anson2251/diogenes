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
        const validated = params as {
            items: Array<{ text: string; state: string }>;
        };

        // Validate items
        if (!Array.isArray(validated.items)) {
            return this.error(
                "INVALID_PARAM",
                "Items must be an array",
                { items: validated.items },
                "Provide an array of todo items with text and state properties",
            );
        }

        const validatedItems: TodoItem[] = [];
        for (let i = 0; i < validated.items.length; i++) {
            const item = validated.items[i];
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

        return this.success({ success: true });
    }
}
