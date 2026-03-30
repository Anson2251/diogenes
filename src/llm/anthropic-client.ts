/**
 * Anthropic API client for LLM integration
 * Provides OpenAI-compatible interface wrapper around Anthropic's API
 */
import { z } from "zod";

// Anthropic API response schemas
const AnthropicErrorSchema = z.object({
    error: z.object({
        type: z.string(),
        message: z.string(),
    }),
});

const AnthropicStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("message_start"),
        message: z.object({
            id: z.string(),
            type: z.literal("message"),
            role: z.literal("assistant"),
            content: z.array(z.any()),
            model: z.string(),
        }),
    }),
    z.object({
        type: z.literal("content_block_start"),
        index: z.number(),
        content_block: z.object({
            type: z.string(),
            text: z.string().optional(),
        }),
    }),
    z.object({
        type: z.literal("content_block_delta"),
        index: z.number(),
        delta: z.object({
            type: z.string(),
            text: z.string(),
        }),
    }),
    z.object({
        type: z.literal("content_block_stop"),
        index: z.number(),
    }),
    z.object({
        type: z.literal("message_delta"),
        delta: z.object({
            stop_reason: z.string().nullable().optional(),
            stop_sequence: z.string().nullable().optional(),
        }),
        usage: z
            .object({
                output_tokens: z.number(),
            })
            .optional(),
    }),
    z.object({
        type: z.literal("message_stop"),
    }),
    z.object({
        type: z.literal("error"),
        error: z.object({
            type: z.string(),
            message: z.string(),
        }),
    }),
]);

const StreamReadResultSchema = z.union([
    z.object({
        done: z.literal(true),
    }),
    z.object({
        done: z.literal(false),
        value: z.instanceof(Uint8Array),
    }),
]);

export interface AnthropicClientConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    timeout?: number;
}

export interface AnthropicMessage {
    role: "user" | "assistant";
    content: string;
}

const TOOL_RESULT_PREFIX = "[Tool Result]\n";

export interface AnthropicRequest {
    model: string;
    messages: AnthropicMessage[];
    max_tokens: number;
    temperature?: number;
    top_p?: number;
    stream?: boolean;
    system?: string;
    stop_sequences?: string[];
}

export interface StreamChunk {
    content: string;
    reasoning_content?: string;
    finishReason: string | null;
}

export interface LLMClientConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    timeout?: number;
}

/**
 * Common LLM client interface for both OpenAI and Anthropic
 */
export interface LLMClient {
    createChatCompletionStream(
        messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string }>,
        onChunk: (chunk: StreamChunk) => void,
        options?: {
            model?: string;
            temperature?: number;
            max_tokens?: number;
            top_p?: number;
            stop?: string | string[];
        },
    ): Promise<{ content: string; reasoning?: string }>;
    abort(): void;
    updateConfig(config: Partial<LLMClientConfig>): void;
    getConfig(): Required<LLMClientConfig>;
}

/**
 * Converts OpenAI-style messages to Anthropic format
 */
function convertMessages(
    messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string }>,
): { systemPrompt?: string; messages: AnthropicMessage[] } {
    const anthropicMessages: AnthropicMessage[] = [];
    let systemPrompt: string | undefined;

    for (const msg of messages) {
        if (msg.role === "system") {
            // Anthropic uses a separate system parameter
            systemPrompt = msg.content;
        } else if (msg.role === "user") {
            anthropicMessages.push({
                role: "user",
                content: msg.content,
            });
        } else if (msg.role === "assistant") {
            anthropicMessages.push({
                role: "assistant",
                content: msg.content,
            });
        } else if (msg.role === "tool") {
            anthropicMessages.push({
                role: "user",
                content: `${TOOL_RESULT_PREFIX}${msg.content}`,
            });
        }
    }

    return { systemPrompt, messages: anthropicMessages };
}

