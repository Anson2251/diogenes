/**
 * OpenAI-style API client for LLM integration
 */

export interface OpenAIClientConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  timeout?: number;
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
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

export interface OpenAIErrorResponse {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

export class OpenAIClient {
  private config: Required<OpenAIClientConfig>;
  private abortController: AbortController | null = null;

  constructor(config: OpenAIClientConfig) {
    this.config = {
      baseURL: config.baseURL || 'https://api.openai.com/v1',
      model: config.model || 'gpt-4',
      timeout: config.timeout || 30000,
      apiKey: config.apiKey,
    };

    if (!this.config.apiKey) {
      throw new Error('API key is required');
    }

    // Validate base URL format
    try {
      new URL(this.config.baseURL);
    } catch {
      throw new Error(`Invalid base URL: ${this.config.baseURL}. Must be a valid URL including protocol (http:// or https://).`);
    }
  }

  /**
   * Create a chat completion
   */
  async createChatCompletion(
    messages: OpenAIMessage[],
    options: Partial<OpenAICompletionRequest> = {}
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

    // Clean up any existing abort controller
    if (this.abortController) {
      this.abortController.abort();
    }

    this.abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.abortController?.abort();
    }, this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(request),
        signal: this.abortController.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json() as OpenAIErrorResponse;
        throw new Error(`OpenAI API error: ${errorData.error.message}`);
      }

      const data = await response.json() as OpenAICompletionResponse;
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No completion choices returned');
      }

      return data.choices[0].message.content;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Request timeout after ${this.config.timeout}ms`);
        }
        
        // Provide more detailed error messages for fetch failures
        const errorMsg = error.message.toLowerCase();
        if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('failed')) {
          let detailedError = `Network error connecting to ${this.config.baseURL}: ${error.message}`;
          
          // Add specific suggestions based on error
          if (errorMsg.includes('certificate') || errorMsg.includes('tls') || errorMsg.includes('ssl')) {
            detailedError += '\nSSL/TLS certificate issue detected. If using a self-signed certificate, try adding NODE_TLS_REJECT_UNAUTHORIZED=0';
          } else if (errorMsg.includes('dns') || errorMsg.includes('hostname')) {
            detailedError += '\nDNS resolution failed. Check if the API endpoint URL is correct.';
          } else if (errorMsg.includes('connection refused') || errorMsg.includes('econnrefused')) {
            detailedError += '\nConnection refused. The API endpoint may be down or unreachable.';
          } else if (errorMsg.includes('timeout')) {
            detailedError += `\nRequest timed out after ${this.config.timeout}ms. The server may be slow or network congested.`;
          }
          
          throw new Error(detailedError);
        }
        
        throw error;
      }
      
      throw new Error(`Unknown error: ${String(error)}`);
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Abort any ongoing request
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<OpenAIClientConfig>): void {
    this.config = {
      ...this.config,
      ...config,
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): Required<OpenAIClientConfig> {
    return { ...this.config };
  }
}