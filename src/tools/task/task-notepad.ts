import { BaseTool } from "../base-tool";
import { ToolCall, ToolResult } from "../../types";
import { WorkspaceManager } from "../../context/workspace";

type NotepadMode = "append" | "replace" | "clear";

interface TaskNotepadParams {
    mode?: NotepadMode;
    content?: string | string[];
}

export class TaskNotepadTool extends BaseTool {
    constructor(private readonly workspace: WorkspaceManager) {
        super({
            namespace: "task",
            name: "notepad",
            description: `Write short working notes that stay available after files are unloaded.

Use this to preserve summaries, decisions, or facts you still need after calling file.unload or dir.unload.
- append: add note lines
- replace: replace the whole notepad
- clear: remove all notes`,
            params: {
                mode: {
                    type: "string",
                    optional: true,
                    description: "One of: append, replace, clear. Default: append",
                },
                content: {
                    type: "content",
                    optional: true,
                    description: "Note text as a string or array of strings. Omit only when mode is clear.",
                },
            },
            returns: {
                mode: "Applied mode",
                total_lines: "Total notepad lines after the update",
            },
        });
    }

    async execute(params: unknown): Promise<ToolResult> {
        const validation = this.validateParams(params);
        if (!validation.valid || !validation.data) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.notepad",
                { errors: validation.errors },
                "Provide mode and note content. Use clear with no content when you want to reset the notepad.",
            );
        }

        const { mode = "append", content } = validation.data as TaskNotepadParams;
        if (!["append", "replace", "clear"].includes(mode)) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.notepad",
                { mode },
                "Mode must be one of: append, replace, clear",
            );
        }

        if (mode === "clear") {
            this.workspace.clearNotepad();
            return this.success({ mode, total_lines: 0 });
        }

        if (!this.isSupportedContent(content)) {
            return this.error(
                "INVALID_PARAM",
                "Invalid parameters for task.notepad",
                { content },
                "Content must be a string or array of strings",
            );
        }

        const lines = this.normalizeContent(content);

        if (mode === "replace") {
            this.workspace.setNotepadLines(lines);
        } else {
            this.workspace.appendNotepadLines(lines);
        }

        return this.success({
            mode,
            total_lines: this.workspace.getNotepadWorkspace().lines.length,
        });
    }

    formatResult(result: ToolResult): string | undefined {
        if (result.success && result.data) {
            return `\x1b[36m\x1b[1mNotepad updated\x1b[0m (${result.data.mode}, ${result.data.total_lines} lines)`;
        }
        return undefined;
    }

    formatResultForLLM(toolCall: ToolCall, result: ToolResult): string {
        if (result.success && result.data) {
            const mode = typeof result.data.mode === "string" ? result.data.mode : toolCall.params.mode || "append";
            const totalLines = typeof result.data.total_lines === "number" ? result.data.total_lines : 0;
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Mode: ${mode}`,
                `Total notepad lines: ${totalLines}`,
            ].join("\n");
        }

        return super.formatResultForLLM(toolCall, result);
    }

    validateParams(params: unknown): { valid: boolean; errors: string[]; data?: unknown } {
        const base = super.validateParams(params ?? {});
        if (!base.valid || !base.data) {
            return base;
        }

        const data = base.data as TaskNotepadParams;
        const errors: string[] = [];
        if (data.mode !== undefined && !["append", "replace", "clear"].includes(data.mode)) {
            errors.push("mode: Must be one of append, replace, clear");
        }
        if (data.mode !== "clear" && data.content !== undefined && !this.isSupportedContent(data.content)) {
            errors.push("content: Expected string or array of strings");
        }
        if (data.mode !== "clear" && data.content === undefined) {
            errors.push("content: Required unless mode is clear");
        }

        if (errors.length > 0) {
            return { valid: false, errors };
        }

        return { valid: true, errors: [], data };
    }

    private isSupportedContent(content: unknown): content is string | string[] {
        return typeof content === "string" ||
            (Array.isArray(content) && content.every((line) => typeof line === "string"));
    }

    private normalizeContent(content: string | string[]): string[] {
        return typeof content === "string" ? content.split("\n") : content;
    }
}
