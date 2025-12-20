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
        const validated = params as { reason: string; summary: string };

        // This tool doesn't modify state, just signals task completion
        return this.success({
            success: true,
            reason: validated.reason,
            summary: validated.summary,
        });
    }
}
