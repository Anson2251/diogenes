import type { SlashCommandDefinition } from "./types";

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
        execute: async (context, parsed, turn) => context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
            const label = parsed.argumentsText || undefined;
            const result = await context.createSnapshot({
                turn,
                label,
                reason: "Created via ACP slash command",
            });
            const summary = context.renderMarkdownSections([
                {
                    title: "Snapshot Created",
                    bullets: [
                        `**Snapshot ID:** \`${result.snapshotId}\``,
                        `**Label:** ${label ? `\`${label}\`` : "(none)"}`,
                        `**Trigger:** ${result.trigger}`,
                        `**Created At:** ${result.createdAt}`,
                    ],
                },
            ]);
            return context.completeLocalCommand(historyBeforeCommand, userMessage, summary, true);
        }),
    };
}
