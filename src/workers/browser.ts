/**
 * Browser worker for OpenClaw Secure.
 *
 * Executes Class D (browser/network) tool calls.
 * Enforces a strict domain allowlist: any URL whose hostname is not on the
 * allowlist is rejected before the request is made (fails closed).
 *
 * Uses the Node.js 20+ built-in fetch API. No third-party HTTP client.
 *
 * Tool params shape expected by this worker:
 *   {
 *     url:     string               (required)
 *     label?:  string               (optional artifact label)
 *     method?: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'  (default: 'GET')
 *     headers?: Record<string,string>
 *     body?:   string
 *   }
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { WorkerExecutor } from '../core/broker';
import { ToolSchema, ExecutionLease, RuntimeReceipt, RuntimeTarget } from '../core/types';

// ---------------------------------------------------------------------------
// Typed worker error — carries an auditEventType so the broker can emit the
// correct audit event instead of the generic 'tool.error'.
// ---------------------------------------------------------------------------

export class BrowserWorkerError extends Error {
  constructor(
    message: string,
    /** The audit event type to emit for this denial. */
    public readonly auditEventType: string
  ) {
    super(message);
    this.name = 'BrowserWorkerError';
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BrowserWorkerConfig {
  /**
   * Domains this worker may contact.
   * Each entry is matched as an exact hostname or *.suffix wildcard.
   * Example: ['api.example.com', '*.trusted.org']
   */
  allowedDomains: string[];
  /** Maximum wall-clock time per request in ms. Default: 15_000. */
  timeoutMs: number;
  /** Maximum response body size in bytes. Default: 512 KiB. */
  maxBodyBytes: number;
}

const DEFAULT_CONFIG: BrowserWorkerConfig = {
  allowedDomains: [],
  timeoutMs: 15_000,
  maxBodyBytes: 512 * 1024,
};

// ---------------------------------------------------------------------------
// Sensitive header names to scrub from audit networkSummary
// ---------------------------------------------------------------------------

const SCRUBBED_HEADER_NAMES = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
]);

/**
 * Returns a copy of headers safe to include in audit records.
 * Values for sensitive headers are replaced with '<redacted>'.
 */
export function scrubHeadersForAudit(
  headers: Record<string, string>
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key] = SCRUBBED_HEADER_NAMES.has(key.toLowerCase()) ? '<redacted>' : value;
  }
  return result;
}

/** Returns true if `hostname` is permitted by the allowlist entry. */
function matchesDomainEntry(hostname: string, entry: string): boolean {
  if (entry.startsWith('*.')) {
    const suffix = entry.slice(2); // strip '*.'
    return hostname === suffix || hostname.endsWith('.' + suffix);
  }
  return hostname === entry;
}

/** Returns true if `hostname` is on the allowlist. */
export function isDomainAllowed(hostname: string, allowedDomains: string[]): boolean {
  return allowedDomains.some((entry) => matchesDomainEntry(hostname, entry));
}

// ---------------------------------------------------------------------------
// BrowserWorker
// ---------------------------------------------------------------------------

export class BrowserWorker implements WorkerExecutor {
  readonly runtimeTarget: RuntimeTarget = 'browser_worker';
  private config: BrowserWorkerConfig;

  constructor(config: Partial<BrowserWorkerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async execute(
    tool: ToolSchema,
    params: Record<string, unknown>,
    lease: ExecutionLease
  ): Promise<RuntimeReceipt> {
    const startedAt = new Date().toISOString();

    // --- Parse and validate params ---
    const rawUrl = params['url'];
    if (typeof rawUrl !== 'string' || !rawUrl) {
      throw new Error('BrowserWorker: params.url must be a non-empty string');
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new Error(`BrowserWorker: invalid URL: ${rawUrl}`);
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BrowserWorkerError(
        `BrowserWorker: unsupported protocol "${parsed.protocol}". Only http/https allowed.`,
        'browser.protocol.denied'
      );
    }

    // --- Domain allowlist enforcement (fails closed) ---
    if (!isDomainAllowed(parsed.hostname, this.config.allowedDomains)) {
      throw new BrowserWorkerError(
        `BrowserWorker: domain "${parsed.hostname}" is not on the allowlist for tool "${tool.name}". ` +
        `Allowed: [${this.config.allowedDomains.join(', ') || 'none'}]`,
        'browser.allowlist.denied'
      );
    }

    // --- Build request ---
    const method = typeof params['method'] === 'string'
      ? params['method'].toUpperCase()
      : 'GET';

    const rawHeaders = params['headers'];
    const headers: Record<string, string> =
      rawHeaders && typeof rawHeaders === 'object' && !Array.isArray(rawHeaders)
        ? (rawHeaders as Record<string, string>)
        : {};

    const body = typeof params['body'] === 'string' ? params['body'] : undefined;

    const label = typeof params['label'] === 'string' ? params['label'] : undefined;

    // --- Execute with timeout ---
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let responseStatus = 0;
    let responseBody = '';
    let networkSummary = '';

    try {
      let response: Response;
      try {
        response = await fetch(rawUrl, {
          method,
          headers,
          body: body ?? undefined,
          signal: controller.signal,
          // Never follow redirects — a redirect to a different domain would
          // bypass the domain allowlist. Fail closed instead.
          redirect: 'error',
          // Do not leak the request origin to the destination server.
          referrerPolicy: 'no-referrer',
        });
      } catch (fetchErr) {
        // Detect redirect errors from fetch and convert to typed denial.
        if (fetchErr instanceof TypeError && /redirect/i.test((fetchErr as Error).message)) {
          throw new BrowserWorkerError(
            `BrowserWorker: redirect denied for "${rawUrl}" — cross-domain redirects are not allowed: ${(fetchErr as Error).message}`,
            'browser.redirect.denied'
          );
        }
        throw fetchErr;
      }

      responseStatus = response.status;

      // Cap response body
      const text = await response.text();
      responseBody = text.slice(0, this.config.maxBodyBytes);
      const scrubbedHeaders = scrubHeadersForAudit(headers);
      networkSummary = `${method} ${rawUrl} → ${responseStatus} (${responseBody.length} bytes) headers=${JSON.stringify(scrubbedHeaders)}`;
    } finally {
      clearTimeout(timer);
    }

    const finishedAt = new Date().toISOString();

    // --- Produce a structured_data artifact for the fetched content ---
    const checksum = createHash('sha256').update(responseBody).digest('hex');
    const artifactRef = {
      id: uuidv4(),
      uri: `browser-doc://${lease.toolInvocationId}`,
      checksum,
      type: 'structured_data' as const,
      ...(label ? { label } : {}),
    };

    return {
      invocationId: lease.toolInvocationId,
      runtimeTarget: 'browser_worker',
      sandboxId: lease.id,
      exitCode: responseStatus >= 200 && responseStatus < 300 ? 0 : 1,
      stdout: JSON.stringify({ status: responseStatus, body: responseBody }),
      stderr: '',
      fileDiffs: [],
      networkSummary,
      artifacts: [artifactRef],
      startedAt,
      finishedAt,
    };
  }
}
