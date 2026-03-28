import { z } from "zod";

import type { SnapshotManager } from "../../snapshot/manager";
import type { ToolCall, ToolResult } from "../../types";

import { BaseTool } from "../base-tool";

const snapshotCreateSchema = z.object({
    label: z.string().optional(),
    reason: z.string().optional(),
});

type SnapshotCreateParams = z.infer<typeof snapshotCreateSchema>;

export class SnapshotCreateTool extends BaseTool<typeof snapshotCreateSchema> {
    protected schema = snapshotCreateSchema;

    constructor(
        private readonly getSnapshotManager: () => SnapshotManager | null,
        private readonly getTurn: () => number,
    ) {
        super({
            namespace: "snapshot",
            name: "create",
            description: "Create a defensive session snapshot before risky work",
            params: {
                label: {
                    type: "string",
                    optional: true,
                    description: "Short label for the snapshot",
                },
                reason: {
                    type: "string",
                    optional: true,
                    description: "Why this snapshot is useful",
                },
            },
            returns: {
                snapshot_id: "Session-local snapshot identifier",
                created_at: "Creation timestamp",
                trigger: "Snapshot trigger type",
            },
        });
    }

    async run(params: SnapshotCreateParams): Promise<ToolResult> {
        const snapshotManager = this.getSnapshotManager();
        if (!snapshotManager) {
            return this.error("SNAPSHOT_DISABLED", "Session snapshots are not enabled");
        }

        try {
            const result = await snapshotManager.createSnapshot({
                trigger: "llm_manual",
                turn: this.getTurn(),
                label: params.label,
                reason: params.reason,
            });

            return this.success({
                snapshot_id: result.snapshotId,
                created_at: result.createdAt,
                trigger: result.trigger,
                label: result.label,
            });
        } catch (error) {
            return this.error(
                "SNAPSHOT_CREATE_FAILED",
                error instanceof Error ? error.message : String(error),
            );
        }
    }

    formatResult(result: ToolResult): string | undefined {
        if (!result.success) {
            return undefined;
        }

        const snapshotId =
            typeof result.data?.snapshot_id === "string" ? result.data.snapshot_id : "unknown";
        const label = typeof result.data?.label === "string" ? result.data.label : undefined;
        return label
            ? `Created snapshot ${snapshotId} (${label})`
            : `Created snapshot ${snapshotId}`;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (!result.success) {
            return super.formatResultForLLM(toolCall, result);
        }

        return [
            `[OK] ${toolCall.tool}`,
            "---",
            `snapshot_id: ${result.data?.snapshot_id || ""}`,
            `created_at: ${result.data?.created_at || ""}`,
            `trigger: ${result.data?.trigger || "llm_manual"}`,
        ].join("\n");
    }
}
