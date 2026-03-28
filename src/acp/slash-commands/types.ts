import type { ConversationMessage, TaskRunResult } from "../../runtime/task-runner";
import type { SnapshotCreateResult, SnapshotSummary } from "../../snapshot/types";
import type { AvailableCommand, SessionMetadata } from "../types";

export type { SnapshotSummary } from "../../snapshot/types";

export interface ParsedSlashCommand {
    name: string;
    argumentsText: string;
    commandText: string;
    promptText: string;
}

export interface MarkdownSection {
    title: string;
    paragraphs?: string[];
    bullets?: string[];
}

export interface SlashCommandDefinition {
    command: AvailableCommand;
    aliases?: string[];
    skipAutoBeforePromptSnapshot?: boolean;
    execute: (
        context: SlashCommandContext,
        parsed: ParsedSlashCommand,
        turn: number,
    ) => Promise<TaskRunResult>;
}

export interface SlashCommandContext {
    readonly sessionId: string;
    readonly snapshotEnabled: boolean;
    getAvailableCommands(): AvailableCommand[];
    getMetadata(): SessionMetadata;
    getHydratedStateMeta(): {
        loadedDirectories: string[];
        loadedFiles: Array<{ path: string; ranges: Array<{ start: number; end: number }> }>;
        notepad: string[];
    };
    getTodoItemCount(): number;
    listSnapshots(): Promise<SnapshotSummary[]>;
    createSnapshot(input: {
        turn: number;
        label?: string;
        reason?: string;
    }): Promise<SnapshotCreateResult>;
    restoreSnapshotWithNotifications(
        snapshotId: string,
    ): Promise<{ safetySnapshotId: string | null }>;
    runLocalCommand(
        parsed: ParsedSlashCommand,
        action: (
            historyBeforeCommand: ConversationMessage[],
            userMessage: ConversationMessage,
        ) => Promise<TaskRunResult>,
    ): Promise<TaskRunResult>;
    completeLocalCommand(
        historyBeforeCommand: ConversationMessage[],
        userMessage: ConversationMessage,
        summary: string,
        success: boolean,
    ): TaskRunResult;
    renderMarkdownSections(sections: MarkdownSection[]): string;
}
