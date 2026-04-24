# LLM Tool Calling Format Research Report

## Research Objectives

Design an extensible multi-format Tool Calling system for Diogenes by researching tool calling implementations across mainstream LLM providers.

## Provider Comparison Overview

| Provider | API Format | Native Function Calling | Text Format | Characteristics |
|----------|------------|------------------------|-------------|-----------------|
| OpenAI | OpenAI-compatible | ✅ Full | JSON Array | Industry standard |
| DeepSeek | OpenAI-compatible | ✅ Full (1M context) | XML (`<\|DSML\|>`) | V4-Pro/Flash, interleaved thinking |
| GLM | OpenAI-compatible | ✅ Full (200K context) | JSON | 744B MoE, Apache 2.0 |
| MiniMax | OpenAI/Anthropic-compatible | ✅ Full | `<think>` tags | Native interleaved thinking |
| Qwen | OpenAI-compatible | ✅ Full | JSON | Alibaba Cloud, vLLM support |
| Anthropic | Claude-specific | ✅ Full | XML/JSON | Interleaved thinking (Claude 4) |
| Gemini | Gemini-specific | ✅ Full | JSON/Object | Function Declaration |
| Ollama | OpenAI-compatible | ✅ Partial | Function tags | Depends on underlying model |
| vLLM | OpenAI-compatible | ✅ Partial | JSON Array | Open-source inference engine |

---

## 1. OpenAI

### API Endpoint
```
POST https://api.openai.com/v1/chat/completions
```

### Request Format
```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string", "description": "City name"}
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

### Response Format
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\":\"San Francisco\"}"
        }
      }]
    }
  }]
}
```

### Tool Response
```json
{
  "role": "tool",
  "tool_call_id": "call_abc123",
  "content": "Sunny, 72°F"
}
```

### Characteristics
- ✅ Most mature function calling implementation
- ✅ Supports parallel function calling
- ✅ Supports `strict: true` for forced schema compliance
- ✅ Tool calls passed via `delta.tool_calls` in streaming responses

---

## 2. DeepSeek

### API Endpoints
```
POST https://api.deepseek.com/chat/completions      (OpenAI-compatible)
POST https://api.deepseek.com/beta/chat/completions (Beta features)
```

### Models (Updated 2025)
| Model Name | Mapping | Context | Tool Calling |
|------------|---------|---------|--------------|
| `deepseek-v4-pro` | DeepSeek-V4-Pro | 1M tokens | ✅ Full support |
| `deepseek-v4-flash` | DeepSeek-V4-Flash | 1M tokens | ✅ Full support |
| `deepseek-chat` | DeepSeek-V3.2 (non-thinking) | 64K/128K | ✅ Full support |
| `deepseek-reasoner` | DeepSeek-V3.2 (thinking mode) | 64K/128K | ⚠️ No tool calls during thinking |

**Note:** DeepSeek-R1-0528 supports tool calling but **NOT during thinking**. Tools can only be called in non-thinking turns.

### Native Function Calling
**Fully compatible with OpenAI format**
```json
{
  "model": "deepseek-v4-pro",
  "messages": [...],
  "tools": [...],
  "tool_choice": "auto"
}
```

### Thinking Mode with Tools (V3.2+)
```typescript
// Request with thinking enabled
{
  "model": "deepseek-reasoner",
  "messages": [...],
  "thinking": {
    "type": "enabled"
  },
  "reasoning_effort": "high",  // "low" | "medium" | "high"
  "tools": [...],
  "tool_choice": "auto"
}

// Response includes reasoning_content
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "The weather is sunny...",
      "reasoning_content": "Let me check the weather...",  // Thinking process
      "tool_calls": [...]  // Only present in non-thinking turns
    }
  }]
}
```

**Important:** When continuing a conversation after tool results, you **MUST** include the `reasoning_content` in the assistant message:
```json
{
  "role": "assistant",
  "content": "...",
  "reasoning_content": "..."  // Required for thinking mode continuation
}
```

