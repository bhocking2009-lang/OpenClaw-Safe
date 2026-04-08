/**
 * OllamaProvider — concrete ModelProvider for a local Ollama server.
 *
 * Design constraints:
 *   - Strict JSON response contract: throws ModelProviderError on any deviation.
 *   - No silent fallback to stub behaviour.
 *   - No direct tool execution: tool calls are returned as structured data and
 *     dispatched by AgentRuntime through the policy-mediated ToolBroker.
 *   - Uses Node 18+ native fetch; zero additional dependencies.
 *   - probe() is a lightweight reachability check used at startup; it never
 *     throws — failures are expressed as a false return value so the caller
 *     can decide whether to abort startup or warn.
 */

import { ModelProvider, ModelMessage, ModelResponse, ModelToolCall } from '../core/agent';
import { ToolSchema } from '../core/types';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown by OllamaProvider.invoke() on any failure:
 *   - connection refused / network error
 *   - non-200 HTTP response
 *   - malformed / incomplete JSON body
 *
 * The caller (AgentRuntime) catches this and emits a model.error audit event
 * before re-throwing so the error surfaces to the operator.
 */
export class ModelProviderError extends Error {
  name = 'ModelProviderError';

  readonly providerName: string;
  readonly modelName: string;
  readonly originalCause: unknown;

  constructor(
    message: string,
    providerName: string,
    modelName: string,
    cause?: unknown,
  ) {
    super(message);
    this.providerName = providerName;
    this.modelName = modelName;
    this.originalCause = cause;
    // Restore prototype chain (required when extending built-ins in ES5/ES2015+)
    Object.setPrototypeOf(this, ModelProviderError.prototype);
  }
}

// ---------------------------------------------------------------------------
// Ollama wire types (narrow subset we actually use)
// ---------------------------------------------------------------------------

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

interface OllamaChatResponse {
  model: string;
  message: OllamaMessage;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

interface OllamaToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Provider options
// ---------------------------------------------------------------------------

export interface OllamaProviderOptions {
  /**
   * Ollama REST API base URL.
   * Default: http://localhost:11434
   */
  baseUrl?: string;

  /**
   * Model to use for every inference call — e.g. "llama3.2", "qwen2.5-coder:7b".
   * Required; no auto-detection or silent fallback.
   */
  model: string;

  /**
   * Request timeout in milliseconds.
   * Applied to both probe() (5 s) and invoke() (this value, default 120 s).
   */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// OllamaProvider
// ---------------------------------------------------------------------------

export class OllamaProvider implements ModelProvider {
  readonly name = 'ollama';
  /** The Ollama model tag used for every request. */
  readonly model: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaProviderOptions) {
    if (!options.model || !options.model.trim()) {
      throw new Error('OllamaProvider: model name is required and must not be empty');
    }
    this.model = options.model.trim();
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /**
   * Lightweight reachability check.
   * Calls GET /api/tags (the Ollama model-list endpoint) with a 5-second
   * deadline.  Returns true if the server responds with an OK status.
   * Never throws — failure is expressed as false.
   */
  async probe(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: controller.signal,
      });
      clearTimeout(timer);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Invoke the Ollama chat completion endpoint.
   *
   * @param messages  Conversation history including the system prompt.
   * @param tools     Policy-filtered tool schemas visible to the model.
   * @param options   Optional inference parameters.
   * @returns         Parsed ModelResponse — content + optional tool calls + usage.
   * @throws          ModelProviderError on any failure.
   */
  async invoke(
    messages: ModelMessage[],
    tools: ToolSchema[],
    options?: { maxTokens?: number },
  ): Promise<ModelResponse> {
    const ollamaMessages: OllamaMessage[] = messages.map((m) => ({
      role: m.role as OllamaMessage['role'],
      content: m.content,
    }));

    const ollamaTools: OllamaToolDef[] = tools.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: (t.inputSchema ?? { type: 'object', properties: {} }) as Record<
          string,
          unknown
        >,
      },
    }));

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: ollamaMessages,
      stream: false,
    };

    if (ollamaTools.length > 0) {
      requestBody['tools'] = ollamaTools;
    }
    if (options?.maxTokens !== undefined) {
      // Ollama uses num_predict to cap output token count
      requestBody['options'] = { num_predict: options.maxTokens };
    }

    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (cause) {
      throw new ModelProviderError(
        `Ollama connection failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        this.name,
        this.model,
        cause,
      );
    }

    if (!res.ok) {
      let detail = res.statusText;
      try {
        const errBody = (await res.json()) as Record<string, unknown>;
        if (typeof errBody['error'] === 'string') {
          detail = errBody['error'];
        }
      } catch {
        /* ignore JSON parse errors on error body */
      }
      throw new ModelProviderError(
        `Ollama returned HTTP ${res.status}: ${detail}`,
        this.name,
        this.model,
      );
    }

    let body: OllamaChatResponse;
    try {
      body = (await res.json()) as OllamaChatResponse;
    } catch (cause) {
      throw new ModelProviderError(
        'Ollama response body is not valid JSON',
        this.name,
        this.model,
        cause,
      );
    }

    // Ollama can return a 200 with an error field for model-level failures
    if (body.error) {
      throw new ModelProviderError(
        `Ollama model error: ${body.error}`,
        this.name,
        this.model,
      );
    }

    if (!body.message) {
      throw new ModelProviderError(
        'Ollama response is missing required "message" field',
        this.name,
        this.model,
      );
    }

    // Parse structured tool calls returned by the model
    const toolCalls: ModelToolCall[] | undefined =
      body.message.tool_calls && body.message.tool_calls.length > 0
        ? body.message.tool_calls.map((tc, i) => ({
            id: `tc-${i}-${Date.now()}`,
            name: tc.function.name,
            params: tc.function.arguments ?? {},
          }))
        : undefined;

    return {
      content: body.message.content ?? '',
      toolCalls,
      usage:
        body.prompt_eval_count !== undefined && body.eval_count !== undefined
          ? {
              promptTokens: body.prompt_eval_count,
              completionTokens: body.eval_count,
            }
          : undefined,
    };
  }
}
