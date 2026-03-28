import { z } from "zod";

import { WorkspaceManager } from "../../context/workspace";
import { ToolCall, ToolResult } from "../../types";
import { BaseTool } from "../base-tool";

const taskNotepadSchema = z.object({
    mode: z.enum(["append", "replace", "clear"]).optional(),
    content: z.union([z.string(), z.array(z.string())]).optional(),
});

type TaskNotepadParams = z.infer<typeof taskNotepadSchema>;

export class TaskNotepadTool extends BaseTool<typeof taskNotepadSchema> {
    protected schema = taskNotepadSchema;

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
                    type: "string",
                    optional: true,
                    description:
                        "Note text as a string or array of strings. Omit only when mode is clear.",
                },
            },
            returns: {
                mode: "Applied mode",
                total_lines: "Total notepad lines after the update",
            },
        });
    }

    run(params: TaskNotepadParams): ToolResult {
        const { mode = "append", content } = params;

        if (mode === "clear") {
            this.workspace.clearNotepad();
            return this.success({ mode, total_lines: 0 });
        }

        if (content === undefined) {
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
            lines,
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
            const resultMode = typeof result.data.mode === "string" ? result.data.mode : undefined;
            const toolMode =
                typeof toolCall.params.mode === "string" ? toolCall.params.mode : undefined;
            const mode = resultMode ?? toolMode ?? "append";
            const totalLines =
                typeof result.data.total_lines === "number" ? result.data.total_lines : 0;
            return [
                `[OK] ${toolCall.tool}`,
                "---",
                `Mode: ${mode}`,
                `Total notepad lines: ${totalLines}`,
            ].join("\n");
        }

        return super.formatResultForLLM(toolCall, result);
    }

    private normalizeContent(content: string | string[]): string[] {
        return typeof content === "string" ? content.split("\n") : content;
    }
}