### Strict Mode (Beta)
```json
{
  "type": "function",
  "function": {
    "name": "get_weather",
    "strict": true,
    "parameters": {
      "type": "object",
      "properties": {...},
      "required": ["location"],
      "additionalProperties": false
    }
  }
}
```

### Text Format (DeepSeek XML)
Format mentioned in DeepSeek V4 paper:

```xml
<|DSML|tool_calls>
<|DSML|invoke name="file.load">
<|DSML|parameter name="path" string="true">src/index.ts</|DSML|parameter>
<|DSML|parameter name="start" string="false">1</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>
```

**Parameter specifications:**
- `string="true"` - String parameters, used as plain text
- `string="false"` - Non-string parameters, in JSON format

### Characteristics
- ✅ **Latest Models (2025):** `deepseek-v4-pro`, `deepseek-v4-flash` with 1M context
- ✅ Fully compatible with OpenAI API format
- ✅ Supports strict mode (beta) for guaranteed schema compliance
- ✅ Supports up to 128 parallel tool calls
- ❌ **No interleaved thinking:** R1 cannot think between tool calls (unlike Claude 4)
- ⚠️ **Thinking mode limitation:** R1 models support tool calling but NOT during thinking
- ⚠️ **Must include `reasoning_content`** when continuing conversations in thinking mode
- 🔥 Unique `<|DSML|...>` XML format (for text-based parsing)

---

## Interleaved Thinking Support by Provider

| Provider | Model | Interleaved Thinking | Description |
|----------|-------|---------------------|-------------|
| **Claude 4** | Sonnet 4.6, Opus 4.5 | ✅ **Supported** | Native interleaved thinking with beta header |
| **DeepSeek** | R1/R1-0528 | ❌ **Not Supported** | Sequential: Think → Tool → Answer |
| **DeepSeek** | V3.2/V4/V4-Pro | ✅ **Supported** | "Thinking in Tool-Use" - integrated reasoning |
| **GLM** | GLM-5/GLM-5.1 | ✅ **Supported** | Thinking + tool calling with `reasoning_content` |
| **MiniMax** | M2/M2.1/M2.7 | ✅ **Supported** | Native interleaved thinking, `<think>` tags |
| **Qwen** | Qwen3/Qwen3-Coder | ✅ **Supported** | OpenAI-compatible function calling + reasoning |
| **OpenAI** | o3, o4-mini | ✅ **Supported** | Reasoning + tool use interleaved |

### What is Interleaved Thinking?

Interleaved thinking allows a model to:
1. **Reason about tool results** before deciding next steps
2. **Chain multiple tool calls** with reasoning steps in between
3. **Make nuanced decisions** based on intermediate results

```
Non-Interleaved (DeepSeek-R1):
[Think] → [Tool Call] → [Answer]
     ↑_________________↓
     (No thinking during/after tool)

Interleaved (Claude 4, DeepSeek-V4):
[Think] → [Tool Call] → [Think] → [Tool Call] → [Answer]
              ↑___________↓
              (Can think between tools)
```

### Claude 4 Interleaved Thinking Example

```typescript
// Enable with beta header
const response = await client.messages.create({
  model: "claude-sonnet-4-6-20250514",
  max_tokens: 4096,
  tools: [...],
  thinking: { type: "enabled" },
  messages: [...],
  extra_headers: {
    "anthropic-beta": "interleaved-thinking-2025-05-14"
  }
});

// Claude can now:
// 1. Think about what tools to call
// 2. Call tool A
// 3. Think about result of A
// 4. Decide to call tool B based on that thought
// 5. Think about result of B
// 6. Provide final answer
```

---

## 3. GLM (Zhipu AI)

### API Endpoint
```
POST https://api.z.ai/api/paas/v4/chat/completions  (OpenAI-compatible)
POST https://open.bigmodel.cn/api/paas/v4/chat/completions  (BigModel Platform)
```

### Models
- `glm-5` - 744B MoE (40B active), 200K context, Apache 2.0 license
- `glm-5.1` - Enhanced agentic model, #1 on SWE-Bench Pro

