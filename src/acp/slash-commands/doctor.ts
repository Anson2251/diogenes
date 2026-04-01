import type { SlashCommandDefinition } from "./types";

export function createDoctorSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "doctor",
            description: "Inspect ACP setup, provider env vars, and snapshot readiness",
            _meta: {
                diogenes: {
                    kind: "setup_doctor",
                    invocations: ["/doctor"],
                    example: "/doctor",
                },
            },
        },
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                await Promise.resolve();
                const diagnostics = context.getSetupDiagnostics();
                const providerBullets = diagnostics.providers.map(
                    (provider) =>
                        `**${provider.provider}:** ${provider.configured ? "configured" : "missing"} via \`${provider.envVarName}\``,
                );
                const snapshotBullets = [
                    `**Mode:** ${diagnostics.snapshot.mode}`,
                    `**Requested:** ${diagnostics.snapshot.requested ? "yes" : "no"}`,
                    `**Binary:** ${diagnostics.snapshot.resticBinary ? `\`${diagnostics.snapshot.resticBinary}\`` : "(not set)"}`,
                ];
                if (diagnostics.snapshot.unavailablePhase) {
                    snapshotBullets.push(`**Phase:** ${diagnostics.snapshot.unavailablePhase}`);
                }
                if (diagnostics.snapshot.unavailableKind) {
                    snapshotBullets.push(`**Kind:** ${diagnostics.snapshot.unavailableKind}`);
                }
                if (diagnostics.snapshot.unavailableReason) {
                    snapshotBullets.push(`**Reason:** ${diagnostics.snapshot.unavailableReason}`);
                }

                const summary = context.renderMarkdownSections([
                    {
                        title: "Setup",
                        bullets: [
                            `**Config Dir:** \`${diagnostics.configDir}\``,
                            `**Data Dir:** \`${diagnostics.dataDir}\``,
                            `**ACP Logs Dir:** \`${diagnostics.acpLogsDir}\``,
                            `**ACP Current Log:** \`${diagnostics.acpCurrentLogFile}\``,
                            `**Config File:** ${diagnostics.configExists ? "present" : "missing"} at \`${diagnostics.configPath}\``,
                            `**Models File:** ${diagnostics.modelsExists ? "present" : "missing"} at \`${diagnostics.modelsPath}\``,
                        ],
                    },
                    {
                        title: "Providers",
                        bullets: providerBullets,
                    },
                    {
                        title: "Snapshots",
                        bullets: snapshotBullets,
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
