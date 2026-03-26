/**
 * Task end tool
 */

import { BaseTool } from "../base-tool";
import { ToolCall, ToolResult } from "../../types";

export class TaskEndTool extends BaseTool {
    constructor() {
        super({
            namespace: "task",
            name: "end",
            description: "End the current task, either because it is complete or because the user must clarify something before work can continue. The summary may be multi-line Markdown and may be fairly detailed when that helps the user understand what happened or decide the next step. If the summary is long or spans multiple lines, prefer heredoc.",
            params: {
                reason: {
                    type: "string",
                    description: "Why the task is complete or blocked. If blocked, state exactly what is missing.",
                },
                summary: {
                    type: "string",
                    description: "A user-facing summary of what was completed, or the exact clarification/question the user must answer next. Multi-line Markdown is allowed. If the summary is long or spans multiple lines, prefer heredoc. Be detailed when useful, because the user may respond with follow-up instructions based directly on this summary.",
                },
            },
            returns: {
                success: "Whether task ended successfully",
            },
        });
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.end",
                { errors: validation.errors },
                "Check parameter types and values",
            );
        }

        const { reason, summary } = validation.data as {
            reason: string;
            summary: string;
        };

        return this.success({
            success: true,
            reason,
            summary,
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

    validateParams(params: unknown): { valid: boolean; errors: string[]; data?: unknown } {
        if (!params || typeof params !== "object") {
            return {
                valid: false,
                errors: ["reason: Required", "summary: Required"],
            };
        }

        const data = params as { reason?: unknown; summary?: unknown };
        const errors: string[] = [];

        if (typeof data.reason !== "string") {
            errors.push("reason: Expected string");
        }

        if (typeof data.summary !== "string" && !this.isStringArray(data.summary)) {
            errors.push("summary: Expected string or array of strings");
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return {
            valid: true,
            errors: [],
            data: {
                reason: data.reason,
                summary: this.normalizeSummary(data.summary as string | string[]),
            },
        };
    }

    private isStringArray(value: unknown): value is string[] {
        return Array.isArray(value) && value.every((item) => typeof item === "string");
    }

    private normalizeSummary(summary: string | string[]): string {
        return Array.isArray(summary) ? summary.join("\n") : summary;
    }
}
