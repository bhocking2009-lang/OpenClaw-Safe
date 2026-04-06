import { AuditLog } from "../core/audit_log";

export type BrowserAuditEventType =
  | "browser.allowlist.denied"
  | "browser.protocol.denied"
  | "browser.redirect.denied"
  | "browser.timeout"
  | "browser.body.too_large"
  | "browser.network.error"
  | "browser.content_type.denied"
  | "browser.url.denied";

export class BrowserWorkerError extends Error {
  constructor(
    message: string,
    public readonly auditEventType: BrowserAuditEventType,
    public readonly url: string
  ) {
    super(message);
    this.name = "BrowserWorkerError";
  }
}

export interface BrowserFetchOptions {
  allowlist?: string[];
  maxBodyBytes?: number;
  timeoutMs?: number;
  allowedContentTypes?: string[];
  allowedProtocols?: string[];
}

export interface BrowserFetchResult {
  url: string;
  statusCode: number;
  contentType: string;
  body: string;
  tokensUsed: number;
}

type FetchImpl = (
  url: string
) => Promise<{ status: number; headers: { get(h: string): string | null }; text(): Promise<string> }>;

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_PROTOCOLS = ["https:"];

const PRIVATE_IP_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fe[89ab][0-9a-f]:/i,
  /^localhost$/i,
];

function isPrivateOrReserved(hostname: string): boolean {
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) return true;
  }
  // Check if it's an IP literal (IPv4)
  const ipv4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (ipv4) return true; // All IP literals are rejected for safety
  // Check IPv6 literal
  if (hostname.startsWith("[") && hostname.endsWith("]")) return true;
  return false;
}

function matchesAllowlistPattern(hostname: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return hostname === suffix || hostname.endsWith("." + suffix);
  }
  return hostname === pattern;
}

function isAllowlisted(hostname: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => matchesAllowlistPattern(hostname, pattern));
}

export class BrowserWorker {
  constructor(
    private readonly options: BrowserFetchOptions = {},
    private readonly auditLog?: AuditLog
  ) {}

  async fetch(url: string, actorId: string, fetchImpl?: FetchImpl): Promise<BrowserFetchResult> {
    const allowedProtocols = this.options.allowedProtocols ?? DEFAULT_PROTOCOLS;
    const maxBodyBytes = this.options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // 1. Protocol check
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      this.deny("browser.url.denied", url, actorId, `Invalid URL: ${url}`);
    }

    if (!allowedProtocols.includes(parsedUrl!.protocol)) {
      this.deny(
        "browser.protocol.denied",
        url,
        actorId,
        `Protocol '${parsedUrl!.protocol}' is not allowed.`
      );
    }

    // 2. Private IP / IP literal check (BEFORE allowlist)
    const hostname = parsedUrl!.hostname;
    if (isPrivateOrReserved(hostname)) {
      this.deny("browser.url.denied", url, actorId, `Host '${hostname}' resolves to a private/reserved address.`);
    }

    // 3. Allowlist check
    if (this.options.allowlist && this.options.allowlist.length > 0) {
      if (!isAllowlisted(hostname, this.options.allowlist)) {
        this.deny(
          "browser.allowlist.denied",
          url,
          actorId,
          `Host '${hostname}' is not in the allowlist.`
        );
      }
    }

    // 4. Execute fetch with timeout
    const impl = fetchImpl ?? this.defaultFetch;
    let response: { status: number; headers: { get(h: string): string | null }; text(): Promise<string> };

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("__browser_timeout__")), timeoutMs)
    );

    try {
      response = await Promise.race([impl(url), timeoutPromise]);
    } catch (err) {
      const msg = String(err);
      if (msg.includes("__browser_timeout__")) {
        this.deny("browser.timeout", url, actorId, `Request timed out after ${timeoutMs}ms.`);
      }
      this.deny("browser.network.error", url, actorId, `Network error: ${msg}`);
    }

    // 5. Redirect check
    if (response!.status >= 300 && response!.status < 400) {
      this.deny("browser.redirect.denied", url, actorId, `Redirect detected (status ${response!.status}).`);
    }

    // 6. (Timeout already handled above)

    // 7. Body size check
    let body: string;
    try {
      body = await response!.text();
    } catch (err) {
      this.deny("browser.network.error", url, actorId, `Failed to read response body: ${String(err)}`);
    }

    if (Buffer.byteLength(body!, "utf8") > maxBodyBytes) {
      this.deny(
        "browser.body.too_large",
        url,
        actorId,
        `Response body exceeds ${maxBodyBytes} bytes.`
      );
    }

    // 8. Content type check
    const contentType = response!.headers.get("content-type") ?? "";
    if (this.options.allowedContentTypes && this.options.allowedContentTypes.length > 0) {
      const baseType = contentType.split(";")[0].trim();
      if (!this.options.allowedContentTypes.some((ct) => baseType === ct || contentType.startsWith(ct))) {
        this.deny(
          "browser.content_type.denied",
          url,
          actorId,
          `Content type '${contentType}' is not allowed.`
        );
      }
    }

    return {
      url,
      statusCode: response!.status,
      contentType,
      body: body!,
      tokensUsed: body!.length,
    };
  }

  private deny(
    type: BrowserAuditEventType,
    url: string,
    actorId: string,
    message: string
  ): never {
    if (this.auditLog) {
      this.auditLog.record(
        // Use the string kind directly since it's not in the enum (dynamic)
        type as unknown as import("../core/audit_log").AuditEventKind,
        actorId,
        { url, reason: message, browserDenial: true }
      );
    }
    throw new BrowserWorkerError(message, type, url);
  }

  private defaultFetch: FetchImpl = async (url: string) => {
    const res = await fetch(url);
    return {
      status: res.status,
      headers: { get: (h: string) => res.headers.get(h) },
      text: () => res.text(),
    };
  };
}
