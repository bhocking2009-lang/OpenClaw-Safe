import { AuditLog, AuditEventKind } from "../src/core/audit_log";
import { PolicyEngine } from "../src/core/policy";
import { PluginManager } from "../src/core/plugin_manager";
import { ToolBroker } from "../src/core/broker";
import { SandboxWorker } from "../src/core/sandbox_worker";
import { HostElevationPath } from "../src/core/host_elevation";
import { Gateway, BROWSER_DOC_FETCH_SCHEMA, GatewayDependencies } from "../src/core/gateway";
import { BrowserWorker } from "../src/workers/browser";
import { createCapabilityManifest, addCapability, RiskLevel } from "../src/core/capability_manifest";
import { createPrincipal, PrincipalRole } from "../src/models/principal";
import { createAgentProfile } from "../src/models/agent_profile";

type FetchImpl = Parameters<BrowserWorker["fetch"]>[2];

function makeFetch(body = "page content", status = 200, contentType = "text/html"): FetchImpl {
  return async () => ({
    status,
    headers: { get: (h: string) => (h === "content-type" ? contentType : null) },
    text: async () => body,
  });
}

function buildGatewayWithBrowser(browserOptions = {}) {
  const auditLog = new AuditLog();
  const policy = new PolicyEngine(undefined, auditLog);
  const sandbox = new SandboxWorker(auditLog);
  const elev = new HostElevationPath(auditLog);
  const broker = new ToolBroker(sandbox, elev, auditLog);
  const manager = new PluginManager(policy, auditLog);
  const browserWorker = new BrowserWorker(
    { allowlist: ["example.com"], ...browserOptions },
    auditLog
  );
  const gateway = new Gateway(policy, manager, broker, auditLog, { browserWorker });
  return { gateway, auditLog, browserWorker };
}

describe("BROWSER_DOC_FETCH_SCHEMA", () => {
  it("has correct name", () => {
    expect(BROWSER_DOC_FETCH_SCHEMA.name).toBe("browser_doc_fetch");
  });

  it("has toolClass = browser", () => {
    expect(BROWSER_DOC_FETCH_SCHEMA.toolClass).toBe("browser");
  });

  it("has riskLevel = high", () => {
    expect(BROWSER_DOC_FETCH_SCHEMA.riskLevel).toBe("high");
  });

  it("has required url and actorId fields", () => {
    expect(BROWSER_DOC_FETCH_SCHEMA.inputSchema.required).toContain("url");
    expect(BROWSER_DOC_FETCH_SCHEMA.inputSchema.required).toContain("actorId");
  });

  it("has a description", () => {
    expect(typeof BROWSER_DOC_FETCH_SCHEMA.description).toBe("string");
    expect(BROWSER_DOC_FETCH_SCHEMA.description.length).toBeGreaterThan(0);
  });
});

describe("GatewayDependencies interface", () => {
  it("can be constructed with only required fields", () => {
    const auditLog = new AuditLog();
    const policy = new PolicyEngine(undefined, auditLog);
    const sandbox = new SandboxWorker(auditLog);
    const elev = new HostElevationPath(auditLog);
    const broker = new ToolBroker(sandbox, elev, auditLog);
    const manager = new PluginManager(policy, auditLog);
    const deps: GatewayDependencies = {
      policyEngine: policy,
      pluginManager: manager,
      toolBroker: broker,
      auditLog,
    };
    expect(deps.browserWorker).toBeUndefined();
    expect(deps.sessionStore).toBeUndefined();
    auditLog.close();
  });
});

describe("Gateway.browserDocFetch", () => {
  const principal = createPrincipal("Alice", PrincipalRole.OPERATOR);
  const agent = createAgentProfile("helper", "gpt-4");

  it("fetches a URL and returns an Artifact", async () => {
    const { gateway, auditLog } = buildGatewayWithBrowser();
    const session = gateway.openSession(principal, agent);
    const artifact = await gateway.browserDocFetch(session, "https://example.com/", makeFetch("Hello page"));
    expect(artifact.content).toBe("Hello page");
    expect(artifact.tokensUsed).toBe("Hello page".length);
    auditLog.close();
  });

  it("sets tokensUsed on artifact", async () => {
    const { gateway, auditLog } = buildGatewayWithBrowser();
    const session = gateway.openSession(principal, agent);
    const body = "x".repeat(100);
    const artifact = await gateway.browserDocFetch(session, "https://example.com/", makeFetch(body));
    expect(artifact.tokensUsed).toBe(100);
    auditLog.close();
  });

  it("throws if BrowserWorker not configured", async () => {
    const auditLog = new AuditLog();
    const policy = new PolicyEngine(undefined, auditLog);
    const sandbox = new SandboxWorker(auditLog);
    const elev = new HostElevationPath(auditLog);
    const broker = new ToolBroker(sandbox, elev, auditLog);
    const manager = new PluginManager(policy, auditLog);
    const gateway = new Gateway(policy, manager, broker, auditLog); // no browserWorker
    const session = gateway.openSession(principal, agent);
    await expect(gateway.browserDocFetch(session, "https://example.com/")).rejects.toThrow(
      "BrowserWorker not configured"
    );
    auditLog.close();
  });

  it("propagates BrowserWorkerError for denied hosts", async () => {
    const { gateway, auditLog } = buildGatewayWithBrowser();
    const session = gateway.openSession(principal, agent);
    await expect(
      gateway.browserDocFetch(session, "https://denied.com/", makeFetch())
    ).rejects.toThrow();
    auditLog.close();
  });

  it("artifact has a non-empty id", async () => {
    const { gateway, auditLog } = buildGatewayWithBrowser();
    const session = gateway.openSession(principal, agent);
    const artifact = await gateway.browserDocFetch(session, "https://example.com/", makeFetch("data"));
    expect(artifact.id).toBeTruthy();
    auditLog.close();
  });

  it("sets contentType from response", async () => {
    const { gateway, auditLog } = buildGatewayWithBrowser();
    const session = gateway.openSession(principal, agent);
    const artifact = await gateway.browserDocFetch(session, "https://example.com/", makeFetch("data", 200, "text/plain"));
    expect(artifact.mimeType).toContain("text/plain");
    auditLog.close();
  });

  it("existing Gateway 4-param constructor still works", () => {
    const auditLog = new AuditLog();
    const policy = new PolicyEngine(undefined, auditLog);
    const sandbox = new SandboxWorker(auditLog);
    const elev = new HostElevationPath(auditLog);
    const broker = new ToolBroker(sandbox, elev, auditLog);
    const manager = new PluginManager(policy, auditLog);
    const gateway = new Gateway(policy, manager, broker, auditLog);
    const session = gateway.openSession(principal, agent);
    expect(session.active).toBe(true);
    auditLog.close();
  });
});