export class AnthropicClient {
    private config: Required<AnthropicClientConfig>;
    private abortController: AbortController | null = null;

    constructor(config: AnthropicClientConfig) {
        this.config = {
            apiKey: config.apiKey,
            baseURL: config.baseURL || "https://api.anthropic.com/v1",
            model: config.model || "claude-sonnet-4-20250514",
            timeout: config.timeout || 60000,
        };
    }

    /**
     * Create a chat completion with streaming support
     */
    async createChatCompletionStream(
        messages: Array<{ role: string; content: string; name?: string; tool_call_id?: string }>,
        onChunk: (chunk: StreamChunk) => void,
        options?: {
            model?: string;
            temperature?: number;
            max_tokens?: number;
            top_p?: number;
            stop?: string | string[];
        },
    ): Promise<{ content: string; reasoning?: string }> {
        const { systemPrompt, messages: anthropicMessages } = convertMessages(messages);

        const anthropicRequest: AnthropicRequest = {
            model: options?.model || this.config.model,
            messages: anthropicMessages,
            max_tokens: options?.max_tokens || 4096,
            temperature: options?.temperature,
            top_p: options?.top_p,
            stream: true,
            system: systemPrompt,
            stop_sequences: options?.stop
                ? Array.isArray(options.stop)
                    ? options.stop
                    : [options.stop]
                : undefined,
        };

        this.abortController = new AbortController();
        const timeoutId = setTimeout(() => {
            this.abortController?.abort();
        }, this.config.timeout);

        let fullContent = "";

        try {
            const response = await fetch(`${this.config.baseURL}/messages`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": this.config.apiKey,
                    "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify(anthropicRequest),
                signal: this.abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorText = await response.text();
                let errorMessage = `Anthropic API error: ${response.status}`;
                try {
                    const errorData = AnthropicErrorSchema.parse(JSON.parse(errorText));
                    errorMessage = `Anthropic API error: ${errorData.error.message}`;
                } catch {
                    // Use generic error message
                }
                throw new Error(errorMessage);
            }

            if (!response.body) {
                throw new Error("No response body from Anthropic API");
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";

            try {
                while (true) {
                    const readResult = StreamReadResultSchema.parse(await reader.read());
                    if (readResult.done) {
                        break;
                    }

                    const chunk = readResult.value;
                    buffer += decoder.decode(chunk, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.trim() === "" || !line.startsWith("data: ")) continue;

                        const data = line.slice(6);
                        if (data === "[DONE]") continue;

                        try {
                            const event: unknown = JSON.parse(data);
                            const parsedEvent = AnthropicStreamEventSchema.parse(event);

                            switch (parsedEvent.type) {
                                case "message_start":
                                case "content_block_start":
                                case "content_block_stop":
                                case "message_stop":
                                    break;
                                case "content_block_delta":
                                    if (parsedEvent.delta.text) {
                                        fullContent += parsedEvent.delta.text;
                                        onChunk({
                                            content: parsedEvent.delta.text,
                                            finishReason: null,
                                        });
                                    }
                                    break;
                                case "message_delta":
                                    if (parsedEvent.delta.stop_reason) {
                                        onChunk({
                                            content: "",
                                            finishReason: parsedEvent.delta.stop_reason,
                                        });
                                    }
                                    break;
                                case "error":
                                    throw new Error(`Stream error: ${parsedEvent.error.message}`);
                            }
                        } catch {
                            // Skip malformed events
                            continue;
                        }
                    }
                }
            } finally {
                reader.releaseLock();
            }

            return { content: fullContent };
        } catch (error) {
            clearTimeout(timeoutId);
            if (error instanceof Error && error.name === "AbortError") {
                throw new Error("Request was aborted");
            }
            throw error;
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Abort the current request
     */
    abort(): void {
        this.abortController?.abort();
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<LLMClientConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get current configuration
     */
    getConfig(): Required<LLMClientConfig> {
        return { ...this.config };
    }
}
