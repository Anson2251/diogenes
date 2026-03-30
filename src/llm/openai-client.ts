/**
 * OpenAI-style API client for LLM integration
 */
import { z } from "zod";

// Zod schemas for runtime validation
const OpenAIErrorSchema = z.object({
    error: z.object({
        message: z.string(),
        type: z.string().optional(),
        param: z.string().nullable().optional(),
        code: z.string().nullable().optional(),
    }),
});

const OpenAICompletionResponseSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z
        .array(
            z.object({
                index: z.number(),
                message: z.object({
                    role: z.string(),
                    content: z.string(),
                }),
                finish_reason: z.string(),
            }),
        )
        .nonempty(),
    usage: z
        .object({
            prompt_tokens: z.number(),
            completion_tokens: z.number(),
            total_tokens: z.number(),
        })
        .optional(),
});

const OpenAIStreamChunkSchema = z.object({
    id: z.string(),
    object: z.string(),
    created: z.number(),
    model: z.string(),
    choices: z.array(
        z.object({
            index: z.number(),
            delta: z.object({
                role: z.string().optional(),
                content: z.string().optional(),
                reasoning_content: z.string().optional(),
            }),
            finish_reason: z.string().nullable(),
        }),
    ),
});

export interface OpenAIClientConfig {
    apiKey: string;
    baseURL?: string;
    model?: string;
    timeout?: number;
}

export interface OpenAIMessage {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    name?: string;
    tool_call_id?: string;
}

export interface OpenAICompletionRequest {
    model: string;
    messages: OpenAIMessage[];
    temperature?: number;
    max_tokens?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    stop?: string | string[];
    stream?: boolean;
}

export interface OpenAICompletionResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: string;
            content: string;
        };
        finish_reason: string;
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
}

export interface OpenAIStreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
            reasoning_content?: string;
        };
        finish_reason: string | null;
    }>;
}

export type StreamChunkType = "content" | "reasoning";

export interface StreamCompletionResult {
    content: string;
    reasoning: string;
}

export interface OpenAIErrorResponse {
    error: {
        message: string;
        type: string;
        param: string | null;
        code: string | null;
    };
}

/**
 * Type guards for OpenAI API responses using Zod
 */
function isOpenAIErrorResponse(val: unknown): val is OpenAIErrorResponse {
    const result = OpenAIErrorSchema.safeParse(val);
    return result.success;
}

function isOpenAICompletionResponse(val: unknown): val is OpenAICompletionResponse {
    const result = OpenAICompletionResponseSchema.safeParse(val);
    return result.success;
}

function isOpenAIStreamChunk(val: unknown): val is OpenAIStreamChunk {
    const result = OpenAIStreamChunkSchema.safeParse(val);
    return result.success;
}

import type { LLMClient, LLMClientConfig, StreamChunk } from "./anthropic-client";

export class OpenAIClient implements LLMClient {
    private config: Required<LLMClientConfig>;
    private abortController: AbortController | null = null;
    private abortReason: "timeout" | "cancelled" | null = null;

    constructor(config: LLMClientConfig) {
        this.config = {
            baseURL: config.baseURL || "https://api.openai.com/v1",
            model: config.model || "gpt-4",
            timeout: config.timeout || 60000,
            apiKey: config.apiKey,
        };

        if (!this.config.apiKey) {
            throw new Error("API key is required");
        }

        // Validate base URL format
        try {
            new URL(this.config.baseURL);
        } catch {
            throw new Error(
                `Invalid base URL: ${this.config.baseURL}. Must be a valid URL including protocol (http:// or https://).`,
            );
        }
    }

