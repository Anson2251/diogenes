import type { SlashCommandDefinition } from "./types";

export function createRestoreSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "restore",
            description: "Restore a session snapshot",
            input: {
                hint: "snapshot id, for example snapshot-123",
            },
            _meta: {
                diogenes: {
                    kind: "snapshot_restore",
                    invocations: ["/restore"],
                    example: "/restore snapshot-123",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) => context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
            const snapshotId = parsed.argumentsText || undefined;
            const snapshots = await context.listSnapshots();
            const hasSnapshot = snapshotId
                ? snapshots.some((snapshot) => snapshot.snapshotId === snapshotId)
                : false;
            const recentSnapshotIds = snapshots.slice(0, 5).map((snapshot) => snapshot.snapshotId);

            if (!snapshotId) {
                const summary = context.renderMarkdownSections([
                    {
                        title: "Restore",
                        paragraphs: ["Choose a snapshot id, then run `/restore <snapshot-id>`."],
                        bullets: [
                            `Current session: \`${context.sessionId}\``,
                            recentSnapshotIds.length > 0
                                ? `Available snapshot ids: ${recentSnapshotIds.map((id) => `\`${id}\``).join(", ")}`
                                : "No session snapshots are available yet.",
                        ],
                    },
                ]);
                return context.completeLocalCommand(historyBeforeCommand, userMessage, summary, false);
            }

            if (!hasSnapshot) {
                const summary = context.renderMarkdownSections([
                    {
                        title: "Restore",
                        bullets: [
                            `No snapshot with id \`${snapshotId}\` was found for this session.`,
                            recentSnapshotIds.length > 0
                                ? `Recent snapshot ids: ${recentSnapshotIds.map((id) => `\`${id}\``).join(", ")}`
                                : "No session snapshots are available yet.",
                        ],
                    },
                ]);
                return context.completeLocalCommand(historyBeforeCommand, userMessage, summary, false);
            }

            const restoreResult = await context.restoreSnapshotWithNotifications(snapshotId);
            const summary = context.renderMarkdownSections([
                {
                    title: "Restore",
                    paragraphs: ["Snapshot restore completed."],
                    bullets: [
                        `**Session ID:** \`${context.sessionId}\``,
                        `**Snapshot ID:** \`${snapshotId}\``,
                        restoreResult.safetySnapshotId
                            ? `**Safety Snapshot:** \`${restoreResult.safetySnapshotId}\``
                            : "**Safety Snapshot:** (not available)",
                    ],
                },
                recentSnapshotIds.length > 0
                    ? {
                        title: "Recent Snapshot IDs",
                        bullets: recentSnapshotIds.map((id) => `\`${id}\``),
                    }
                    : {
                        title: "Recent Snapshot IDs",
                        bullets: ["No session snapshots are available yet."],
                    },
            ]);

            return context.completeLocalCommand(historyBeforeCommand, userMessage, summary, true);
        }),
    };
}
