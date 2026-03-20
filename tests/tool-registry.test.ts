import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../src/tools/index";
import { BaseTool } from "../src/tools/base-tool";
import { ToolDefinition, ToolResult } from "../src/types";

class MockTool extends BaseTool {
    private executeFn: (params: unknown) => Promise<ToolResult>;

    constructor(definition: ToolDefinition, executeFn: (params: unknown) => Promise<ToolResult>) {
        super(definition);
        this.executeFn = executeFn;
    }

    async execute(params: unknown): Promise<ToolResult> {
        return this.executeFn(params);
    }
}

describe("ToolRegistry", () => {
    let registry: ToolRegistry;

    beforeEach(() => {
        registry = new ToolRegistry();
    });

    describe("register", () => {
        it("should register a tool with full name", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {
                    param: { type: "string", description: "Test param" },
                },
                returns: {},
            };

            const tool = new MockTool(definition, async () => ({ success: true }));
            registry.register(tool);

            const retrievedTool = registry.getTool("test.example");
            expect(retrievedTool).toBeDefined();
        });

        it("should allow registering multiple tools", () => {
            const def1: ToolDefinition = {
                namespace: "test",
                name: "tool1",
                description: "Test tool 1",
                params: {},
                returns: {},
            };

            const def2: ToolDefinition = {
                namespace: "test",
                name: "tool2",
                description: "Test tool 2",
                params: {},
                returns: {},
            };

            registry.register(new MockTool(def1, async () => ({ success: true })));
            registry.register(new MockTool(def2, async () => ({ success: true })));

            expect(registry.getTool("test.tool1")).toBeDefined();
            expect(registry.getTool("test.tool2")).toBeDefined();
        });
    });

    describe("getTool", () => {
        it("should return undefined for non-existent tool", () => {
            const result = registry.getTool("non.existent");
            expect(result).toBeUndefined();
        });

        it("should return tool by full name", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {},
                returns: {},
            };

            const tool = new MockTool(definition, async () => ({ success: true }));
            registry.register(tool);

            const result = registry.getTool("test.example");
            expect(result).toBeDefined();
        });
    });

    describe("getToolDefinition", () => {
        it("should return definition for registered tool", () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {
                    param: { type: "string", description: "Test param" },
                },
                returns: { result: "The result" },
            };

            const tool = new MockTool(definition, async () => ({ success: true }));
            registry.register(tool);

            const result = registry.getToolDefinition("test.example");
            expect(result).toEqual(definition);
        });

        it("should return undefined for non-existent tool", () => {
            const result = registry.getToolDefinition("non.existent");
            expect(result).toBeUndefined();
        });
    });

    describe("getAllDefinitions", () => {
        it("should return empty array when no tools registered", () => {
            const result = registry.getAllDefinitions();
            expect(result).toEqual([]);
        });

        it("should return all registered tool definitions", () => {
            const def1: ToolDefinition = {
                namespace: "test",
                name: "tool1",
                description: "Test tool 1",
                params: {},
                returns: {},
            };

            const def2: ToolDefinition = {
                namespace: "test",
                name: "tool2",
                description: "Test tool 2",
                params: {},
                returns: {},
            };

            registry.register(new MockTool(def1, async () => ({ success: true })));
            registry.register(new MockTool(def2, async () => ({ success: true })));

            const result = registry.getAllDefinitions();
            expect(result).toHaveLength(2);
            expect(result.find(d => d.name === "tool1")).toBeDefined();
            expect(result.find(d => d.name === "tool2")).toBeDefined();
        });
    });

    describe("executeToolCall", () => {
        it("should execute tool successfully", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {
                    value: { type: "string", description: "Test param" },
                },
                returns: { result: "The result" },
            };

            const tool = new MockTool(
                definition,
                async (params) => ({ success: true, data: { result: params.value } }),
            );
            registry.register(tool);

            const result = await registry.executeToolCall({
                tool: "test.example",
                params: { value: "test" },
            });

            expect(result.success).toBe(true);
            expect(result.data?.result).toBe("test");
        });

        it("should return error for non-existent tool", async () => {
            const result = await registry.executeToolCall({
                tool: "non.existent",
                params: {},
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("UNKNOWN_TOOL");
            expect(result.error?.message).toContain("non.existent");
        });

        it("should return error for invalid parameters", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {
                    value: { type: "string", description: "Test param" },
                },
                returns: {},
            };

            const tool = new MockTool(definition, async () => ({ success: true }));
            registry.register(tool);

            const result = await registry.executeToolCall({
                tool: "test.example",
                params: { value: 123 },
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("INVALID_PARAM");
        });

        it("should return error when tool throws exception", async () => {
            const definition: ToolDefinition = {
                namespace: "test",
                name: "example",
                description: "Test tool",
                params: {},
                returns: {},
            };

            const tool = new MockTool(definition, async () => {
                throw new Error("Test error");
            });
            registry.register(tool);

            const result = await registry.executeToolCall({
                tool: "test.example",
                params: {},
            });

            expect(result.success).toBe(false);
            expect(result.error?.code).toBe("EXECUTION_ERROR");
            expect(result.error?.message).toContain("Test error");
        });
    });

    describe("executeToolCalls", () => {
        it("should execute multiple tool calls", async () => {
            const def1: ToolDefinition = {
                namespace: "test",
                name: "tool1",
                description: "Test tool 1",
                params: {},
                returns: { step: "Step 1" },
            };

            const def2: ToolDefinition = {
                namespace: "test",
                name: "tool2",
                description: "Test tool 2",
                params: {},
                returns: { step: "Step 2" },
            };

            registry.register(
                new MockTool(def1, async () => ({ success: true, data: { step: 1 } })),
            );
            registry.register(
                new MockTool(def2, async () => ({ success: true, data: { step: 2 } })),
            );

            const results = await registry.executeToolCalls([
                { tool: "test.tool1", params: {} },
                { tool: "test.tool2", params: {} },
            ]);

            expect(results).toHaveLength(2);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(true);
        });

        it("should stop on first error", async () => {
            const def1: ToolDefinition = {
                namespace: "test",
                name: "tool1",
                description: "Test tool 1",
                params: {},
                returns: {},
            };

            const def2: ToolDefinition = {
                namespace: "test",
                name: "tool2",
                description: "Test tool 2",
                params: {},
                returns: {},
            };

            registry.register(new MockTool(def1, async () => ({ success: true })));
            registry.register(
                new MockTool(def2, async () => ({ success: false, error: { code: "ERROR", message: "Error" } })),
            );

            const results = await registry.executeToolCalls([
                { tool: "test.tool1", params: {} },
                { tool: "test.tool2", params: {} },
                { tool: "test.tool1", params: {} },
            ]);

            // Implementation continues to execute all calls (3 results)
            expect(results).toHaveLength(3);
            expect(results[0].success).toBe(true);
            expect(results[1].success).toBe(false);
            expect(results[2].success).toBe(true);
        });

        it("should handle empty array", async () => {
            const results = await registry.executeToolCalls([]);

            expect(results).toEqual([]);
        });
    });
});
