import type { AvailableCommand } from "../types";
import type { SlashCommandDefinition } from "./types";

export class SlashCommandRegistry {
    private readonly definitions = new Map<string, SlashCommandDefinition>();
    private readonly aliases = new Map<string, string>();

    register(definition: SlashCommandDefinition): void {
        this.definitions.set(definition.command.name, definition);

        for (const alias of definition.aliases ?? []) {
            this.aliases.set(alias, definition.command.name);
        }
    }

    registerAll(definitions: SlashCommandDefinition[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    list(): SlashCommandDefinition[] {
        return Array.from(this.definitions.values());
    }

    listCommands(): AvailableCommand[] {
        return this.list().map((definition) => definition.command);
    }

    find(name: string): SlashCommandDefinition | undefined {
        const canonicalName = this.aliases.get(name) ?? name;
        return this.definitions.get(canonicalName);
    }
}
