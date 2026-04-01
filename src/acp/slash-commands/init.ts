import type { SlashCommandDefinition } from "./types";

export function createInitSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "init",
            description: "Show ACP setup state and the shortest next steps",
            _meta: {
                diogenes: {
                    kind: "setup_init",
                    invocations: ["/init"],
                    example: "/init",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                await Promise.resolve();
                const diagnostics = context.getSetupDiagnostics();
                const configuredProviders = diagnostics.providers.filter(
                    (provider) => provider.configured,
                );
                const providerLine =
                    configuredProviders.length > 0
                        ? configuredProviders
                              .map((provider) => `\`${provider.provider}\``)
                              .join(", ")
                        : "none detected";
                const nextSteps = [
                    configuredProviders.length > 0
                        ? `Configured providers: ${providerLine}`
                        : `Set one provider API key, for example \`${diagnostics.providers[0]?.envVarName || "OPENAI_API_KEY"}\``,
                    diagnostics.snapshot.mode === "enabled"
                        ? "Snapshots are ready for this ACP session."
                        : diagnostics.snapshot.mode === "degraded"
                          ? `Snapshots are temporarily disabled: ${diagnostics.snapshot.unavailableReason}`
                          : "Snapshots are currently disabled.",
                    "Use `/doctor` for a detailed readiness report.",
                    "Use `/session` to inspect the current session state.",
                ];

                const summary = context.renderMarkdownSections([
                    {
                        title: "ACP Init",
                        bullets: [
                            `**Config File:** \`${diagnostics.configPath}\``,
                            `**Models File:** \`${diagnostics.modelsPath}\``,
                        ],
                    },
                    {
                        title: "Next Steps",
                        bullets: nextSteps,
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
