import { describe, it, expect } from "vitest";
import { BaseTool } from "../src/tools/base-tool";
import { ToolDefinition, ToolResult } from "../src/types";

class TestTool extends BaseTool {
    private executeFn: (params: unknown) => Promise<ToolResult>;

    constructor(
        definition: ToolDefinition,
        executeFn: (params: unknown) => Promise<ToolResult>,
    ) {
        super(definition);
        this.executeFn = executeFn;
    }

    async execute(params: unknown): Promise<ToolResult> {
        return this.executeFn(params);
    }
}

describe("BaseTool", () => {
    describe("getDefinition", () => {
        it("should return the tool definition", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    param1: { type: "string", description: "A parameter" },
                },
                returns: {
                    result: "The result",
                },
            };

            const tool = new TestTool(definition, async () => ({ success: true }));
            const result = tool.getDefinition();

            expect(result).toEqual(definition);
        });
    });

    describe("validateParams", () => {
        it("should validate string parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    name: { type: "string", description: "Name parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ name: "test" });

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.data).toEqual({ name: "test" });
        });

        it("should validate number parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    count: { type: "number", description: "Count parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ count: 42 });

            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.data).toEqual({ count: 42 });
        });

        it("should validate boolean parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    enabled: { type: "bool", description: "Enabled parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ enabled: true });

            expect(result.valid).toBe(true);
            expect(result.data).toEqual({ enabled: true });
        });

        it("should validate optional parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    required: { type: "string", description: "Required param" },
                    optional: { type: "number", optional: true, description: "Optional param" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ required: "value" });

            expect(result.valid).toBe(true);
            expect(result.data).toEqual({ required: "value" });
        });

        it("should reject missing required parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    required: { type: "string", description: "Required param" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({});

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should reject wrong parameter type", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    count: { type: "number", description: "Count parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ count: "not a number" });

            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        it("should validate array parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    items: { type: "array", description: "Array parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ items: [1, 2, 3] });

            expect(result.valid).toBe(true);
            expect(result.data).toEqual({ items: [1, 2, 3] });
        });

        it("should validate object parameter", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    data: { type: "object", description: "Object parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.validateParams({ data: { key: "value" } });

            expect(result.valid).toBe(true);
            expect(result.data).toEqual({ data: { key: "value" } });
        });
    });

    describe("success method", () => {
        it("should return a successful result with data", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {},
                returns: { result: "The result" },
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.success({ result: "test value" });

            expect(result.success).toBe(true);
            expect(result.data).toEqual({ result: "test value" });
            expect(result.error).toBeUndefined();
        });
    });

    describe("error method", () => {
        it("should return an error result with code and message", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {},
                returns: {},
            };

            const tool = new TestTool(definition, () => ({ success: true }));
            const result = tool.error("TEST_ERROR", "Test error message", { key: "value" }, "Try again");

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.code).toBe("TEST_ERROR");
            expect(result.error?.message).toBe("Test error message");
            expect(result.error?.details).toEqual({ key: "value" });
            expect(result.error?.suggestion).toBe("Try again");
        });
    });
});
