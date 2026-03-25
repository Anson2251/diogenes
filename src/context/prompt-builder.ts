import {
    DirectoryWorkspace,
    FileWorkspace,
    TodoWorkspace,
    ContextStatus,
    ContextSections,
    TodoItem,
    NotepadWorkspace,
} from "../types";
import { formatDisplayLine } from "../utils/str";

interface TemplateStrings {
    toolDefinitionsHeader: string;
    toolDefinitionsFooter: string;
    contextStatusHeader: string;
    directoryWorkspaceHeader: string;
    directoryWorkspaceEmpty: string;
    fileWorkspaceHeader: string;
    fileWorkspaceEmpty: string;
    fileUnloadedMarker: string;
    todoWorkspaceHeader: string;
    todoWorkspaceEmpty: string;
    notepadWorkspaceHeader: string;
    notepadWorkspaceEmpty: string;
    sectionDelimiter: string;
    separator: string;
    todoMarkers: Record<TodoItem['state'], string>;
}

const TEMPLATES: TemplateStrings = {
    toolDefinitionsHeader: `## Available Tools
The following tools are available:`,

    toolDefinitionsFooter: `Use these tools by making tool calls with the appropriate parameters.`,

    contextStatusHeader: `## Context Status`,

    directoryWorkspaceHeader: `## Directory Workspace`,

    directoryWorkspaceEmpty: `(empty)`,

    fileWorkspaceHeader: `## File Workspace`,

    fileWorkspaceEmpty: `(empty)`,

    fileUnloadedMarker: `[UNLOADED]`,

    todoWorkspaceHeader: `## Todo`,

    todoWorkspaceEmpty: `(empty)`,

    notepadWorkspaceHeader: `## Notepad`,

    notepadWorkspaceEmpty: `(empty)`,

    sectionDelimiter: `--`,

    separator: `- -`,

    todoMarkers: {
        done: `[x]`,
        active: `[*]`,
        pending: `[ ]`,
    },
};

export class PromptBuilder {
    private tokenLimit: number;
    private currentTokens: number = 0;
    private systemPrompt: string;

    constructor(
        systemPrompt: string,
        tokenLimit: number,
    ) {
        this.tokenLimit = tokenLimit;
        this.systemPrompt = systemPrompt;
    }

    buildContextSections(
        toolDefinitions: string,
        taskPrompt: string,
        contextStatus: ContextStatus,
        directoryWorkspace: DirectoryWorkspace,
        fileWorkspace: FileWorkspace,
        todoWorkspace: TodoWorkspace,
        notepadWorkspace: NotepadWorkspace,
        toolResults: string[],
    ): ContextSections {
        return {
            systemPrompt: this.systemPrompt,
            taskPrompt,
            toolDefinitions: this.formatToolDefinitions(toolDefinitions),
            contextStatus: this.formatContextStatus(contextStatus),
            directoryWorkspace: this.formatDirectoryWorkspace(directoryWorkspace),
            fileWorkspace: this.formatFileWorkspace(fileWorkspace),
            todoWorkspace: this.formatTodoWorkspace(todoWorkspace),
            notepadWorkspace: this.formatNotepadWorkspace(notepadWorkspace),
            toolResults: this.formatToolResults(toolResults),
        };
    }

    assemblePrompt(sections: ContextSections): string {
        const parts = [
            sections.systemPrompt,
            sections.toolDefinitions,
            sections.contextStatus,
            sections.directoryWorkspace,
            sections.fileWorkspace,
            sections.todoWorkspace,
            sections.notepadWorkspace,
            sections.toolResults,
            "",
            sections.taskPrompt,
        ];

        return parts.join("\n\n");
    }

    assembleContextSections(sections: ContextSections): string {
        const parts = [
            sections.toolDefinitions,
            sections.contextStatus,
            sections.directoryWorkspace,
            sections.fileWorkspace,
            sections.todoWorkspace,
            sections.notepadWorkspace,
            sections.toolResults,
        ].filter(Boolean);

        return parts.join("\n\n");
    }

    getSystemPrompt(): string {
        return this.systemPrompt;
    }

    setSystemPrompt(prompt: string): void {
        this.systemPrompt = prompt;
    }

    private formatToolDefinitions(definitions: string): string {
        const parts = [
            TEMPLATES.toolDefinitionsHeader,
            definitions,
            TEMPLATES.toolDefinitionsFooter,
        ];
        return parts.join("\n");
    }

    private formatContextStatus(status: ContextStatus): string {
        const { tokenUsage, directoryWorkspace, fileWorkspace } = status;

        const parts = [
            TEMPLATES.contextStatusHeader,
            `Token Usage: ${tokenUsage.current} / ${tokenUsage.limit} (${tokenUsage.percentage.toFixed(1)}%)`,
            `Directory Workspace: ${directoryWorkspace.count} directories loaded`,
            `File Workspace: ${fileWorkspace.count} files, ${fileWorkspace.totalLines} lines loaded`,
            TEMPLATES.sectionDelimiter,
        ];

        return parts.join("\n");
    }

