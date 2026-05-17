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
  /** Maximum URL length in characters. Default: 2048. */
  maxUrlLength: number;
}

const DEFAULT_CONFIG: BrowserWorkerConfig = {
  allowedDomains: [],
  timeoutMs: 15_000,
  maxBodyBytes: 512 * 1024,
  maxUrlLength: 2048,
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

/**
 * Returns true if `hostname` is a private/loopback/link-local range that
 * must not be contacted unless explicitly on the allowlist.
 *
 * Covers:
 *   - loopback: 127.0.0.0/8, ::1
 *   - link-local: 169.254.0.0/16, fe80::/10
 *   - private: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
 *   - unspecified / broadcast: 0.0.0.0, 255.255.255.255
 *   - literal "localhost"
 */
export function isPrivateOrInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();

  // Named localhost
  if (h === 'localhost') return true;

  // IPv6 loopback / link-local / private (ULA)
  if (h === '::1') return true;
  if (h.startsWith('fe80:')) return true;   // fe80::/10 link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7 ULA

  // IPv4 dotted-decimal ranges
  const parts = h.split('.');
  if (parts.length !== 4) return false;
  const [a, b, c] = parts.map(Number);
  if ([a, b, c].some(isNaN)) return false;

  if (a === 127) return true;               // 127.0.0.0/8 loopback
  if (a === 10) return true;                // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true;  // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true;  // 169.254.0.0/16 link-local
  if (a === 0 || (a === 255 && b === 255)) return true; // 0.0.0.0, broadcast

  return false;
}

/**
 * Returns true if `hostname` looks like a bare IP address (IPv4 or IPv6).
 * IPv6 addresses are typically wrapped in brackets in URLs; after URL parsing
 * the brackets are stripped.
 */
export function isIpLiteral(hostname: string): boolean {
  // IPv4: four decimal octets
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6: contains colons
  if (hostname.includes(':')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------

/**
 * Returns true if the content-type is acceptable for a documentation fetch.
 * Accepts text/* and application/json only.
 */
export function isAcceptableContentType(contentType: string | null): boolean {
  if (!contentType) return true; // absent content-type: allow (server may omit for plain responses)
  const lower = contentType.toLowerCase().split(';')[0].trim();
  return lower.startsWith('text/') || lower === 'application/json';
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

    // Enforce max URL length before parsing
    if (rawUrl.length > this.config.maxUrlLength) {
      throw new BrowserWorkerError(
        `BrowserWorker: URL exceeds maximum length of ${this.config.maxUrlLength} characters (got ${rawUrl.length}).`,
        'browser.url.denied'
      );
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

    // Reject private/internal IP ranges and localhost — prevents SSRF.
    // This check applies even before allowlist: an IP literal that happens
    // to be on the allowlist is still rejected here.
    if (isPrivateOrInternalHost(parsed.hostname)) {
      throw new BrowserWorkerError(
        `BrowserWorker: URL targets a private/internal host "${parsed.hostname}" which is not allowed.`,
        'browser.url.denied'
      );
    }

    // Reject bare IP literals — documentation URLs must use named domains.
    if (isIpLiteral(parsed.hostname)) {
      throw new BrowserWorkerError(
        `BrowserWorker: URL uses an IP literal "${parsed.hostname}". Only named domain hostnames are allowed.`,
        'browser.url.denied'
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
        // Timeout: the AbortController fires when the timer expires.
        if (
          fetchErr instanceof Error &&
          (fetchErr.name === 'AbortError' || /abort/i.test(fetchErr.message))
        ) {
          throw new BrowserWorkerError(
            `BrowserWorker: request to "${rawUrl}" timed out after ${this.config.timeoutMs}ms.`,
            'browser.timeout'
          );
        }
        // Redirect denial from fetch's redirect:error mode.
        if (fetchErr instanceof TypeError && /redirect/i.test((fetchErr as Error).message)) {
          throw new BrowserWorkerError(
            `BrowserWorker: redirect denied for "${rawUrl}" — cross-domain redirects are not allowed: ${(fetchErr as Error).message}`,
            'browser.redirect.denied'
          );
        }
        // Other network errors (DNS failure, connection refused, etc.)
        throw new BrowserWorkerError(
          `BrowserWorker: network error fetching "${rawUrl}": ${(fetchErr as Error).message}`,
          'browser.network.error'
        );
      }

      responseStatus = response.status;

      // Content-type check: only accept text/* and application/json.
      const contentType = response.headers.get('content-type');
      if (!isAcceptableContentType(contentType)) {
        throw new BrowserWorkerError(
          `BrowserWorker: response content-type "${contentType}" is not acceptable. Only text/* and application/json are allowed.`,
          'browser.content_type.denied'
        );
      }

      // Read body and enforce size limit (explicit denial, not silent truncation).
      const text = await response.text();
      if (text.length > this.config.maxBodyBytes) {
        throw new BrowserWorkerError(
          `BrowserWorker: response body (${text.length} bytes) exceeds the maximum of ${this.config.maxBodyBytes} bytes.`,
          'browser.body.too_large'
        );
      }
      responseBody = text;
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
      // tokensUsed is always defined for browser workflow — byte count of fetched body.
      tokensUsed: responseBody.length,
    };
  }
}