### Request Format
```json
{
  "model": "glm-5",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "thinking": {
    "type": "enabled"
  },
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

### Response Format
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "The weather is sunny...",
      "reasoning_content": "Let me check the weather API...",  // Thinking process
      "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {
          "name": "get_weather",
          "arguments": "{\"location\":\"San Francisco\"}"
        }
      }]
    }
  }]
}
```

### Characteristics
- ✅ OpenAI-compatible API
- ✅ 744B MoE architecture (40B active)
- ✅ 200K context window
- ✅ Thinking mode with `reasoning_content`
- ✅ Supports interleaved thinking + tool calling
- ✅ Apache 2.0 open source license
- ✅ Trained on Huawei Ascend chips (domestic Chinese hardware)

---

## 4. MiniMax

### API Endpoint
```
POST https://api.minimax.io/anthropic/v1/messages  (Anthropic-compatible)
POST https://api.minimax.io/v1/chat/completions     (OpenAI-compatible)
```

### Models
- `MiniMax-M2` - 230B MoE (10B active), interleaved thinking
- `MiniMax-M2.1` - Enhanced multilingual coding
- `MiniMax-M2.7` - Latest agentic model with best tool use

### Request Format (OpenAI-compatible)
```json
{
  "model": "MiniMax-M2.7",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [...],
  "reasoning": true,
  "reasoning_split": true  // Returns reasoning in separate field
}
```

### Response Format
```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "<think>Analyzing weather data...</think>The weather is sunny...",
      "reasoning_details": [{
        "type": "thinking",
        "thinking": "Analyzing weather data..."
      }],
      "tool_calls": [...]
    }
  }]
}
```

### Interleaved Thinking Example
MiniMax M2 uses `<think>` tags for reasoning:

```
[Think] → [Tool Call] → [Think about result] → [Tool Call] → [Final Answer]
   ↑                                    ↑
   └────── Reasoning preserved ─────────┘
```

**Critical:** Must preserve complete reasoning chain in multi-turn conversations:
```typescript
// Append full response including thinking to messages
messages.append({
  role: "assistant",
  content: response.content  // Contains <think>...</think> tags
});
```

### Characteristics
- ✅ Native interleaved thinking support
- ✅ Uses `<think>...</think>` format for reasoning
- ✅ 230B MoE (10B active) - highly efficient
- ✅ OpenAI & Anthropic API compatible
- ✅ SOTA on Multi-SWE-Bench (49.4%)
- ✅ Supports `reasoning_details` for clean separation

---

## 5. Qwen (Alibaba)

### API Endpoint
```
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
```

### Models
- `qwen3-235b-a22b` - Dense model with tool calling
- `qwen3-coder` - Coding-optimized with function calling
- `qwen3-8b` - Lightweight, supports function calling

### Request Format
```json
{
  "model": "qwen3-coder",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": {"type": "string"}
          },
          "required": ["location"]
        }
      }
    }
  ],
  "tool_choice": "auto"
}
```

### Characteristics
- ✅ OpenAI-compatible API via DashScope
- ✅ Native function calling support
- ✅ Available via Alibaba Cloud Model Studio
- ✅ Qwen3-8B can run on consumer GPUs with vLLM
- ✅ Supports both OpenAI SDK and DashScope SDK

---

## 6. Anthropic Claude

### API Endpoint
```
POST https://api.anthropic.com/v1/messages
```

### Request Format
```json
{
  "model": "claude-3-5-sonnet-20241022",
  "max_tokens": 1024,
  "system": "You are a helpful assistant.",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [
    {
      "name": "get_weather",
      "description": "Get weather for a location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": {"type": "string"}
        },
        "required": ["location"]
      }
    }
  ],
  "tool_choice": {"type": "auto"}
}
```

### Response Format
```json
{
  "content": [
    {
      "type": "tool_use",
      "id": "toolu_01A",
      "name": "get_weather",
      "input": {"location": "San Francisco"}
    }
  ]
}
```

### Tool Response
```json
{
  "role": "user",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "toolu_01A",
      "content": "Sunny, 72°F"
    }
  ]
}
```

