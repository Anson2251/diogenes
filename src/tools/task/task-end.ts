/**
 * Task end tool
 */

import { z } from "zod";

import { ToolCall, ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const taskEndSchema = z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    reason: z.string(),
    summary: z.union([z.string(), z.array(z.string())]),
});

type TaskEndParams = z.infer<typeof taskEndSchema>;

export class TaskEndTool extends BaseTool<typeof taskEndSchema> {
    protected schema = taskEndSchema;

    constructor() {
        super({
            namespace: "task",
            name: "end",
            description:
                "End the current task when work is complete, blocked, or the turn should be handed back to the user.",
            params: {
                title: {
                    type: "string",
                    optional: true,
                    description: "A short session title summarizing the task outcome",
                },
                description: {
                    type: "string",
                    optional: true,
                    description:
                        "A brief one or two sentence session description for future management views",
                },
                reason: {
                    type: "string",
                    description:
                        "Why the task is complete or blocked. If blocked, state exactly what is missing.",
                },
                summary: {
                    type: "string",
                    description:
                        "The exact user-facing message for this turn. This may be a completion result, a direct clarification question, a brief greeting, or a substantive explanatory answer. For explanatory or analytical requests, put the actual answer in summary instead of a brief recap like 'I reviewed the project structure.' Prefer the message itself over a meta-summary like 'I asked what the user needs help with.' Multi-line Markdown is allowed. If the summary is long or spans multiple lines, prefer heredoc. Be detailed when useful, because the user may respond with follow-up instructions based directly on this summary.",
                },
            },
            returns: {
                success: "Whether task ended successfully",
            },
        });
    }

    run(params: TaskEndParams): ToolResult {
        const { title, description, reason, summary } = params;

        const normalizedSummary = this.normalizeSummary(summary);

        return this.success({
            success: true,
            title,
            description,
            reason,
            summary: normalizedSummary,
        });
    }

    /**
     * Custom formatting for task.end results
     */
    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data?.summary) {
            return `\x1b[35m\x1b[1m✓ Task completed\x1b[0m\n\x1b[1mSummary:\x1b[0m ${result.data.summary}`;
        }
        return undefined;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success) {
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Reason: ${result.data?.reason || toolCall.params.reason || ""}`,
                `Summary: ${result.data?.summary || toolCall.params.summary || ""}`,
            ].join("\n");
        }

        return super.formatResultForLLM(toolCall, result);
    }

    private normalizeSummary(summary: string | string[]): string {
        return Array.isArray(summary) ? summary.join("\n") : summary;
    }
}
