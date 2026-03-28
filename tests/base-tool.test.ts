import { describe, it, expect } from "vitest";
import { z } from "zod";

import { BaseTool } from "../src/tools/base-tool";
import { ToolDefinition, ToolResult } from "../src/types";

// Simple test schema
const testSchema = z.object({
    name: z.string().optional(),
    count: z.number().optional(),
    enabled: z.boolean().optional(),
    required: z.string().optional(),
    optional: z.number().optional(),
    items: z.array(z.any()).optional(),
    data: z.object({}).passthrough().optional(),
});

class TestTool extends BaseTool<typeof testSchema> {
    protected schema = testSchema;
    private executeFn: (params: unknown) => Promise<ToolResult>;

    constructor(definition: ToolDefinition, executeFn: (params: unknown) => Promise<ToolResult>) {
        super(definition);
        this.executeFn = executeFn;
    }

    async run(): Promise<ToolResult> {
        return this.executeFn({});
    }

    async testExecute(params: unknown): Promise<ToolResult> {
        return this.execute(params);
    }

    // Expose schema for testing
    getSchema() {
        return this.schema;
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

    describe("execute (schema validation)", () => {
        it("should validate string parameter", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    name: { type: "string", description: "Name parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ name: "test" });

            expect(result.success).toBe(true);
        });

        it("should validate number parameter", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    count: { type: "number", description: "Count parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ count: 42 });

            expect(result.success).toBe(true);
        });

        it("should validate boolean parameter", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    enabled: { type: "bool", description: "Enabled parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ enabled: true });

            expect(result.success).toBe(true);
        });

        it("should validate optional parameter", async () => {
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

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ required: "value" });

            expect(result.success).toBe(true);
        });

        it("should reject wrong parameter type", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    count: { type: "number", description: "Count parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ count: "not a number" });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAMS");
        });

        it("should validate array parameter", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    items: { type: "array", description: "Array parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ items: [1, 2, 3] });

            expect(result.success).toBe(true);
        });

        it("should validate object parameter", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "A test tool",
                params: {
                    data: { type: "object", description: "Object parameter" },
                },
                returns: {},
            };

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = await tool.testExecute({ data: { key: "value" } });

            expect(result.success).toBe(true);
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

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
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

            const tool = new TestTool(definition, () => Promise.resolve({ success: true }));
            const result = tool.error(
                "TEST_ERROR",
                "Test error message",
                { key: "value" },
                "Try again",
            );

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
            expect(result.error?.code).toBe("TEST_ERROR");
            expect(result.error?.message).toBe("Test error message");
            expect(result.error?.details).toEqual({ key: "value" });
            expect(result.error?.suggestion).toBe("Try again");
        });
    });
});
