import { PassThrough } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACPServer } from "../src/acp/server";
import { startACPServer } from "../src/acp/stdio-transport";
import { OpenAIClient } from "../src/llm/openai-client";

function createStreamingResponse(chunks: string[]): Response {
    const encoder = new TextEncoder();

    return new Response(
        new ReadableStream({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                }
                controller.close();
            },
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "text/event-stream",
            },
        },
    );
}

async function waitFor<T>(getValue: () => T | undefined, timeoutMs = 200): Promise<T> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const value = getValue();
        if (value !== undefined) {
            return value;
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throw new Error("Timed out waiting for value");
}

describe("ACPServer", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("handles initialize and session/new", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
        });

        const initialize = await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });
        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });

        expect(initialize && "result" in initialize && initialize.result.protocolVersion).toBe(1);
        expect(sessionNew && "result" in sessionNew && sessionNew.result.sessionId).toBeTypeOf("string");
        expect(notifications).toHaveLength(0);
    });

    it("streams session updates during prompt execution", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async (_messages, onChunk) => {
                onChunk({ type: "reasoning", content: "**" });
                onChunk({ type: "content", content: "Running tools...\n" });
                onChunk({ type: "content", content: "```to" });
                onChunk({ type: "content", content: 'ol-call\n[{"tool":"task.end","params":{"reason":"done","summary":"Finished via ACP"}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"Finished via ACP"}}]\n```',
                    reasoning: "",
                };
            },
        );

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });

        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Finish the task" }],
            },
        });

        const finalResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );

        expect(promptResponse).toBeNull();
        expect(finalResponse && "result" in finalResponse && finalResponse.result.stopReason).toBe("end_turn");
        expect(notifications.some((item) => item.method === "session/update")).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call"
                    && item.params.update.title === "Finishing task"
                    && item.params.update.kind === "other",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.status === "completed",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.status === "completed"
                    && Array.isArray(item.params.update.content)
                    && item.params.update.content[0]?.content?.text === "Finished via ACP",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "tool_call_update"
                    && item.params.update.rawOutput?.success === true,
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "**",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "Running tools...\n",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && item.params.update.content.text === "Finished via ACP",
            ),
        ).toBe(true);
        expect(
            notifications.some(
                (item) => item.params.update.sessionUpdate === "agent_message_chunk"
                    && typeof item.params.update.content.text === "string"
                    && item.params.update.content.text.includes("```tool-call"),
            ),
        ).toBe(false);
    });

    it("uses unique toolCallIds across iterations within the same prompt run", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream")
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({ type: "content", content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["round one"]}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["round one"]}}]\n```',
                    reasoning: "",
                };
            })
            .mockImplementationOnce(async (_messages, onChunk) => {
                onChunk({ type: "content", content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"round two"}}]\n```' });
                return {
                    content: '```tool-call\n[{"tool":"task.end","params":{"reason":"done","summary":"round two"}}]\n```',
                    reasoning: "",
                };
            });

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });
        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Take two tool-call rounds" }],
            },
        });

        const finalResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );
        const toolCallIds = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call")
            .map((item) => item.params.update.toolCallId);

        expect(promptResponse).toBeNull();
        expect(finalResponse?.result?.stopReason).toBe("end_turn");
        expect(toolCallIds).toHaveLength(2);
        expect(new Set(toolCallIds).size).toBe(2);
        expect(toolCallIds[0]).not.toBe(toolCallIds[1]);
    });

    it("uses unique toolCallIds for multiple tool calls in the same iteration", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async (_messages, onChunk) => {
                onChunk({
                    type: "content",
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["one"]}},{"tool":"task.end","params":{"reason":"done","summary":"two"}}]\n```',
                });
                return {
                    content: '```tool-call\n[{"tool":"task.notepad","params":{"mode":"append","content":["one"]}},{"tool":"task.end","params":{"reason":"done","summary":"two"}}]\n```',
                    reasoning: "",
                };
            },
        );

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });
        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Emit two tool calls in one turn" }],
            },
        });
        await waitFor(() => responses.find((response) => response.id === 3));

        const toolCallIds = notifications
            .filter((item) => item.params?.update?.sessionUpdate === "tool_call")
            .map((item) => item.params.update.toolCallId);

        expect(toolCallIds).toHaveLength(2);
        expect(new Set(toolCallIds).size).toBe(2);
        expect(toolCallIds[0]).not.toBe(toolCallIds[1]);
    });

    it("sends a final reply over stdio with a mocked OpenAI stream", async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const error = new PassThrough();
        const lines: string[] = [];
        const errors: string[] = [];

        output.setEncoding("utf-8");
        output.on("data", (chunk: string) => {
            lines.push(
                ...chunk
                    .split("\n")
                    .map((line) => line.trim())
                    .filter(Boolean),
            );
        });
        error.setEncoding("utf-8");
        error.on("data", (chunk: string) => {
            errors.push(chunk);
        });

        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            createStreamingResponse([
                "data: {\"id\":\"cmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Working...\\n\"},\"finish_reason\":null}]}\n\n",
                "data: {\"id\":\"cmpl-test\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"gpt-4\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"```tool-call\\n[{\\\"tool\\\":\\\"task.end\\\",\\\"params\\\":{\\\"reason\\\":\\\"done\\\",\\\"summary\\\":\\\"Mock reply delivered\\\"}}]\\n```\"},\"finish_reason\":null}]}\n\n",
                "data: [DONE]\n\n",
            ]),
        );

        startACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4", baseURL: "https://mock-openai.test/v1" },
            },
            input: input as NodeJS.ReadStream,
            output: output as NodeJS.WriteStream,
            error: error as NodeJS.WriteStream,
        });

        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n`);
        input.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "session/new", params: { cwd: process.cwd() } })}\n`);
        await new Promise((resolve) => setTimeout(resolve, 0));

        const sessionNewResponse = lines
            .map((line) => JSON.parse(line))
            .find((message) => message.id === 2);
        const sessionId = sessionNewResponse?.result?.sessionId as string;

        input.write(`${JSON.stringify({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Finish the task" }],
            },
        })}\n`);
        await new Promise((resolve) => setTimeout(resolve, 20));

        const messages = lines.map((line) => JSON.parse(line));
        const workingChunkIndex = messages.findIndex(
            (message) => message.method === "session/update"
                && message.params?.update?.sessionUpdate === "agent_message_chunk"
                && typeof message.params?.update?.content?.text === "string"
                && message.params.update.content.text.includes("Working..."),
        );
        const promptResponseIndex = messages.findIndex((message) => message.id === 3);
        const promptResponse = messages.find((message) => message.id === 3);
        const finalReply = messages.find(
            (message) => message.method === "session/update"
                && message.params?.update?.sessionUpdate === "agent_message_chunk"
                && message.params?.update?.content?.text === "Mock reply delivered",
        );
        const toolCallChunk = messages.find(
            (message) => message.method === "session/update"
                && message.params?.update?.sessionUpdate === "agent_message_chunk"
                && typeof message.params?.update?.content?.text === "string"
                && message.params.update.content.text.includes("```tool-call"),
        );

        expect(errors).toEqual([]);
        expect(workingChunkIndex).toBeGreaterThanOrEqual(0);
        expect(promptResponseIndex).toBeGreaterThan(workingChunkIndex);
        expect(promptResponse?.result?.stopReason).toBe("end_turn");
        expect(finalReply).toBeDefined();
        expect(toolCallChunk).toBeUndefined();
    });

    it("supports cancellation for an active prompt turn", async () => {
        const notifications: Array<{ method: string; params: any }> = [];
        const responses: any[] = [];
        const server = new ACPServer({
            config: {
                llm: { apiKey: "test-key", model: "gpt-4" },
            },
            notify: (method, params) => notifications.push({ method, params }),
            respond: (response) => responses.push(response),
        });

        let cancelled = false;
        vi.spyOn(OpenAIClient.prototype, "abort").mockImplementation(function () {
            cancelled = true;
        });
        vi.spyOn(OpenAIClient.prototype, "createChatCompletionStream").mockImplementation(
            async () => {
                while (!cancelled) {
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
                throw new Error("Request cancelled");
            },
        );

        await server.handleMessage({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: 1 },
        });
        const sessionNew = await server.handleMessage({
            jsonrpc: "2.0",
            id: 2,
            method: "session/new",
            params: { cwd: process.cwd() },
        });
        const sessionId =
            sessionNew && "result" in sessionNew ? sessionNew.result.sessionId as string : "";

        const promptStartResponse = await server.handleMessage({
            jsonrpc: "2.0",
            id: 3,
            method: "session/prompt",
            params: {
                sessionId,
                prompt: [{ type: "text", text: "Start a long-running task" }],
            },
        });

        await new Promise((resolve) => setTimeout(resolve, 0));

        const cancelResponse = await server.handleMessage({
            jsonrpc: "2.0",
            method: "session/cancel",
            params: { sessionId },
        });
        const promptResponse = await waitFor(
            () => responses.find((response) => response.id === 3),
        );

        expect(promptStartResponse).toBeNull();
        expect(cancelResponse).toBeNull();
        expect(promptResponse && "result" in promptResponse && promptResponse.result.stopReason).toBe("cancelled");
        expect(cancelled).toBe(true);
        expect(notifications).toEqual([]);
    });
});
