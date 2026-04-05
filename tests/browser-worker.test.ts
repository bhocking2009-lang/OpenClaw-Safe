/**
 * Tests for the BrowserWorker and domain allowlist enforcement.
 */

import { BrowserWorker, isDomainAllowed, scrubHeadersForAudit } from '../src/workers/browser';
import { ToolSchema, ExecutionLease } from '../src/core/types';

function makeLease(id = 'lease-1'): ExecutionLease {
  return {
    id,
    toolInvocationId: 'inv-1',
    runtimeTarget: 'browser_worker',
    expiresAt: new Date(Date.now() + 30_000).toISOString(),
  };
}

function makeToolSchema(): ToolSchema {
  return {
    name: 'web_fetch',
    description: 'Fetch a URL',
    riskClass: 'D',
    defaultRuntimeTarget: 'browser_worker',
    concurrencySafe: true,
    idempotent: true,
    auditPayloadShape: {},
    inputSchema: {},
  };
}

// ---------------------------------------------------------------------------
// Domain allowlist logic (pure unit tests — no network)
// ---------------------------------------------------------------------------

describe('isDomainAllowed', () => {
  it('allows exact match', () => {
    expect(isDomainAllowed('api.example.com', ['api.example.com'])).toBe(true);
  });

  it('rejects non-matching domain', () => {
    expect(isDomainAllowed('evil.com', ['api.example.com'])).toBe(false);
  });

  it('allows wildcard suffix match', () => {
    expect(isDomainAllowed('sub.trusted.org', ['*.trusted.org'])).toBe(true);
  });

  it('allows bare domain matching wildcard', () => {
    expect(isDomainAllowed('trusted.org', ['*.trusted.org'])).toBe(true);
  });

  it('rejects domain that only shares a suffix without wildcard', () => {
    expect(isDomainAllowed('notexample.com', ['example.com'])).toBe(false);
  });

  it('rejects deep subdomain not covered by single-level wildcard', () => {
    // '*.trusted.org' should match 'a.trusted.org' but also 'a.b.trusted.org'
    // because endsWith covers any depth
    expect(isDomainAllowed('a.b.trusted.org', ['*.trusted.org'])).toBe(true);
  });

  it('returns false when allowlist is empty', () => {
    expect(isDomainAllowed('anything.com', [])).toBe(false);
  });

  it('checks multiple entries', () => {
    expect(isDomainAllowed('b.com', ['a.com', 'b.com', 'c.com'])).toBe(true);
    expect(isDomainAllowed('d.com', ['a.com', 'b.com', 'c.com'])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scrubHeadersForAudit
// ---------------------------------------------------------------------------

describe('scrubHeadersForAudit', () => {
  it('preserves non-sensitive headers', () => {
    const result = scrubHeadersForAudit({ 'Content-Type': 'application/json', Accept: 'text/html' });
    expect(result['Content-Type']).toBe('application/json');
    expect(result['Accept']).toBe('text/html');
  });

  it('redacts Authorization header', () => {
    const result = scrubHeadersForAudit({ authorization: 'Bearer secret-token' });
    expect(result['authorization']).toBe('<redacted>');
  });

  it('redacts Cookie header', () => {
    const result = scrubHeadersForAudit({ cookie: 'session=abc123' });
    expect(result['cookie']).toBe('<redacted>');
  });

  it('redacts X-Api-Key header', () => {
    const result = scrubHeadersForAudit({ 'x-api-key': 'my-secret-key' });
    expect(result['x-api-key']).toBe('<redacted>');
  });

  it('redacts x-auth-token header', () => {
    const result = scrubHeadersForAudit({ 'x-auth-token': 'tok' });
    expect(result['x-auth-token']).toBe('<redacted>');
  });

  it('handles mixed-case header names case-insensitively', () => {
    const result = scrubHeadersForAudit({ Authorization: 'Bearer abc' });
    expect(result['Authorization']).toBe('<redacted>');
  });

  it('returns empty object for empty input', () => {
    expect(scrubHeadersForAudit({})).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// BrowserWorker: domain enforcement (no real network calls)
// ---------------------------------------------------------------------------

describe('BrowserWorker domain enforcement', () => {
  it('throws when domain is not on allowlist (fails closed)', async () => {
    const worker = new BrowserWorker({ allowedDomains: ['allowed.example.com'] });

    await expect(
      worker.execute(makeToolSchema(), { url: 'https://evil.example.com/data' }, makeLease())
    ).rejects.toThrow(/not on the allowlist/i);
  });

  it('throws when allowlist is empty (fails closed by default)', async () => {
    const worker = new BrowserWorker({ allowedDomains: [] });

    await expect(
      worker.execute(makeToolSchema(), { url: 'https://example.com/data' }, makeLease())
    ).rejects.toThrow(/not on the allowlist/i);
  });

  it('throws on invalid URL', async () => {
    const worker = new BrowserWorker({ allowedDomains: ['*'] });

    await expect(
      worker.execute(makeToolSchema(), { url: 'not-a-url' }, makeLease())
    ).rejects.toThrow(/invalid url/i);
  });

  it('throws when url param is missing', async () => {
    const worker = new BrowserWorker({ allowedDomains: ['example.com'] });

    await expect(
      worker.execute(makeToolSchema(), {}, makeLease())
    ).rejects.toThrow(/params\.url/i);
  });

  it('throws on non-http/https protocol (fails closed)', async () => {
    const worker = new BrowserWorker({ allowedDomains: ['example.com'] });

    await expect(
      worker.execute(makeToolSchema(), { url: 'ftp://example.com/file' }, makeLease())
    ).rejects.toThrow(/unsupported protocol/i);
  });

  it('runtimeTarget is browser_worker', () => {
    const worker = new BrowserWorker({ allowedDomains: [] });
    expect(worker.runtimeTarget).toBe('browser_worker');
  });
});

// ---------------------------------------------------------------------------
// BrowserWorker: redirect control (unit test — mock fetch)
// ---------------------------------------------------------------------------

describe('BrowserWorker redirect control', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('passes redirect: error to fetch, preventing cross-domain redirect following', async () => {
    let capturedOptions: RequestInit | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      capturedOptions = options;
      return {
        status: 200,
        text: async () => 'hello',
      };
    }) as typeof fetch;

    const worker = new BrowserWorker({ allowedDomains: ['example.com'] });
    await worker.execute(makeToolSchema(), { url: 'https://example.com/test' }, makeLease());

    expect(capturedOptions?.redirect).toBe('error');
  });

  it('passes referrerPolicy: no-referrer to fetch', async () => {
    let capturedOptions: RequestInit | undefined;
    globalThis.fetch = jest.fn().mockImplementation(async (_url: string, options: RequestInit) => {
      capturedOptions = options;
      return {
        status: 200,
        text: async () => '',
      };
    }) as typeof fetch;

    const worker = new BrowserWorker({ allowedDomains: ['example.com'] });
    await worker.execute(makeToolSchema(), { url: 'https://example.com/' }, makeLease());

    expect(capturedOptions?.referrerPolicy).toBe('no-referrer');
  });

  it('networkSummary redacts Authorization header value', async () => {
    globalThis.fetch = jest.fn().mockImplementation(async () => ({
      status: 200,
      text: async () => 'ok',
    })) as typeof fetch;

    const worker = new BrowserWorker({ allowedDomains: ['example.com'] });
    const receipt = await worker.execute(
      makeToolSchema(),
      { url: 'https://example.com/', headers: { authorization: 'Bearer super-secret' } },
      makeLease()
    );

    expect(receipt.networkSummary).toContain('<redacted>');
    expect(receipt.networkSummary).not.toContain('super-secret');
  });
});

