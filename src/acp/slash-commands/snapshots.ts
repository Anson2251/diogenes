import type { SlashCommandDefinition } from "./types";

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
        execute: async (context, parsed) => context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
            const requestedLimit = Number.parseInt(parsed.argumentsText, 10);
            const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? requestedLimit : 5;
            const snapshots = await context.listSnapshots();
            const recentSnapshots = snapshots.slice(0, limit);
            const summary = recentSnapshots.length === 0
                ? context.renderMarkdownSections([
                    {
                        title: "Snapshots",
                        bullets: ["No session snapshots have been created yet."],
                    },
                ])
                : [
                    context.renderMarkdownSections([
                        {
                            title: "Snapshots",
                            paragraphs: [`Showing ${recentSnapshots.length} of ${snapshots.length} snapshot(s).`],
                        },
                    ]),
                    "",
                    "| Snapshot ID | Trigger | Label | Created At |",
                    "| --- | --- | --- | --- |",
                    ...recentSnapshots.map(
                        (snapshot) => `| \`${snapshot.snapshotId}\` | ${snapshot.trigger} | ${snapshot.label || "(no label)"} | ${snapshot.createdAt} |`,
                    ),
                ].join("\n");

            return context.completeLocalCommand(historyBeforeCommand, userMessage, summary, true);
        }),
    };
}
