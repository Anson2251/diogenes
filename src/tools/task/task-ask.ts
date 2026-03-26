import { BaseTool } from "../base-tool";
import { ToolCall, ToolResult } from "../../types";

export type AskHandler = (question: string) => Promise<string>;

export class TaskAskTool extends BaseTool {
    constructor(private readonly askHandler: AskHandler) {
        super({
            namespace: "task",
            name: "ask",
            description: "Ask the user a direct question when more information is required",
            params: {
                question: {
                    type: "string",
                    description: "The question to ask the user",
                },
            },
            returns: {
                answer: "The user's answer",
            },
        });
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.ask",
                { errors: validation.errors },
                "Provide a single question string",
            );
        }

        const { question } = validation.data as { question: string };

        try {
            const answer = await this.askHandler(question);
            return this.success({ answer });
        } catch (error) {
            return this.error(
                "INTERACTION_ERROR",
                `Failed to ask user question: ${error instanceof Error ? error.message : String(error)}`,
                { question },
                "Retry later or continue without interactive input",
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && typeof result.data?.answer === "string") {
            return `\x1b[36m\x1b[1mUser answer:\x1b[0m ${result.data.answer}`;
        }
        return undefined;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success && typeof result.data?.answer === "string") {
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Question: ${toolCall.params.question}`,
                `Answer: ${result.data.answer}`,
            ].join("\n");
        }

        return super.formatResultForLLM(toolCall, result);
    }
}
