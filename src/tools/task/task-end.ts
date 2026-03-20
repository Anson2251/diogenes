/**
 * Task end tool
 */

import { BaseTool } from "../base-tool";
import { ToolResult } from "../../types";

export class TaskEndTool extends BaseTool {
    constructor() {
        super({
            namespace: "task",
            name: "end",
            description: "End the current task",
            params: {
                reason: {
                    type: "string",
                    description: "Brief summary on why the task is over",
                },
                summary: {
                    type: "string",
                    description: "What agent done in this task",
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
}