### Characteristics
- ✅ Independent Messages API (not Chat Completions)
- ✅ Uses `input_schema` instead of `parameters`
- ✅ Tool use as content block
- ✅ Supports built-in tools like computer use, text editor
- ✅ Supports tool use examples

---

## 7. Google Gemini

### API Endpoint
```
POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
```

### SDK Approach
```python
from google import genai
from google.genai import types

client = genai.Client()

tools = types.Tool(function_declarations=[{
    "name": "get_weather",
    "description": "Get weather for a location",
    "parameters": {
        "type": "object",
        "properties": {
            "location": {"type": "string"}
        },
        "required": ["location"]
    }
}])

response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="What's the weather in San Francisco?",
    config=types.GenerateContentConfig(tools=[tools])
)
```

### REST Approach
```json
{
  "contents": [{"parts": [{"text": "What's the weather?"}]}],
  "tools": [{
    "functionDeclarations": [{
      "name": "get_weather",
      "description": "...",
      "parameters": {...}
    }]
  }]
}
```

### Response Format
```json
{
  "candidates": [{
    "content": {
      "parts": [{
        "functionCall": {
          "name": "get_weather",
          "args": {"location": "San Francisco"}
        }
      }]
    }
  }]
}
```

### Tool Response
```json
{
  "contents": [{
    "parts": [{
      "functionResponse": {
        "name": "get_weather",
        "response": {"temperature": 72, "condition": "sunny"}
      }
    }]
  }]
}
```

### Characteristics
- ✅ Unique `contents` / `parts` structure
- ✅ Named `functionDeclarations`
- ✅ Supports parallel function calling
- ✅ Supports automatic function calling (Python SDK)
- ✅ Supports thinking mode (enabled by default)

---

## 8. Ollama

### API Endpoint
```
POST http://localhost:11434/api/chat
```

### Request Format
```json
{
  "model": "qwen3",
  "messages": [{"role": "user", "content": "What's the weather?"}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_weather",
        "description": "...",
        "parameters": {...}
      }
    }
  ],
  "stream": false
}
```

### Text Format (some models)
Some models use custom format:
```xml
<function=get_weather>
<parameter=location>San Francisco</parameter>
</function>
```

### Characteristics
- ✅ OpenAI-compatible API
- ⚠️ Tool calling support depends on underlying model
- ⚠️ Different models may use different text formats
- ✅ Can customize format via template

---

## 9. vLLM

### Startup Parameters
```bash
python -m vllm.entrypoints.openai.api_server \
  --model Qwen/Qwen3-8B \
  --enable-auto-tool-choice \
  --tool-call-parser openai
```

### Supported Parsers
- `openai` - OpenAI format
- `hermes` - Hermes format
- `mistral` - Mistral format
- `internlm` - InternLM format

### Request Format
Fully compatible with OpenAI:
```json
{
  "model": "qwen3",
  "messages": [...],
  "tools": [...],
  "tool_choice": "auto"
}
```

### Characteristics
- ✅ OpenAI-compatible API
- ✅ Configurable tool call parser
- ✅ Supports named function calling
- ⚠️ `tool_choice: auto/required` support depends on version

---

## Key Differences Summary

### 1. Schema Definition Differences

| Provider | Tool Field | Parameter Field | Required Parameters |
|----------|-----------|-----------------|---------------------|
| OpenAI | `function.name` | `function.parameters` | `parameters.required` |
| DeepSeek | `function.name` | `function.parameters` | `parameters.required` |
| Claude | `name` | `input_schema` | `input_schema.required` |
| Gemini | `functionDeclarations[].name` | `functionDeclarations[].parameters` | `parameters.required` |

### 2. Response Structure Differences

