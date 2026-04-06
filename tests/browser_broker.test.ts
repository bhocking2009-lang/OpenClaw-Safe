import { BrowserBroker } from "../src/brokers/browser_broker";
import { BrowserWorkerError } from "../src/workers/browser";
import { AuditLog } from "../src/core/audit_log";

type FetchImpl = Parameters<InstanceType<typeof import("../src/workers/browser").BrowserWorker>["fetch"]>[2];

function makeFetch(body = "ok", status = 200, contentType = "text/html"): FetchImpl {
  return async () => ({
    status,
    headers: { get: (h: string) => (h === "content-type" ? contentType : null) },
    text: async () => body,
  });
}

describe("BrowserBroker", () => {
  let log: AuditLog;
  let broker: BrowserBroker;

  beforeEach(() => {
    log = new AuditLog();
    broker = new BrowserBroker({ allowlist: ["example.com"] }, log);
  });

  afterEach(() => log.close());

  it("has toolClass = browser", () => {
    expect(broker.toolClass).toBe("browser");
  });

  it("has riskLevel = high", () => {
    expect(broker.riskLevel).toBe("high");
  });

  it("executes a fetch and returns BrowserFetchResult", async () => {
    const result = await broker.execute(
      { url: "https://example.com/page" },
      "actor",
      makeFetch("Hello", 200, "text/html")
    );
    expect(result.body).toBe("Hello");
    expect(result.statusCode).toBe(200);
    expect(result.tokensUsed).toBe(5);
  });

  it("throws when url not provided", async () => {
    await expect(broker.execute({}, "actor")).rejects.toThrow("url");
  });

  it("propagates BrowserWorkerError from worker", async () => {
    await expect(
      broker.execute({ url: "https://denied.com/page" }, "actor", makeFetch())
    ).rejects.toThrow(BrowserWorkerError);
  });

  it("denies http:// when only https: allowed (default)", async () => {
    const b = new BrowserBroker({ allowlist: ["example.com"] });
    await expect(
      b.execute({ url: "http://example.com/" }, "actor", makeFetch())
    ).rejects.toMatchObject({ auditEventType: "browser.protocol.denied" });
  });

  it("works without auditLog", async () => {
    const b = new BrowserBroker({ allowlist: ["example.com"] });
    const result = await b.execute(
      { url: "https://example.com/" },
      "actor",
      makeFetch("data")
    );
    expect(result.body).toBe("data");
  });

  it("returns tokensUsed = body.length", async () => {
    const body = "x".repeat(200);
    const result = await broker.execute(
      { url: "https://example.com/" },
      "actor",
      makeFetch(body)
    );
    expect(result.tokensUsed).toBe(200);
  });

  it("passes url from args", async () => {
    const result = await broker.execute(
      { url: "https://example.com/path?q=1" },
      "actor",
      makeFetch("resp")
    );
    expect(result.url).toBe("https://example.com/path?q=1");
  });
});
