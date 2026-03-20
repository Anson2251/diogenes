/**
 * Prompt builder for assembling context sections using templates
 */

import {
    DirectoryWorkspace,
    FileWorkspace,
    TodoWorkspace,
    ContextStatus,
    ContextSections,
    TodoItem,
} from "../types";

interface Templates {
    systemPrompt: string;
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
    sectionDelimiter: string;
    separator: string;
    todoMarkers: Record<TodoItem['state'], string>;
}

// Default templates bundled in code
const DEFAULT_TEMPLATES: Templates = {
    systemPrompt: `You are a helpful AI assistant with access to a workspace system. You can manipulate files, directories, and manage tasks using the available tools.

When working with files:
- Always read a file before editing it to ensure accuracy
- Use the file.edit tool for precise, surgical edits
- Verify your changes by reading the file again if needed

When working with directories:
- Load directories you need to work with using dir.list
- Unload directories when no longer needed to save context space

Use the todo system to track your progress on multi-step tasks.`,

    toolDefinitionsHeader: `=========AVAILABLE TOOLS
The following tools are available for you to use:`,

    toolDefinitionsFooter: `Use these tools by making tool calls with the appropriate parameters.`,

    contextStatusHeader: `=========CONTEXT STATUS`,

    directoryWorkspaceHeader: `=========DIRECTORY WORKSPACE`,

    directoryWorkspaceEmpty: `(empty)`,

    fileWorkspaceHeader: `=========FILE WORKSPACE`,

    fileWorkspaceEmpty: `(empty)`,

    fileUnloadedMarker: `[UNLOADED]`,

    todoWorkspaceHeader: `=========TODO`,

    todoWorkspaceEmpty: `(empty)`,

    sectionDelimiter: `=========`,

    separator: `---------`,

    todoMarkers: {
        done: `[x]`,
        active: `[*]`,
        pending: `[ ]`,
    },
};

export class PromptBuilder {
    private tokenLimit: number;
    private currentTokens: number = 0;
    private templates: Templates;

    constructor(
        systemPrompt: string,
        tokenLimit: number,
    ) {
        this.tokenLimit = tokenLimit;
        // Clone default templates
        this.templates = { ...DEFAULT_TEMPLATES };
        // Override system prompt from config if provided
        if (systemPrompt) {
            this.templates.systemPrompt = systemPrompt;
        }
    }

    buildContextSections(
        toolDefinitions: string,
        taskPrompt: string,
        contextStatus: ContextStatus,
        directoryWorkspace: DirectoryWorkspace,
        fileWorkspace: FileWorkspace,
        todoWorkspace: TodoWorkspace,
        toolResults: string[],
    ): ContextSections {
        return {
            systemPrompt: this.formatSystemPrompt(),
            taskPrompt,
            toolDefinitions: this.formatToolDefinitions(
                toolDefinitions,
            ),
            contextStatus: this.formatContextStatus(contextStatus),
            directoryWorkspace:
                this.formatDirectoryWorkspace(directoryWorkspace),
            fileWorkspace: this.formatFileWorkspace(fileWorkspace),
            todoWorkspace: this.formatTodoWorkspace(todoWorkspace),
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
            sections.toolResults,
            "",
            sections.taskPrompt,
        ];

        return parts.join("\n\n");
    }

    /**
     * Assemble only the context sections (without system prompt and task)
     * For use when system prompt is sent separately as a system message
     */
    assembleContextSections(sections: ContextSections): string {
        const parts = [
            sections.toolDefinitions,
            sections.contextStatus,
            sections.directoryWorkspace,
            sections.fileWorkspace,
            sections.todoWorkspace,
            sections.toolResults,
        ].filter(Boolean); // Remove empty strings

        return parts.join("\n\n");
    }

    getSystemPrompt(): string {
        return this.templates.systemPrompt;
    }

    private formatSystemPrompt(): string {
        return this.templates.systemPrompt;
    }

    private formatToolDefinitions(definitions: string): string {
        const parts = [
            this.templates.toolDefinitionsHeader,
            definitions,
            this.templates.toolDefinitionsFooter,
        ];
        return parts.join("\n");
    }

