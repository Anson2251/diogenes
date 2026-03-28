import type { SlashCommandDefinition } from "./types";

function formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
}

function getShortId(snapshotId: string): string {
    // Extract the UUID part and take first 8 chars
    const parts = snapshotId.split("-");
    if (parts.length >= 3) {
        return parts.slice(2).join("-").slice(0, 8);
    }
    return snapshotId.slice(0, 8);
}

export function createSnapshotsSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "snapshots",
            description: "List recent session snapshots",
            input: {
                hint: "optional limit, for example 5",
            },
            _meta: {
                diogenes: {
                    kind: "snapshot_list",
                    invocations: ["/snapshots"],
                    example: "/snapshots 5",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                const requestedLimit = Number.parseInt(parsed.argumentsText, 10);
                const limit =
                    Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 5;
                const snapshots = await context.listSnapshots();
                const recentSnapshots = snapshots.slice(0, limit);

                if (recentSnapshots.length === 0) {
                    const summary = context.renderMarkdownSections([
                        {
                            title: "Snapshots",
                            bullets: [
                                "No session snapshots have been created yet. Use `/snapshot <label>` to create one.",
                            ],
                        },
                    ]);
                    return context.completeLocalCommand(
                        historyBeforeCommand,
                        userMessage,
                        summary,
                        true,
                    );
                }

                const lines: string[] = [
                    `**${snapshots.length} snapshot(s) total** — use \`/restore <id>\` to restore`,
                    "",
                ];

                recentSnapshots.forEach((snapshot, index) => {
                    const shortId = getShortId(snapshot.snapshotId);
                    const timeAgo = formatTimeAgo(snapshot.createdAt);
                    const label = snapshot.label ? ` "${snapshot.label}"` : "";
                    const trigger = snapshot.trigger === "before_prompt" ? "auto" : "manual";

                    lines.push(`${index + 1}. \`${shortId}\`${label} — ${timeAgo} (${trigger})`);
                });

                if (snapshots.length > limit) {
                    lines.push("");
                    lines.push(
                        `*${snapshots.length - limit} more...* — use \`/snapshots ${snapshots.length}\` to see all`,
                    );
                }

                lines.push("");
                lines.push(
                    "💡 **Tip:** Use the number (e.g., `/restore 1`) or short ID (e.g., `/restore abc123`) to restore",
                );

                return context.completeLocalCommand(
                    historyBeforeCommand,
                    userMessage,
                    lines.join("\n"),
                    true,
                );
            }),
    };
}
