import { describe, it, expect } from "vitest";
import { TaskEndTool } from "../src/tools/task/task-end";

describe("TaskEndTool", () => {
    let tool: TaskEndTool;

    beforeEach(() => {
        tool = new TaskEndTool();
    });

    describe("getDefinition", () => {
        it("should return correct tool definition", () => {
            const def = tool.getDefinition();

            expect(def.namespace).toBe("task");
            expect(def.name).toBe("end");
            expect(def.description).toBe("End the current task");
            expect(def.params.reason.type).toBe("string");
            expect(def.params.summary.type).toBe("string");
        });
    });

    describe("execute", () => {
        it("should end task successfully", async () => {
            const result = await tool.execute({
                reason: "Task completed successfully",
                summary: "Fixed all type errors and updated documentation",
            });

            expect(result.success).toBe(true);
            expect(result.data?.success).toBe(true);
            expect(result.data?.reason).toBe("Task completed successfully");
            expect(result.data?.summary).toBe("Fixed all type errors and updated documentation");
        });

        it("should handle empty reason", async () => {
            const result = await tool.execute({
                reason: "",
                summary: "Task summary",
            });

            expect(result.success).toBe(true);
        });

        it("should handle empty summary", async () => {
            const result = await tool.execute({
                reason: "Task reason",
                summary: "",
            });

            expect(result.success).toBe(true);
        });

        it("should handle long reason and summary", async () => {
            const longReason = "A".repeat(1000);
            const longSummary = "B".repeat(1000);

            const result = await tool.execute({
                reason: longReason,
                summary: longSummary,
            });

            expect(result.success).toBe(true);
            expect(result.data?.reason).toBe(longReason);
            expect(result.data?.summary).toBe(longSummary);
        });

        it("should handle special characters in reason", async () => {
            const result = await tool.execute({
                reason: "Error: Cannot read property 'x' of undefined\nStack: at line 42",
                summary: "Fixed null pointer exception by adding null check",
            });

            expect(result.success).toBe(true);
        });

        it("should handle unicode characters", async () => {
            const result = await tool.execute({
                reason: "任务完成",
                summary: "修复了所有错误 🔧",
            });

            expect(result.success).toBe(true);
            expect(result.data?.reason).toBe("任务完成");
            expect(result.data?.summary).toBe("修复了所有错误 🔧");
        });
    });

    describe("validateParams", () => {
        it("should validate missing reason parameter", () => {
            const result = tool.validateParams({
                summary: "Task summary",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate missing summary parameter", () => {
            const result = tool.validateParams({
                reason: "Task reason",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-string reason parameter", () => {
            const result = tool.validateParams({
                reason: 123,
                summary: "Task summary",
            });

            expect(result.valid).toBe(false);
        });

        it("should validate non-string summary parameter", () => {
            const result = tool.validateParams({
                reason: "Task reason",
                summary: { text: "summary" },
            });

            expect(result.valid).toBe(false);
        });

        it("should validate valid parameters", () => {
            const result = tool.validateParams({
                reason: "Task reason",
                summary: "Task summary",
            });

            expect(result.valid).toBe(true);
        });
    });
});
