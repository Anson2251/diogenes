import { describe, it, expect, beforeEach } from "vitest";
import { TodoSetTool } from "../src/tools/todo/todo-set";
import { TodoUpdateTool } from "../src/tools/todo/todo-update";
import { WorkspaceManager } from "../src/context/workspace";

describe("TodoSetTool", () => {
    let workspace: WorkspaceManager;
    let tool: TodoSetTool;

    beforeEach(() => {
        workspace = new WorkspaceManager("/test");
        tool = new TodoSetTool(workspace);
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("todo");
            expect(def.name).toBe("set");
            expect(def.description).toBe("Overwrite entire todo list");
            expect(def.params.items.type).toBe("array<object>");
        });
    });

    describe("execute", () => {
        it("should set todo items successfully", async () => {
            const result = await tool.execute({
                items: [
                    { text: "Task 1", state: "done" },
                    { text: "Task 2", state: "pending" },
                    { text: "Task 3", state: "active" },
                ],
            });

            expect(result.success).toBe(true);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items).toHaveLength(3);
            expect(todo.items[0].text).toBe("Task 1");
            expect(todo.items[0].state).toBe("done");
            expect(todo.items[1].text).toBe("Task 2");
            expect(todo.items[1].state).toBe("pending");
            expect(todo.items[2].text).toBe("Task 3");
            expect(todo.items[2].state).toBe("active");
        });

        it("should clear todo list with empty array", async () => {
            workspace.setTodoItems([{ text: "Existing", state: "pending" }]);

            const result = await tool.execute({ items: [] });

            expect(result.success).toBe(true);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items).toHaveLength(0);
        });

        it("should reject non-array items", async () => {
            const result = await tool.execute({
                items: "not an array",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAM");
        });

        it("should reject non-object item", async () => {
            const result = await tool.execute({
                items: ["string item"],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_ITEM");
        });

        it("should reject item with missing text", async () => {
            const result = await tool.execute({
                items: [{ state: "done" }],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_ITEM");
        });

        it("should reject item with missing state", async () => {
            const result = await tool.execute({
                items: [{ text: "Task" }],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_ITEM");
        });

        it("should reject item with invalid state", async () => {
            const result = await tool.execute({
                items: [{ text: "Task", state: "invalid" }],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_ITEM");
        });

        it("should reject non-string text", async () => {
            const result = await tool.execute({
                items: [{ text: 123, state: "done" }],
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_ITEM");
        });
    });
});

describe("TodoUpdateTool", () => {
    let workspace: WorkspaceManager;
    let tool: TodoUpdateTool;

    beforeEach(() => {
        workspace = new WorkspaceManager("/test");
        workspace.setTodoItems([
            { text: "Task 1", state: "pending" },
            { text: "Task 2", state: "pending" },
        ]);
        tool = new TodoUpdateTool(workspace);
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("todo");
            expect(def.name).toBe("update");
            expect(def.description).toBe("Update state of a todo item");
            expect(def.params.text.type).toBe("string");
            expect(def.params.state.type).toBe("string");
        });
    });

    describe("execute", () => {
        it("should update item to done state", async () => {
            const result = await tool.execute({
                text: "Task 1",
                state: "done",
            });

            expect(result.success).toBe(true);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items[0].state).toBe("done");
        });

        it("should update item to active state", async () => {
            const result = await tool.execute({
                text: "Task 1",
                state: "active",
            });

            expect(result.success).toBe(true);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items[0].state).toBe("active");
        });

        it("should update item to pending state", async () => {
            workspace.setTodoItems([{ text: "Task", state: "done" }]);

            const result = await tool.execute({
                text: "Task",
                state: "pending",
            });

            expect(result.success).toBe(true);
            const todo = workspace.getTodoWorkspace();
            expect(todo.items[0].state).toBe("pending");
        });

        it("should fail for non-existent item", async () => {
            const result = await tool.execute({
                text: "Non-existent Task",
                state: "done",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("NOT_FOUND");
        });

        it("should fail for invalid state", async () => {
            const result = await tool.execute({
                text: "Task 1",
                state: "invalid",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_STATE");
        });

        it("should require exact text match", async () => {
            const result = await tool.execute({
                text: "task 1",
                state: "done",
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("NOT_FOUND");
        });

        it("should update only matching item", async () => {
            await tool.execute({
                text: "Task 1",
                state: "done",
            });

            const todo = workspace.getTodoWorkspace();
            expect(todo.items[0].state).toBe("done");
            expect(todo.items[1].state).toBe("pending");
        });
    });

    describe("validateParams", () => {
        it("should validate missing text parameter", () => {
            const result = tool.validateParams({
                state: "done",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate missing state parameter", () => {
            const result = tool.validateParams({
                text: "Task",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-string text parameter", () => {
            const result = tool.validateParams({
                text: 123,
                state: "done",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-string state parameter", () => {
            const result = tool.validateParams({
                text: "Task",
                state: 123,
            });

            expect(result.valid).toBe(false);
        });

        it("should validate valid parameters", () => {
            const result = tool.validateParams({
                text: "Task",
                state: "done",
            });

            expect(result.valid).toBe(true);
        });
    });
});
