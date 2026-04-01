import { createDoctorSlashCommand } from "./doctor";
import { createHelpSlashCommand } from "./help";
import { createInitSlashCommand } from "./init";
import { SlashCommandRegistry } from "./registry";
import { createRestoreSlashCommand } from "./restore";
import { createSessionSlashCommand } from "./session";
import { createSnapshotSlashCommand } from "./snapshot";
import { createSnapshotsSlashCommand } from "./snapshots";

export function createBaseSlashCommandRegistry(): SlashCommandRegistry {
    const registry = new SlashCommandRegistry();
    registry.registerAll([
        createHelpSlashCommand(),
        createSessionSlashCommand(),
        createInitSlashCommand(),
        createDoctorSlashCommand(),
    ]);
    return registry;
}

export function createSnapshotSlashCommands() {
    return [
        createRestoreSlashCommand(),
        createSnapshotsSlashCommand(),
        createSnapshotSlashCommand(),
    ];
}

export { SlashCommandRegistry } from "./registry";
export type {
    MarkdownSection,
    ParsedSlashCommand,
    SlashCommandContext,
    SlashCommandDefinition,
} from "./types";