    /**
     * Create a chat completion
     */
    async createChatCompletion(
        messages: OpenAIMessage[],
        options: Partial<OpenAICompletionRequest> = {},
    ): Promise<string> {
        const request: OpenAICompletionRequest = {
            model: this.config.model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens,
            top_p: options.top_p,
            frequency_penalty: options.frequency_penalty,
            presence_penalty: options.presence_penalty,
            stop: options.stop,
            stream: false, // Stream output is not required
        };

        // Clean up any existing abort controller - abort previous request if still active
        if (this.abortController) {
            this.abortReason = "cancelled";
            this.abortController.abort();
            // Small delay to allow previous request cleanup before creating new controller
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        this.abortController = new AbortController();
        this.abortReason = null;
        const timeoutId = setTimeout(() => {
            this.abortReason = "timeout";
            this.abortController?.abort();
        }, this.config.timeout);

        try {
            const response = await fetch(`${this.config.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: this.abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData: unknown = await response.json();
                if (isOpenAIErrorResponse(errorData)) {
                    throw new Error(`OpenAI API error: ${errorData.error.message}`);
                }
                throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
            }

            const data: unknown = await response.json();
            if (!isOpenAICompletionResponse(data)) {
                throw new Error("Invalid response format from OpenAI API");
            }

            return data.choices[0].message.content;
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    if (this.abortReason === "cancelled") {
                        throw new Error("Request cancelled");
                    }
                    throw new Error(`Request timeout after ${this.config.timeout}ms`);
                }

                // Provide more detailed error messages for fetch failures
                // Sanitize baseURL to prevent potential API key leakage in error messages
                const sanitizedBaseURL = this.config.baseURL.replace(/\/\/([^@]+)@/, "//***@");
                const errorMsg = error.message?.toLowerCase() || "";
                if (
                    errorMsg.includes("fetch") ||
                    errorMsg.includes("network") ||
                    errorMsg.includes("failed")
                ) {
                    let detailedError = `Network error connecting to ${sanitizedBaseURL}: ${error.message}`;

                    // Add specific suggestions based on error
                    if (
                        errorMsg.includes("certificate") ||
                        errorMsg.includes("tls") ||
                        errorMsg.includes("ssl")
                    ) {
                        detailedError +=
                            "\nSSL/TLS certificate issue detected. If using a self-signed certificate, try adding NODE_TLS_REJECT_UNAUTHORIZED=0";
                    } else if (errorMsg.includes("dns") || errorMsg.includes("hostname")) {
                        detailedError +=
                            "\nDNS resolution failed. Check if the API endpoint URL is correct.";
                    } else if (
                        errorMsg.includes("connection refused") ||
                        errorMsg.includes("econnrefused")
                    ) {
                        detailedError +=
                            "\nConnection refused. The API endpoint may be down or unreachable.";
                    } else if (errorMsg.includes("timeout")) {
                        detailedError += `\nRequest timed out after ${this.config.timeout}ms. The server may be slow or network congested.`;
                    }

                    throw new Error(detailedError);
                }

                throw error;
            }
            throw new Error(`Unknown error: ${String(error)}`);
        } finally {
            // Only clear abortController if it's still the one we created
            // This prevents race conditions with concurrent requests
            if (!this.abortController?.signal.aborted) {
                this.abortController = null;
            }
        }
    }

    /**
     * Create a streaming chat completion
     * @param messages - Array of messages
     * @param onChunk - Callback for each chunk received
     * @param options - Request options
     * @returns Full response content after stream completes
     */
    async createChatCompletionStream(
        messages: OpenAIMessage[],
        onChunk: (chunk: StreamChunk) => void,
        options: Partial<OpenAICompletionRequest> = {},
    ): Promise<StreamCompletionResult> {
        const request: OpenAICompletionRequest = {
            model: this.config.model,
            messages,
            temperature: options.temperature ?? 0.7,
            max_tokens: options.max_tokens,
            top_p: options.top_p,
            frequency_penalty: options.frequency_penalty,
            presence_penalty: options.presence_penalty,
            stop: options.stop,
            stream: true, // Enable streaming
        };

        // Clean up any existing abort controller
        if (this.abortController) {
            this.abortReason = "cancelled";
            this.abortController.abort();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
        this.abortController = new AbortController();
        this.abortReason = null;
        const timeoutId = setTimeout(() => {
            this.abortReason = "timeout";
            this.abortController?.abort();
        }, this.config.timeout);

        let fullContent = "";
        let reasoning_text = "";

        try {
            const response = await fetch(`${this.config.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: this.abortController.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorData: unknown = await response.json();
                if (isOpenAIErrorResponse(errorData)) {
                    throw new Error(`OpenAI API error: ${errorData.error.message}`);
                }
                throw new Error(`OpenAI API error: ${JSON.stringify(errorData)}`);
            }

            if (!response.body) {
                throw new Error("Response body is null");
            }

            // Read the stream
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
                const readResult: { done: boolean; value?: unknown } = await reader.read();
                if (readResult.done) break;

                if (!(readResult.value instanceof Uint8Array)) {
                    continue;
                }
                const chunk = decoder.decode(readResult.value, { stream: true });
                const lines = chunk.split("\n");

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || !trimmedLine.startsWith("data: ")) {
                        continue;
                    }

                    const data = trimmedLine.slice(6); // Remove "data: " prefix

                    if (data === "[DONE]") {
                        continue;
                    }

                    try {
                        const parsed: unknown = JSON.parse(data);
                        if (!isOpenAIStreamChunk(parsed)) {
                            continue;
                        }
                        const delta = parsed.choices[0]?.delta;

                        if (delta?.reasoning_content) {
                            reasoning_text += delta.reasoning_content;
                            onChunk({
                                content: delta.reasoning_content,
                                reasoning_content: delta.reasoning_content,
                                finishReason: null,
                            });
                        }

                        if (delta?.content) {
                            // NOTE: Reasoning is kept SEPARATE from output content.
                            // It's emitted via onChunk for user visibility but NOT included
                            // in the assistant's message. This prevents the LLM from seeing
                            // reasoning-style text in its history and continuing to generate
                            // reasoning instead of proper tool calls.
                            fullContent += delta.content;
                            onChunk({ content: delta.content, finishReason: null });
                        }
                    } catch {
                        // Ignore parse errors for malformed chunks
                    }
                }
            }

            return {
                content: fullContent,
                reasoning: reasoning_text.trim(),
            };
        } catch (error) {
            clearTimeout(timeoutId);

            if (error instanceof Error) {
                if (error.name === "AbortError") {
                    if (this.abortReason === "cancelled") {
                        throw new Error("Request cancelled");
                    }
                    throw new Error(`Request timeout after ${this.config.timeout}ms`);
                }

                const sanitizedBaseURL = this.config.baseURL.replace(/\/\/([^@]+)@/, "//***@");
                const errorMsg = error.message?.toLowerCase() || "";
                if (
                    errorMsg.includes("fetch") ||
                    errorMsg.includes("network") ||
                    errorMsg.includes("failed")
                ) {
                    let detailedError = `Network error connecting to ${sanitizedBaseURL}: ${error.message}`;

                    if (
                        errorMsg.includes("certificate") ||
                        errorMsg.includes("tls") ||
                        errorMsg.includes("ssl")
                    ) {
                        detailedError +=
                            "\nSSL/TLS certificate issue detected. If using a self-signed certificate, try adding NODE_TLS_REJECT_UNAUTHORIZED=0";
                    } else if (errorMsg.includes("dns") || errorMsg.includes("hostname")) {
                        detailedError +=
                            "\nDNS resolution failed. Check if the API endpoint URL is correct.";
                    } else if (
                        errorMsg.includes("connection refused") ||
                        errorMsg.includes("econnrefused")
                    ) {
                        detailedError +=
                            "\nConnection refused. The API endpoint may be down or unreachable.";
                    } else if (errorMsg.includes("timeout")) {
                        detailedError += `\nRequest timed out after ${this.config.timeout}ms. The server may be slow or network congested.`;
                    }

                    throw new Error(detailedError);
                }

                throw error;
            }
            throw new Error(`Unknown error: ${String(error)}`);
        } finally {
            if (!this.abortController?.signal.aborted) {
                this.abortController = null;
            }
        }
    }

    /**
     * Abort any ongoing request
     */
    abort(): void {
        if (this.abortController) {
            this.abortReason = "cancelled";
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * Update configuration
     */
    updateConfig(config: Partial<LLMClientConfig>): void {
        this.config = {
            ...this.config,
            ...config,
        };
    }

    /**
     * Get current configuration
     */
    getConfig(): Required<LLMClientConfig> {
        return { ...this.config };
    }
}