    private formatDirectoryWorkspace(workspace: DirectoryWorkspace): string {
        if (Object.keys(workspace).length === 0) {
            return [
                TEMPLATES.directoryWorkspaceHeader,
                TEMPLATES.directoryWorkspaceEmpty,
                TEMPLATES.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [TEMPLATES.directoryWorkspaceHeader];

        for (const [dirPath, entries] of Object.entries(workspace)) {
            parts.push(dirPath);
            parts.push(TEMPLATES.separator);

            for (const entry of entries) {
                parts.push(`${entry.type.padEnd(4)} | ${entry.name}`);
            }

            parts.push(TEMPLATES.separator);
            parts.push("");
        }

        if (parts[parts.length - 1] === "") {
            parts.pop();
        }
        parts.push(TEMPLATES.sectionDelimiter);

        return parts.join("\n");
    }

    private formatFileWorkspace(workspace: FileWorkspace): string {
        if (Object.keys(workspace).length === 0) {
            return [
                TEMPLATES.fileWorkspaceHeader,
                TEMPLATES.fileWorkspaceEmpty,
                TEMPLATES.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [TEMPLATES.fileWorkspaceHeader];

        for (const [filePath, entry] of Object.entries(workspace)) {
            parts.push(filePath);
            parts.push(TEMPLATES.separator);

            let currentLine = 1;
            let contentIndex = 0;
            for (const range of entry.ranges.sort((a, b) => a.start - b.start)) {
                if (range.start > currentLine) {
                    parts.push(TEMPLATES.fileUnloadedMarker);
                    parts.push("");
                }

                const rangeLineCount = range.end - range.start + 1;
                const rangeLines = entry.content.slice(contentIndex, contentIndex + rangeLineCount);
                contentIndex += rangeLineCount;

                for (let i = 0; i < rangeLines.length; i++) {
                    const lineNum = range.start + i;
                    const line = rangeLines[i];
                    parts.push(formatDisplayLine(lineNum, line, { padWidth: 3 }));
                }

                currentLine = range.end + 1;
            }

            if (currentLine <= entry.totalLines) {
                parts.push(TEMPLATES.fileUnloadedMarker);
            }

            parts.push(TEMPLATES.separator);
            parts.push("");
        }

        if (parts[parts.length - 1] === "") {
            parts.pop();
        }
        parts.push(TEMPLATES.sectionDelimiter);

        return parts.join("\n");
    }

    private formatTodoWorkspace(workspace: TodoWorkspace): string {
        if (workspace.items.length === 0) {
            return [
                TEMPLATES.todoWorkspaceHeader,
                TEMPLATES.todoWorkspaceEmpty,
                TEMPLATES.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [TEMPLATES.todoWorkspaceHeader];

        for (const item of workspace.items) {
            const marker = TEMPLATES.todoMarkers[item.state] || TEMPLATES.todoMarkers.pending;
            parts.push(`${marker} ${item.text}`);
        }

        parts.push(TEMPLATES.sectionDelimiter);
        return parts.join("\n");
    }

    private formatNotepadWorkspace(workspace: NotepadWorkspace): string {
        if (workspace.lines.length === 0) {
            return [
                TEMPLATES.notepadWorkspaceHeader,
                TEMPLATES.notepadWorkspaceEmpty,
                TEMPLATES.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [TEMPLATES.notepadWorkspaceHeader];
        for (const line of workspace.lines) {
            parts.push(`- ${line}`);
        }
        parts.push(TEMPLATES.sectionDelimiter);
        return parts.join("\n");
    }

    private formatToolResults(results: string[]): string {
        if (results.length === 0) {
            return "";
        }

        return [
            "## Tool Results",
            ...results,
            "--",
        ].join("\n");
    }

    estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    updateTokenUsage(sections: ContextSections): number {
        const fullPrompt = this.assemblePrompt(sections);
        this.currentTokens = this.estimateTokens(fullPrompt);
        return this.currentTokens;
    }

    getCurrentTokens(): number {
        return this.currentTokens;
    }

    getTokenLimit(): number {
        return this.tokenLimit;
    }

    getTokenPercentage(): number {
        return (this.currentTokens / this.tokenLimit) * 100;
    }

    static formatToolDefinitions(
        definitions: import("../types").ToolDefinition[],
    ): string {
        const parts: string[] = [];

        for (const def of definitions) {
            const fullName = `${def.namespace}.${def.name}`;
            parts.push(`## ${fullName}`);
            parts.push(`Description: ${def.description}`);

            if (def.params && Object.keys(def.params).length > 0) {
                parts.push("Parameters:");
                for (const [paramName, param] of Object.entries(def.params)) {
                    const optional = "optional" in param && param.optional ? " (optional)" : "";
                    parts.push(`  - ${paramName}${optional}: ${param.type} - ${param.description}`);
                }
            }

            if (def.returns && Object.keys(def.returns).length > 0) {
                parts.push("Returns:");
                for (const [returnName, returnDesc] of Object.entries(def.returns)) {
                    parts.push(`  - ${returnName}: ${returnDesc}`);
                }
            }

            parts.push("");
        }

        return parts.join("\n");
    }
}
