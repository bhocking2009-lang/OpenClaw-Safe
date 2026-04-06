import { validateExportBundle, ExportBundle } from "../src/core/replay";
import { ExportManifest } from "../src/core/types";

function makeBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    manifest: {
      provenanceId: "prov-1",
      sessionCount: 2,
      taskCount: 3,
      toolInvocationCount: 5,
      browserDenialCount: 1,
      artifactCount: 4,
    },
    events: [
      { kind: "session_created", actorId: "a1", details: {} },
      { kind: "session_created", actorId: "a2", details: {} },
      { kind: "task_created", actorId: "a1", details: {} },
      { kind: "task_created", actorId: "a1", details: {} },
      { kind: "task_created", actorId: "a2", details: {} },
      { kind: "tool_invoked", actorId: "a1", details: {} },
      { kind: "tool_invoked", actorId: "a1", details: {} },
      { kind: "tool_invoked", actorId: "a2", details: {} },
      { kind: "tool_invoked", actorId: "a2", details: {} },
      { kind: "tool_invoked", actorId: "a2", details: {} },
      { kind: "browser.allowlist.denied", actorId: "a1", details: {} },
    ],
    ...overrides,
  };
}

describe("validateExportBundle", () => {
  it("validates a correct bundle", () => {
    const result = validateExportBundle(makeBundle());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects empty provenanceId", () => {
    const bundle = makeBundle();
    bundle.manifest.provenanceId = "";
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("provenanceId"))).toBe(true);
  });

  it("rejects whitespace-only provenanceId", () => {
    const bundle = makeBundle();
    bundle.manifest.provenanceId = "   ";
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
  });

  it("rejects negative sessionCount", () => {
    const bundle = makeBundle();
    bundle.manifest.sessionCount = -1;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sessionCount"))).toBe(true);
  });

  it("rejects negative taskCount", () => {
    const bundle = makeBundle();
    bundle.manifest.taskCount = -1;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
  });

  it("rejects negative toolInvocationCount", () => {
    const bundle = makeBundle();
    bundle.manifest.toolInvocationCount = -1;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
  });

  it("rejects negative browserDenialCount", () => {
    const bundle = makeBundle();
    bundle.manifest.browserDenialCount = -1;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
  });

  it("rejects negative artifactCount", () => {
    const bundle = makeBundle();
    bundle.manifest.artifactCount = -1;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
  });

  it("detects sessionCount mismatch", () => {
    const bundle = makeBundle();
    bundle.manifest.sessionCount = 99;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("sessionCount mismatch"))).toBe(true);
  });

  it("detects taskCount mismatch", () => {
    const bundle = makeBundle();
    bundle.manifest.taskCount = 99;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("taskCount mismatch"))).toBe(true);
  });

  it("detects toolInvocationCount mismatch", () => {
    const bundle = makeBundle();
    bundle.manifest.toolInvocationCount = 0;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("toolInvocationCount mismatch"))).toBe(true);
  });

  it("detects browserDenialCount mismatch", () => {
    const bundle = makeBundle();
    bundle.manifest.browserDenialCount = 10;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("browserDenialCount mismatch"))).toBe(true);
  });

  it("counts browser denial events correctly", () => {
    const bundle = makeBundle();
    bundle.events.push({ kind: "browser.protocol.denied", actorId: "a", details: {} });
    bundle.manifest.browserDenialCount = 2;
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(true);
  });

  it("validates an empty bundle with zero counts", () => {
    const bundle: ExportBundle = {
      manifest: {
        provenanceId: "prov-x",
        sessionCount: 0,
        taskCount: 0,
        toolInvocationCount: 0,
        browserDenialCount: 0,
        artifactCount: 0,
      },
      events: [],
    };
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(true);
  });

  it("detects provenanceId inconsistency in events", () => {
    const bundle = makeBundle();
    bundle.events[0].details["provenanceId"] = "different-prov";
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("provenanceId mismatch"))).toBe(true);
  });

  it("passes when event provenanceId matches manifest", () => {
    const bundle = makeBundle();
    bundle.events[0].details["provenanceId"] = "prov-1";
    const result = validateExportBundle(bundle);
    expect(result.valid).toBe(true);
  });

  it("ValidationResult has valid and errors fields", () => {
    const result = validateExportBundle(makeBundle());
    expect(typeof result.valid).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
