import type { SlashCommandDefinition } from "./types";

function getShortId(snapshotId: string): string {
    const parts = snapshotId.split("-");
    if (parts.length >= 3) {
        return parts.slice(2).join("-").slice(0, 8);
    }
    return snapshotId.slice(0, 8);
}

export function createSnapshotSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "snapshot",
            description: "Create a defensive session snapshot",
            input: {
                hint: "optional label for the snapshot",
            },
            _meta: {
                diogenes: {
                    kind: "session_snapshot",
                    invocations: ["/snapshot"],
                    example: "/snapshot before-risky-edit",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed, turn) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                const label = parsed.argumentsText || undefined;
                const result = await context.createSnapshot({
                    turn,
                    label,
                    reason: "Created via ACP slash command",
                });

                const shortId = getShortId(result.snapshotId);
                const labelText = label ? ` "${label}"` : "";

                const message = [
                    `✅ **Snapshot created**${labelText}`,
                    "",
                    `**ID:** \`${shortId}\` (use this to restore)`,
                    `**Time:** ${new Date(result.createdAt).toLocaleString()}`,
                    "",
                    `💡 Use \`/restore ${shortId}\` to go back to this point`,
                ].join("\n");

                return context.completeLocalCommand(
                    historyBeforeCommand,
                    userMessage,
                    message,
                    true,
                );
            }),
    };
}
