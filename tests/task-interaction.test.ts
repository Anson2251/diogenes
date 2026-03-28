import { describe, it, expect, beforeEach } from "vitest";

import { createDiogenes } from "../src/index";
import { TaskAskTool } from "../src/tools/task/task-ask";
import { TaskChooseTool } from "../src/tools/task/task-choose";

describe("Task interaction tools", () => {
    let askTool: TaskAskTool;
    let chooseTool: TaskChooseTool;

    beforeEach(() => {
        askTool = new TaskAskTool(async (question) => `answer to: ${question}`);
        chooseTool = new TaskChooseTool(async (_question, options) => options[1] ?? options[0]);
    });

    it("should return user answer from task.ask", async () => {
        const result = await askTool.execute({ question: "What environment should I use?" });

        expect(result.success).toBe(true);
        expect(result.data?.answer).toBe("answer to: What environment should I use?");
    });

    it("should return selected option from task.choose", async () => {
        const result = await chooseTool.execute({
            question: "Pick one",
            options: ["alpha", "beta", "gamma"],
        });

        expect(result.success).toBe(true);
        expect(result.data?.selection).toBe("beta");
    });

    it("should surface handler failures from task.ask", async () => {
        askTool = new TaskAskTool(async () => {
            throw new Error("stdin closed");
        });

        const result = await askTool.execute({ question: "Still there?" });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INTERACTION_ERROR");
        expect(result.error?.message).toContain("stdin closed");
    });

    it("should surface handler failures from task.choose", async () => {
        chooseTool = new TaskChooseTool(async () => {
            throw new Error("invalid selection");
        });

        const result = await chooseTool.execute({
            question: "Pick one",
            options: ["alpha", "beta"],
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INTERACTION_ERROR");
        expect(result.error?.message).toContain("invalid selection");
    });

    it("should reject non-string options for task.choose", async () => {
        const result = await chooseTool.execute({
            question: "Pick one",
            options: ["alpha", 2] as unknown as string[],
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INVALID_PARAMS");
    });

    it("should reject empty options for task.choose", async () => {
        const result = await chooseTool.execute({
            question: "Pick one",
            options: [],
        });

        expect(result.success).toBe(false);
        expect(result.error?.code).toBe("INVALID_PARAM");
    });

    it("should not register interaction tools when disabled", () => {
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: process.cwd(),
                interaction: { enabled: false },
            },
        });

        expect(diogenes.getTool("task.ask")).toBeUndefined();
        expect(diogenes.getTool("task.choose")).toBeUndefined();
    });

    it("should register interaction tools when enabled", () => {
        const diogenes = createDiogenes({
            security: {
                workspaceRoot: process.cwd(),
                interaction: { enabled: true },
            },
        });

        expect(diogenes.getTool("task.ask")).toBeDefined();
        expect(diogenes.getTool("task.choose")).toBeDefined();
    });
});