```typescript
// OpenAI / DeepSeek / vLLM / Ollama
interface OpenAIResponse {
  choices: [{
    message: {
      tool_calls: [{
        id: string;
        function: {
          name: string;
          arguments: string; // JSON string
        }
      }]
    }
  }]
}

// Claude
interface ClaudeResponse {
  content: [{
    type: "tool_use";
    id: string;
    name: string;
    input: object; // Direct object, not string
  }]
}

// Gemini
interface GeminiResponse {
  candidates: [{
    content: {
      parts: [{
        functionCall: {
          name: string;
          args: object; // Direct object
        }
      }]
    }
  }]
}
```

### 3. Tool Response Differences

```typescript
// OpenAI / DeepSeek
{ role: "tool", tool_call_id: "...", content: "..." }

// Claude
{ role: "user", content: [{ type: "tool_result", tool_use_id: "...", content: "..." }] }

// Gemini
{ contents: [{ parts: [{ functionResponse: { name: "...", response: {} } }] }] }
```

---

## Design Recommendations

### 1. Internal Unified Format

```typescript
// Diogenes uses this format internally
interface ToolCall {
  id: string;
  tool: string;        // "namespace.name"
  arguments: object;   // Parsed object, not string
}

interface ToolResponse {
  toolCallId: string;
  result?: unknown;
  error?: { code: string; message: string };
}
```

### 2. Adapter Design

Each provider implements the Adapter interface:

```typescript
interface ProviderAdapter {
  // Convert internal tool definitions to provider format
  formatTools(tools: ToolSchema[]): unknown;
  
  // Parse provider response to internal format
  parseResponse(response: unknown): ToolCall[];
  
  // Convert internal tool response to provider format
  formatToolResponse(responses: ToolResponse[]): unknown;
  
  // Check if native function calling is supported
  supportsNativeFunctionCalling(): boolean;
}
```

### 3. Strategy Selection

| Scenario | Recommended Strategy |
|----------|---------------------|
| OpenAI API | Native function calling |
| DeepSeek API | Native function calling (OpenAI-compatible) |
| Claude API | Native function calling |
| Gemini API | Native function calling |
| Ollama/vLLM | Choose based on model: native or text parsing |
| Pure text models | Diogenes JSON / DeepSeek XML |

### 4. DeepSeek Special Considerations

```typescript
// DeepSeek thinking mode requires special handling
interface DeepSeekToolCallManager {
  // Check if model is in thinking mode
  isThinkingMode(model: string): boolean;
  
  // Format assistant message with reasoning_content
  formatAssistantMessage(response: {
    content: string;
    reasoning_content?: string;
    tool_calls?: ToolCall[];
  }): Message;
  
  // Handle the constraint: no tool calls during thinking
  validateToolCallState(mode: "thinking" | "normal", hasToolCalls: boolean): boolean;
}

// Usage example
const deepSeekAdapter = {
  formatAssistantMessage(response) {
    const message: any = {
      role: "assistant",
      content: response.content
    };
    
    // MUST include reasoning_content if present
    if (response.reasoning_content) {
      message.reasoning_content = response.reasoning_content;
    }
    
    // Tool calls only allowed in non-thinking responses
    if (response.tool_calls) {
      message.tool_calls = response.tool_calls;
    }
    
    return message;
  }
};
```

### 5. Model Configuration with Interleaved Thinking Support

