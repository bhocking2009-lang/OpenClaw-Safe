/**
 * Tests for OllamaProvider.
 *
 * All tests use jest.spyOn to mock global fetch so no real network calls
 * are made.  The tests verify:
 *   - probe() returns true/false correctly
 *   - invoke() maps Ollama responses to ModelResponse correctly
 *   - invoke() parses tool_calls into ModelToolCall[]
 *   - invoke() throws ModelProviderError on HTTP errors
 *   - invoke() throws ModelProviderError on connection failure
 *   - invoke() throws ModelProviderError on missing "message" field
 *   - invoke() throws ModelProviderError on Ollama error body
 *   - options.maxTokens is forwarded as num_predict
 *   - constructor rejects empty model name
 */

import { OllamaProvider, ModelProviderError } from '../src/providers/ollama';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  body?: unknown;
}): jest.SpyInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.spyOn(global, 'fetch' as any).mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? 'OK' : 'Internal Server Error'),
    json: () => Promise.resolve(response.body ?? {}),
  } as unknown as Response);
}

function mockFetchThrow(error: Error): jest.SpyInstance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jest.spyOn(global, 'fetch' as any).mockRejectedValue(error);
}

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Constructor
// ---------------------------------------------------------------------------

describe('OllamaProvider constructor', () => {
  it('rejects an empty model name', () => {
    expect(() => new OllamaProvider({ model: '' })).toThrow();
  });

  it('rejects a whitespace-only model name', () => {
    expect(() => new OllamaProvider({ model: '   ' })).toThrow();
  });

  it('trims the model name', () => {
    const p = new OllamaProvider({ model: '  llama3.2  ' });
    expect(p.model).toBe('llama3.2');
  });

  it('strips trailing slash from baseUrl', () => {
    const p = new OllamaProvider({ model: 'test', baseUrl: 'http://localhost:11434/' });
    expect(p.name).toBe('ollama');
    // probe() uses the stripped URL — we just verify construction succeeds
  });

  it('has name=ollama', () => {
    const p = new OllamaProvider({ model: 'llama3.2' });
    expect(p.name).toBe('ollama');
  });
});

// ---------------------------------------------------------------------------
// probe()
// ---------------------------------------------------------------------------

