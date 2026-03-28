import type { SlashCommandDefinition } from "./types";

export function createSessionSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "session",
            description: "Show current session status and metadata",
            _meta: {
                diogenes: {
                    kind: "session_status",
                    invocations: ["/session", "/status"],
                    example: "/session",
                },
            },
        },
        aliases: ["status"],
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                await Promise.resolve();
                const metadata = context.getMetadata();
                const hydratedState = context.getHydratedStateMeta();
                const loadedDirectories = Array.isArray(hydratedState.loadedDirectories)
                    ? hydratedState.loadedDirectories.length
                    : 0;
                const loadedFiles = Array.isArray(hydratedState.loadedFiles)
                    ? hydratedState.loadedFiles.length
                    : 0;
                const notepadLines = Array.isArray(hydratedState.notepad)
                    ? hydratedState.notepad.length
                    : 0;
                const summary = context.renderMarkdownSections([
                    {
                        title: "Session",
                        bullets: [
                            `**Session ID:** \`${metadata.sessionId}\``,
                            `**State:** ${metadata.state}${metadata.hasActiveRun ? " (busy)" : ""}`,
                            `**Workspace:** \`${metadata.cwd}\``,
                            `**Title:** ${metadata.title || "(none)"}`,
                            `**Description:** ${metadata.description || "(none)"}`,
                            `**Snapshots:** ${context.snapshotEnabled ? "enabled" : "disabled"}`,
                            `**Updated At:** ${metadata.updatedAt}`,
                        ],
                    },
                    {
                        title: "Workspace State",
                        bullets: [
                            `**Loaded Directories:** ${loadedDirectories}`,
                            `**Loaded Files:** ${loadedFiles}`,
                            `**Todo Items:** ${context.getTodoItemCount()}`,
                            `**Notepad Lines:** ${notepadLines}`,
                        ],
                    },
                ]);

                return context.completeLocalCommand(
                    historyBeforeCommand,
                    userMessage,
                    summary,
                    true,
                );
            }),
    };
}
