import { describe, it, expect, beforeEach } from "vitest";

import { WorkspaceManager } from "../src/context/workspace";
import { TaskNotepadTool } from "../src/tools/task/task-notepad";

describe("TaskNotepadTool", () => {
    let workspace: WorkspaceManager;
    let tool: TaskNotepadTool;

    beforeEach(() => {
        workspace = new WorkspaceManager(process.cwd(), { enabled: false });
        tool = new TaskNotepadTool(workspace);
    });

    it("should append notepad lines", async () => {
        const result = await tool.execute({
            mode: "append",
            content: ["fact one", "fact two"],
        });

        expect(result.success).toBe(true);
        expect(result.data?.lines).toEqual(["fact one", "fact two"]);
        expect(workspace.getNotepadWorkspace().lines).toEqual(["fact one", "fact two"]);
    });

    it("should replace notepad lines", async () => {
        await tool.execute({ mode: "append", content: ["old"] });
        await tool.execute({ mode: "replace", content: ["new"] });

        expect(workspace.getNotepadWorkspace().lines).toEqual(["new"]);
    });

    it("should clear the notepad", async () => {
        await tool.execute({ mode: "append", content: ["old"] });
        const result = await tool.execute({ mode: "clear" });

        expect(result.success).toBe(true);
        expect(workspace.getNotepadWorkspace().lines).toEqual([]);
    });

    it("should require content unless mode is clear", async () => {
        const result = await tool.execute({ mode: "append" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INVALID_PARAM");
    });
});