```typescript
interface ModelConfig {
  name: string;
  provider: "openai" | "anthropic" | "deepseek" | "gemini" | "ollama";
  
  // Tool calling capabilities
  supportsNativeFunctionCalling: boolean;
  supportsParallelToolCalls: boolean;
  maxParallelToolCalls: number;
  
  // Thinking/Reasoning capabilities
  supportsThinking: boolean;
  supportsInterleavedThinking: boolean;  // Can think between tool calls
  
  // Constraints
  requiresReasoningContentInContext: boolean;  // DeepSeek requires this
  toolCallsDuringThinking: boolean;  // Can call tools while thinking
  
  // Streaming support
  supportsStreamingToolCalls: boolean;
}

// Model configuration registry
const MODEL_CONFIGS: Record<string, ModelConfig> = {
  "deepseek-reasoner": {
    name: "deepseek-reasoner",
    provider: "deepseek",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 128,
    supportsThinking: true,
    supportsInterleavedThinking: false,  // ❌ R1 cannot think between tool calls
    requiresReasoningContentInContext: true,
    toolCallsDuringThinking: false,
    supportsStreamingToolCalls: true
  },
  "deepseek-v4-pro": {
    name: "deepseek-v4-pro",
    provider: "deepseek",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 128,
    supportsThinking: true,
    supportsInterleavedThinking: true,  // ✅ V4 supports interleaved thinking
    requiresReasoningContentInContext: true,
    toolCallsDuringThinking: true,
    supportsStreamingToolCalls: true
  },
  "glm-5": {
    name: "glm-5",
    provider: "glm",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 32,
    supportsThinking: true,
    supportsInterleavedThinking: true,  // ✅ GLM-5 supports interleaved thinking
    requiresReasoningContentInContext: true,
    toolCallsDuringThinking: true,
    supportsStreamingToolCalls: true
  },
  "minimax-m2.7": {
    name: "MiniMax-M2.7",
    provider: "minimax",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 64,
    supportsThinking: true,
    supportsInterleavedThinking: true,  // ✅ MiniMax M2 has native interleaved thinking
    requiresReasoningContentInContext: true,
    toolCallsDuringThinking: true,
    supportsStreamingToolCalls: true
  },
  "qwen3-coder": {
    name: "qwen3-coder",
    provider: "qwen",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 32,
    supportsThinking: false,  // Qwen3 doesn't have explicit thinking mode
    supportsInterleavedThinking: true,  // ✅ Supports reasoning + tool use
    requiresReasoningContentInContext: false,
    toolCallsDuringThinking: true,
    supportsStreamingToolCalls: true
  },
  "claude-sonnet-4-6-20250514": {
    name: "claude-sonnet-4-6-20250514",
    provider: "anthropic",
    supportsNativeFunctionCalling: true,
    supportsParallelToolCalls: true,
    maxParallelToolCalls: 32,
    supportsThinking: true,
    supportsInterleavedThinking: true,  // ✅ Claude 4 with beta header
    requiresReasoningContentInContext: false,
    toolCallsDuringThinking: true,
    supportsStreamingToolCalls: true
  }
};

// Helper to check if model supports interleaved thinking
function supportsInterleavedThinking(modelName: string): boolean {
  const config = MODEL_CONFIGS[modelName];
  return config?.supportsInterleavedThinking ?? false;
}
```

### 6. Priority Design

```typescript
function selectStrategy(provider: string, model: string): Strategy {
  // 1. Check if provider supports native
  if (supportsNativeFunctionCalling(provider)) {
    return new NativeFunctionStrategy();
  }
  
  // 2. Recommend format based on model
  if (model.includes("deepseek")) {
    return new DeepSeekXmlStrategy();
  }
  
  // 3. Default to Diogenes JSON
  return new DiogenesJsonStrategy();
}
```

---

## Reference Links

1. [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)
2. [DeepSeek Tool Calls](https://api-docs.deepseek.com/guides/tool_calls)
3. [DeepSeek Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion/)
4. [DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)
5. [DeepSeek API Change Log](https://api-docs.deepseek.com/updates/)
6. [GLM-5 Documentation](https://docs.z.ai/guides/llm/glm-5)
7. [MiniMax Tool Use & Interleaved Thinking](https://platform.minimax.io/docs/guides/text-m2-function-call)
8. [MiniMax M2 GitHub](https://github.com/MiniMax-AI/MiniMax-M2)
9. [Qwen API Reference](https://www.alibabacloud.com/help/en/model-studio/qwen-api-reference)
10. [Claude Tool Use](https://docs.anthropic.com/en/docs/build-with-claude/tool-use/overview)
11. [Claude Extended Thinking](https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking)
12. [Gemini Function Calling](https://ai.google.dev/gemini-api/docs/function-calling)
13. [Ollama Tool Calling](https://docs.ollama.com/capabilities/tool-calling)
14. [vLLM Tool Calling](https://docs.vllm.ai/en/stable/features/tool_calling/)

---

*Document updated: 2026-04-24*
