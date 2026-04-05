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
 *     method?: 'GET'|'POST'|'PUT'|'DELETE'|'PATCH'  (default: 'GET')
 *     headers?: Record<string,string>
 *     body?:   string
 *   }
 */

import { WorkerExecutor } from '../core/broker';
import { ToolSchema, ExecutionLease, RuntimeReceipt, RuntimeTarget } from '../core/types';

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
// Domain allowlist helpers
// ---------------------------------------------------------------------------

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
      throw new Error(`BrowserWorker: unsupported protocol "${parsed.protocol}". Only http/https allowed.`);
    }

    // --- Domain allowlist enforcement (fails closed) ---
    if (!isDomainAllowed(parsed.hostname, this.config.allowedDomains)) {
      throw new Error(
        `BrowserWorker: domain "${parsed.hostname}" is not on the allowlist for tool "${tool.name}". ` +
        `Allowed: [${this.config.allowedDomains.join(', ') || 'none'}]`
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

    // --- Execute with timeout ---
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let responseStatus = 0;
    let responseBody = '';
    let networkSummary = '';

    try {
      const response = await fetch(rawUrl, {
        method,
        headers,
        body: body ?? undefined,
        signal: controller.signal,
      });

      responseStatus = response.status;

      // Cap response body
      const text = await response.text();
      responseBody = text.slice(0, this.config.maxBodyBytes);
      networkSummary = `${method} ${rawUrl} → ${responseStatus} (${responseBody.length} bytes)`;
    } finally {
      clearTimeout(timer);
    }

    const finishedAt = new Date().toISOString();
    return {
      invocationId: lease.toolInvocationId,
      runtimeTarget: 'browser_worker',
      sandboxId: lease.id,
      exitCode: responseStatus >= 200 && responseStatus < 300 ? 0 : 1,
      stdout: JSON.stringify({ status: responseStatus, body: responseBody }),
      stderr: '',
      fileDiffs: [],
      networkSummary,
      artifacts: [],
      startedAt,
      finishedAt,
    };
  }
}
