import type { AvailableCommand } from "../types";
import type { SlashCommandContext, SlashCommandDefinition } from "./types";

export function createHelpSlashCommand(): SlashCommandDefinition {
    return {
        command: {
            name: "help",
            description: "List available ACP slash commands",
            input: {
                hint: "optional command name, for example snapshot",
            },
            _meta: {
                diogenes: {
                    kind: "help",
                    invocations: ["/help", "/commands"],
                    example: "/help snapshot",
                },
            },
        },
        aliases: ["commands"],
        skipAutoBeforePromptSnapshot: true,
        execute: async (context, parsed) =>
            context.runLocalCommand(parsed, async (historyBeforeCommand, userMessage) => {
                await Promise.resolve();
                const definitions = context.getAvailableCommands();
                const requestedName = parsed.argumentsText.replace(/^\//, "").trim().toLowerCase();
                const matched =
                    requestedName.length > 0
                        ? definitions.find(
                              (command) =>
                                  command.name === requestedName ||
                                  command._meta?.diogenes?.invocations?.includes(
                                      `/${requestedName}`,
                                  ),
                          )
                        : undefined;

                const summary = matched
                    ? formatHelpForCommand(context, matched)
                    : formatHelpSummary(context, definitions);

                return context.completeLocalCommand(
                    historyBeforeCommand,
                    userMessage,
                    summary,
                    true,
                );
            }),
    };
}

function formatHelpSummary(context: SlashCommandContext, definitions: AvailableCommand[]): string {
    return context.renderMarkdownSections([
        {
            title: "ACP Slash Commands",
            paragraphs: ["Available local ACP slash commands:"],
            bullets: definitions.map((command) => {
                const example = command._meta?.diogenes?.example;
                return `\`/${command.name}\` - ${command.description}${example ? ` (example: \`${example}\`)` : ""}`;
            }),
        },
        {
            title: "Usage",
            bullets: [
                "Use `/help <command>` for command-specific details.",
                "Use `/init` for ACP setup steps and config examples.",
                "Use `/doctor` for config, logs, provider, and snapshot diagnostics.",
                "Model definitions are managed outside ACP with `diogenes model ...` commands.",
            ],
        },
    ]);
}

function formatHelpForCommand(context: SlashCommandContext, command: AvailableCommand): string {
    const invocations = command._meta?.diogenes?.invocations ?? [`/${command.name}`];
    const example = command._meta?.diogenes?.example;
    const bullets = [
        `**Invocations:** ${invocations.map((invocation) => `\`${invocation}\``).join(", ")}`,
    ];

    if (command.input?.hint) {
        bullets.push(`**Input:** ${command.input.hint}`);
    }
    if (example) {
        bullets.push(`**Example:** \`${example}\``);
    }

    return context.renderMarkdownSections([
        {
            title: `\`/${command.name}\``,
            paragraphs: [command.description],
            bullets,
        },
    ]);
}