    private formatContextStatus(status: ContextStatus): string {
        const { tokenUsage, directoryWorkspace, fileWorkspace } =
            status;

        const parts = [
            this.templates.contextStatusHeader,
            `Token Usage: ${tokenUsage.current} / ${tokenUsage.limit} (${tokenUsage.percentage.toFixed(1)}%)`,
            `Directory Workspace: ${directoryWorkspace.count} directories loaded`,
            `File Workspace: ${fileWorkspace.count} files, ${fileWorkspace.totalLines} lines loaded`,
            this.templates.sectionDelimiter,
        ];

        return parts.join("\n");
    }

    private formatDirectoryWorkspace(
        workspace: DirectoryWorkspace,
    ): string {
        if (Object.keys(workspace).length === 0) {
            return [
                this.templates.directoryWorkspaceHeader,
                this.templates.directoryWorkspaceEmpty,
                this.templates.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [
            this.templates.directoryWorkspaceHeader,
        ];

        for (const [dirPath, entries] of Object.entries(workspace)) {
            parts.push(dirPath);
            parts.push(this.templates.separator);

            for (const entry of entries) {
                parts.push(
                    `${entry.type.padEnd(4)} | ${entry.name}`,
                );
            }

            parts.push(this.templates.separator);
            parts.push("");
        }

        // Remove last empty line and add closing marker
        if (parts[parts.length - 1] === "") {
            parts.pop();
        }
        parts.push(this.templates.sectionDelimiter);

        return parts.join("\n");
    }

    private formatFileWorkspace(
        workspace: FileWorkspace,
    ): string {
        if (Object.keys(workspace).length === 0) {
            return [
                this.templates.fileWorkspaceHeader,
                this.templates.fileWorkspaceEmpty,
                this.templates.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [this.templates.fileWorkspaceHeader];

        for (const [filePath, entry] of Object.entries(workspace)) {
            parts.push(filePath);
            parts.push(this.templates.separator);

            let currentLine = 1;
            for (const range of entry.ranges.sort(
                (a, b) => a.start - b.start,
            )) {
                // Add [UNLOADED] marker if there's a gap
                if (range.start > currentLine) {
                    parts.push(this.templates.fileUnloadedMarker);
                    parts.push("");
                }

                // Add lines in this range
                const rangeStartIndex = range.start - 1;
                const rangeEndIndex = range.end;
                const rangeLines = entry.content.slice(
                    rangeStartIndex,
                    rangeEndIndex,
                );

                for (let i = 0; i < rangeLines.length; i++) {
                    const lineNum = range.start + i;
                    const line = rangeLines[i];
                    parts.push(
                        `${lineNum.toString().padStart(3)} | ${line}`,
                    );
                }

                currentLine = range.end + 1;
            }

            // Add final [UNLOADED] if file continues beyond loaded ranges
            if (currentLine <= entry.totalLines) {
                parts.push(this.templates.fileUnloadedMarker);
            }

            parts.push(this.templates.separator);
            parts.push("");
        }

        // Remove last empty line and add closing marker
        if (parts[parts.length - 1] === "") {
            parts.pop();
        }
        parts.push(this.templates.sectionDelimiter);

        return parts.join("\n");
    }

    private formatTodoWorkspace(workspace: TodoWorkspace): string {
        if (workspace.items.length === 0) {
            return [
                this.templates.todoWorkspaceHeader,
                this.templates.todoWorkspaceEmpty,
                this.templates.sectionDelimiter,
            ].join("\n");
        }

        const parts: string[] = [this.templates.todoWorkspaceHeader];

        for (const item of workspace.items) {
            const marker =
                this.templates.todoMarkers[item.state] ||
                this.templates.todoMarkers.pending;
            parts.push(`${marker} ${item.text}`);
        }

        parts.push(this.templates.sectionDelimiter);
        return parts.join("\n");
    }

    private formatToolResults(results: string[]): string {
        if (results.length === 0) {
            return "";
        }

        return [
            "=========TOOL RESULTS",
            ...results,
            "=========",
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

    /**
     * Format tool definitions from the tool registry
     */
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
                for (const [paramName, param] of Object.entries(
                    def.params,
                )) {
                    const optional =
                        "optional" in param && param.optional
                            ? " (optional)"
                            : "";
                    parts.push(
                        `  - ${paramName}${optional}: ${param.type} - ${param.description}`,
                    );
                }
            }

            if (def.returns && Object.keys(def.returns).length > 0) {
                parts.push("Returns:");
                for (const [returnName, returnDesc] of Object.entries(
                    def.returns,
                )) {
                    parts.push(`  - ${returnName}: ${returnDesc}`);
                }
            }

            parts.push("");
        }

        return parts.join("\n");
    }
}
