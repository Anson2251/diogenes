import { z } from "zod";

import { ToolCall, ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const taskChooseSchema = z.object({
    question: z.string(),
    options: z.array(z.string()),
});

type TaskChooseParams = z.infer<typeof taskChooseSchema>;

export type ChooseHandler = (question: string, options: string[]) => Promise<string>;

export class TaskChooseTool extends BaseTool<typeof taskChooseSchema> {
    protected schema = taskChooseSchema;

    constructor(private readonly chooseHandler: ChooseHandler) {
        super({
            namespace: "task",
            name: "choose",
            description: "Ask the user to choose from a list of options",
            params: {
                question: {
                    type: "string",
                    description: "The question to ask the user",
                },
                options: {
                    type: "array",
                    description: "Available choices to present to the user",
                },
            },
            returns: {
                selection: "The user's selected option",
            },
        });
    }

    async run(params: TaskChooseParams): Promise<ToolResult> {
        const { question, options } = params;

        if (
            !Array.isArray(options) ||
            options.length === 0 ||
            options.some((option) => typeof option !== "string")
        ) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.choose",
                { options },
                "Provide at least one string option",
            );
        }

        try {
            const selection = await this.chooseHandler(question, options);
            return this.success({ selection });
        } catch (error) {
            return this.error(
                "INTERACTION_ERROR",
                `Failed to ask user to choose: ${error instanceof Error ? error.message : String(error)}`,
                { question, options },
                "Retry later or continue without interactive input",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && typeof result.data?.selection === "string") {
            return `\x1b[36m\x1b[1mUser selected:\x1b[0m ${result.data.selection}`;
        }
        return undefined;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success && typeof result.data?.selection === "string") {
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Question: ${toolCall.params.question}`,
                `Options: ${Array.isArray(toolCall.params.options) ? toolCall.params.options.join(", ") : ""}`,
                `Selection: ${result.data.selection}`,
            ].join("\n");
        }

        return super.formatResultForLLM(toolCall, result);
    }
}
