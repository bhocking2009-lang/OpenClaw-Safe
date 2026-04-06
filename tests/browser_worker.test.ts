import { AuditLog } from "../src/core/audit_log";
import { BrowserWorker, BrowserWorkerError, BrowserFetchOptions } from "../src/workers/browser";

type FetchImpl = Parameters<BrowserWorker["fetch"]>[2];

function makeFetchImpl(overrides: {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  throw?: Error;
  delay?: number;
}): FetchImpl {
  return async (url: string) => {
    if (overrides.throw) throw overrides.throw;
    if (overrides.delay) {
      await new Promise((resolve) => setTimeout(resolve, overrides.delay));
    }
    const headers = overrides.headers ?? {};
    return {
      status: overrides.status ?? 200,
      headers: { get: (h: string) => headers[h] ?? headers[h.toLowerCase()] ?? null },
      text: async () => overrides.body ?? "response body",
    };
  };
}

const successFetch = makeFetchImpl({
  status: 200,
  headers: { "content-type": "text/html" },
  body: "Hello world",
});

describe("BrowserWorker", () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog();
  });

  afterEach(() => log.close());

  describe("success case", () => {
    it("returns a BrowserFetchResult on success", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] }, log);
      const result = await worker.fetch("https://example.com/page", "actor-1", successFetch);
      expect(result.url).toBe("https://example.com/page");
      expect(result.statusCode).toBe(200);
      expect(result.body).toBe("Hello world");
      expect(result.contentType).toContain("text/html");
      expect(result.tokensUsed).toBe("Hello world".length);
    });

    it("tokensUsed equals body.length", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] });
      const body = "a".repeat(500);
      const result = await worker.fetch(
        "https://example.com",
        "actor",
        makeFetchImpl({ status: 200, headers: { "content-type": "text/plain" }, body })
      );
      expect(result.tokensUsed).toBe(500);
    });
  });

  describe("protocol check", () => {
    it("denies non-https protocol (http)", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"], allowedProtocols: ["https:"] });
      await expect(worker.fetch("http://example.com", "actor", successFetch)).rejects.toThrow(BrowserWorkerError);
    });

    it("denies ftp protocol", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"], allowedProtocols: ["https:"] });
      try {
        await worker.fetch("ftp://example.com", "actor", successFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.protocol.denied");
      }
    });

    it("allows custom protocols when configured", async () => {
      const worker = new BrowserWorker({
        allowlist: ["example.com"],
        allowedProtocols: ["https:", "http:"],
      });
      const result = await worker.fetch(
        "http://example.com",
        "actor",
        makeFetchImpl({ status: 200, headers: { "content-type": "text/html" }, body: "ok" })
      );
      expect(result.statusCode).toBe(200);
    });
  });

  describe("private IP check (before allowlist)", () => {
    it("denies localhost", async () => {
      const worker = new BrowserWorker({ allowlist: ["localhost"] });
      try {
        await worker.fetch("https://localhost/api", "actor", successFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.url.denied");
      }
    });

    it("denies 127.0.0.1", async () => {
      const worker = new BrowserWorker({ allowlist: ["127.0.0.1"] });
      try {
        await worker.fetch("https://127.0.0.1/", "actor", successFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.url.denied");
      }
    });

    it("denies 192.168.x.x", async () => {
      const worker = new BrowserWorker({ allowlist: ["*"] });
      try {
        await worker.fetch("https://192.168.1.1/", "actor", successFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.url.denied");
      }
    });

    it("denies 10.x.x.x", async () => {
      const worker = new BrowserWorker({ allowlist: ["*"] });
      await expect(worker.fetch("https://10.0.0.1/", "actor", successFetch)).rejects.toMatchObject({
        auditEventType: "browser.url.denied",
      });
    });

    it("fires before allowlist – private IP blocks even with wildcard allowlist", async () => {
      const worker = new BrowserWorker({ allowlist: ["*"] });
      await expect(worker.fetch("https://192.168.0.1/", "actor", successFetch)).rejects.toMatchObject({
        auditEventType: "browser.url.denied",
      });
    });
  });

  describe("allowlist check", () => {
    it("denies hosts not in allowlist", async () => {
      const worker = new BrowserWorker({ allowlist: ["allowed.com"] });
      try {
        await worker.fetch("https://other.com/page", "actor", successFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.allowlist.denied");
      }
    });

    it("allows matching exact hostname", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] });
      const result = await worker.fetch("https://example.com/", "actor", successFetch);
      expect(result.statusCode).toBe(200);
    });

    it("allows wildcard subdomain *.example.com", async () => {
      const worker = new BrowserWorker({ allowlist: ["*.example.com"] });
      const result = await worker.fetch(
        "https://sub.example.com/",
        "actor",
        makeFetchImpl({ status: 200, headers: { "content-type": "text/html" }, body: "ok" })
      );
      expect(result.statusCode).toBe(200);
    });

    it("allows when no allowlist configured", async () => {
      const worker = new BrowserWorker({});
      const result = await worker.fetch("https://example.com/", "actor", successFetch);
      expect(result.statusCode).toBe(200);
    });
  });

  describe("redirect check", () => {
    it("denies 301 redirects", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] });
      const redirectFetch = makeFetchImpl({
        status: 301,
        headers: { "content-type": "text/html", location: "https://other.com" },
        body: "",
      });
      try {
        await worker.fetch("https://example.com/", "actor", redirectFetch);
        fail("should throw");
      } catch (e) {
        expect((e as BrowserWorkerError).auditEventType).toBe("browser.redirect.denied");
      }
    });

    it("denies 302 redirects", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] });
      await expect(
        worker.fetch("https://example.com/", "actor", makeFetchImpl({ status: 302, body: "" }))
      ).rejects.toMatchObject({ auditEventType: "browser.redirect.denied" });
    });
  });

  describe("body size check", () => {
    it("denies body exceeding maxBodyBytes", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"], maxBodyBytes: 10 });
      const bigBody = "x".repeat(100);
      await expect(
        worker.fetch("https://example.com/", "actor",
          makeFetchImpl({ status: 200, headers: { "content-type": "text/html" }, body: bigBody }))
      ).rejects.toMatchObject({ auditEventType: "browser.body.too_large" });
    });

    it("allows body exactly at maxBodyBytes", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"], maxBodyBytes: 10 });
      const body = "x".repeat(10);
      const result = await worker.fetch(
        "https://example.com/",
        "actor",
        makeFetchImpl({ status: 200, headers: { "content-type": "text/html" }, body })
      );
      expect(result.body).toBe(body);
    });
  });

  describe("network error", () => {
    it("wraps network errors as browser.network.error", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"] });
      await expect(
        worker.fetch("https://example.com/", "actor", makeFetchImpl({ throw: new Error("ECONNREFUSED") }))
      ).rejects.toMatchObject({ auditEventType: "browser.network.error" });
    });
  });

  describe("content type check", () => {
    it("denies disallowed content types", async () => {
      const worker = new BrowserWorker({
        allowlist: ["example.com"],
        allowedContentTypes: ["text/html"],
      });
      await expect(
        worker.fetch("https://example.com/", "actor",
          makeFetchImpl({ status: 200, headers: { "content-type": "application/octet-stream" }, body: "data" }))
      ).rejects.toMatchObject({ auditEventType: "browser.content_type.denied" });
    });

    it("allows matching content types", async () => {
      const worker = new BrowserWorker({
        allowlist: ["example.com"],
        allowedContentTypes: ["text/html", "text/plain"],
      });
      const result = await worker.fetch(
        "https://example.com/",
        "actor",
        makeFetchImpl({ status: 200, headers: { "content-type": "text/plain" }, body: "ok" })
      );
      expect(result.body).toBe("ok");
    });
  });

  describe("timeout", () => {
    it("throws browser.timeout when fetch takes too long", async () => {
      const worker = new BrowserWorker({ allowlist: ["example.com"], timeoutMs: 20 });
      const slowFetch = makeFetchImpl({ delay: 100, status: 200, headers: { "content-type": "text/html" }, body: "late" });
      await expect(
        worker.fetch("https://example.com/", "actor", slowFetch)
      ).rejects.toMatchObject({ auditEventType: "browser.timeout" });
    }, 5000);
  });

  describe("audit logging", () => {
    it("records denial events to audit log", async () => {
      const worker = new BrowserWorker({ allowlist: ["allowed.com"] }, log);
      try {
        await worker.fetch("https://denied.com/", "actor", successFetch);
      } catch {}
      expect(log.count()).toBeGreaterThan(0);
    });
  });

  describe("BrowserWorkerError", () => {
    it("has correct name", () => {
      const err = new BrowserWorkerError("msg", "browser.url.denied", "https://x.com");
      expect(err.name).toBe("BrowserWorkerError");
    });

    it("exposes auditEventType and url", () => {
      const err = new BrowserWorkerError("blocked", "browser.allowlist.denied", "https://x.com");
      expect(err.auditEventType).toBe("browser.allowlist.denied");
      expect(err.url).toBe("https://x.com");
    });
  });
});