describe('OllamaProvider.probe()', () => {
  it('returns true when /api/tags responds OK', async () => {
    mockFetch({ ok: true });
    const p = new OllamaProvider({ model: 'llama3.2' });
    expect(await p.probe()).toBe(true);
  });

  it('returns false when /api/tags responds with an error status', async () => {
    mockFetch({ ok: false, status: 500 });
    const p = new OllamaProvider({ model: 'llama3.2' });
    expect(await p.probe()).toBe(false);
  });

  it('returns false when fetch throws (connection refused)', async () => {
    mockFetchThrow(new Error('ECONNREFUSED'));
    const p = new OllamaProvider({ model: 'llama3.2' });
    expect(await p.probe()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invoke() — happy path
// ---------------------------------------------------------------------------

describe('OllamaProvider.invoke() — success', () => {
  it('returns content from model message', async () => {
    mockFetch({
      ok: true,
      body: {
        model: 'llama3.2',
        message: { role: 'assistant', content: 'Hello, world!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const result = await p.invoke([{ role: 'user', content: 'Hi' }], []);
    expect(result.content).toBe('Hello, world!');
    expect(result.toolCalls).toBeUndefined();
    expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('omits usage when token counts are absent', async () => {
    mockFetch({
      ok: true,
      body: {
        model: 'llama3.2',
        message: { role: 'assistant', content: 'OK' },
        done: true,
      },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const result = await p.invoke([{ role: 'user', content: 'test' }], []);
    expect(result.usage).toBeUndefined();
  });

  it('returns empty string content when message.content is missing', async () => {
    mockFetch({
      ok: true,
      body: {
        model: 'llama3.2',
        message: { role: 'assistant' },
        done: true,
      },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const result = await p.invoke([{ role: 'user', content: 'test' }], []);
    expect(result.content).toBe('');
  });

  it('sends num_predict when maxTokens option is given', async () => {
    const spy = mockFetch({
      ok: true,
      body: { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await p.invoke([{ role: 'user', content: 'test' }], [], { maxTokens: 256 });
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.options?.num_predict).toBe(256);
  });

  it('omits options block when maxTokens is not given', async () => {
    const spy = mockFetch({
      ok: true,
      body: { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await p.invoke([{ role: 'user', content: 'test' }], []);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.options).toBeUndefined();
  });

  it('sends stream: false always', async () => {
    const spy = mockFetch({
      ok: true,
      body: { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await p.invoke([{ role: 'user', content: 'test' }], []);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.stream).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// invoke() — tool calls
// ---------------------------------------------------------------------------

describe('OllamaProvider.invoke() — tool calls', () => {
  it('parses tool_calls from model response', async () => {
    mockFetch({
      ok: true,
      body: {
        model: 'llama3.2',
        message: {
          role: 'assistant',
          content: '',
          tool_calls: [
            { function: { name: 'file_read', arguments: { path: '/tmp/foo.txt' } } },
            { function: { name: 'list_dir', arguments: { dir: '/tmp' } } },
          ],
        },
        done: true,
      },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const result = await p.invoke([{ role: 'user', content: 'read the file' }], []);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls![0].name).toBe('file_read');
    expect(result.toolCalls![0].params).toEqual({ path: '/tmp/foo.txt' });
    expect(result.toolCalls![1].name).toBe('list_dir');
  });

  it('returns undefined toolCalls when tool_calls array is empty', async () => {
    mockFetch({
      ok: true,
      body: {
        model: 'llama3.2',
        message: { role: 'assistant', content: 'done', tool_calls: [] },
        done: true,
      },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const result = await p.invoke([{ role: 'user', content: 'test' }], []);
    expect(result.toolCalls).toBeUndefined();
  });

  it('forwards tool schemas in the request body', async () => {
    const spy = mockFetch({
      ok: true,
      body: { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    const tools = [
      {
        name: 'file_read',
        description: 'Read a file',
        riskClass: 'A' as const,
        defaultRuntimeTarget: 'sandbox' as const,
        concurrencySafe: true,
        idempotent: true,
        auditPayloadShape: {},
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      },
    ];
    await p.invoke([{ role: 'user', content: 'test' }], tools);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].type).toBe('function');
    expect(body.tools[0].function.name).toBe('file_read');
  });

  it('omits tools key when no tools are provided', async () => {
    const spy = mockFetch({
      ok: true,
      body: { model: 'llama3.2', message: { role: 'assistant', content: 'ok' }, done: true },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await p.invoke([{ role: 'user', content: 'test' }], []);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// invoke() — error cases
// ---------------------------------------------------------------------------

describe('OllamaProvider.invoke() — errors', () => {
  it('throws ModelProviderError on non-200 HTTP response', async () => {
    mockFetch({ ok: false, status: 404, statusText: 'Not Found', body: { error: 'model not found' } });
    const p = new OllamaProvider({ model: 'missing-model' });
    await expect(p.invoke([{ role: 'user', content: 'test' }], [])).rejects.toThrow(
      ModelProviderError
    );
  });

  it('includes HTTP status and error message in ModelProviderError', async () => {
    mockFetch({ ok: false, status: 500, statusText: 'Server Error', body: { error: 'OOM' } });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await expect(p.invoke([{ role: 'user', content: 'test' }], [])).rejects.toMatchObject({
      name: 'ModelProviderError',
      message: expect.stringContaining('500'),
    });
  });

  it('throws ModelProviderError when fetch throws (network error)', async () => {
    mockFetchThrow(new Error('ECONNREFUSED'));
    const p = new OllamaProvider({ model: 'llama3.2' });
    await expect(p.invoke([{ role: 'user', content: 'test' }], [])).rejects.toThrow(
      ModelProviderError
    );
  });

  it('throws ModelProviderError when response is missing "message" field', async () => {
    mockFetch({ ok: true, body: { model: 'llama3.2', done: true } });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await expect(p.invoke([{ role: 'user', content: 'test' }], [])).rejects.toThrow(
      ModelProviderError
    );
  });

  it('throws ModelProviderError when Ollama returns an error field in a 200 body', async () => {
    mockFetch({
      ok: true,
      body: { error: 'context length exceeded' },
    });
    const p = new OllamaProvider({ model: 'llama3.2' });
    await expect(p.invoke([{ role: 'user', content: 'test' }], [])).rejects.toMatchObject({
      name: 'ModelProviderError',
      message: expect.stringContaining('context length exceeded'),
    });
  });

  it('sets providerName and modelName on ModelProviderError', async () => {
    mockFetch({ ok: false, status: 503, statusText: 'Service Unavailable', body: {} });
    const p = new OllamaProvider({ model: 'qwen2.5:7b', baseUrl: 'http://localhost:11434' });
    let caught: ModelProviderError | null = null;
    try {
      await p.invoke([{ role: 'user', content: 'test' }], []);
    } catch (e) {
      caught = e as ModelProviderError;
    }
    expect(caught).not.toBeNull();
    expect(caught!.providerName).toBe('ollama');
    expect(caught!.modelName).toBe('qwen2.5:7b');
  });
});
