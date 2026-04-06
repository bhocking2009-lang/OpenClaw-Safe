import { ExportManifest } from "./types";

export interface ExportBundle {
  manifest: ExportManifest;
  events: Array<{ kind: string; actorId: string; details: Record<string, unknown> }>;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const BROWSER_DENIAL_KINDS = new Set([
  "browser.allowlist.denied",
  "browser.protocol.denied",
  "browser.redirect.denied",
  "browser.timeout",
  "browser.body.too_large",
  "browser.network.error",
  "browser.content_type.denied",
  "browser.url.denied",
]);

export function validateExportBundle(bundle: ExportBundle): ValidationResult {
  const errors: string[] = [];
  const { manifest, events } = bundle;

  if (!manifest.provenanceId || manifest.provenanceId.trim() === "") {
    errors.push("manifest.provenanceId must be non-empty");
  }

  if (manifest.sessionCount < 0) errors.push("sessionCount must be >= 0");
  if (manifest.taskCount < 0) errors.push("taskCount must be >= 0");
  if (manifest.toolInvocationCount < 0) errors.push("toolInvocationCount must be >= 0");
  if (manifest.browserDenialCount < 0) errors.push("browserDenialCount must be >= 0");
  if (manifest.artifactCount < 0) errors.push("artifactCount must be >= 0");

  // Count events by kind
  let sessionCount = 0;
  let taskCount = 0;
  let toolInvocationCount = 0;
  let browserDenialCount = 0;

  for (const event of events) {
    if (event.kind === "session_created") sessionCount++;
    if (event.kind === "task_created") taskCount++;
    if (event.kind === "tool_invoked") toolInvocationCount++;
    if (BROWSER_DENIAL_KINDS.has(event.kind)) browserDenialCount++;
  }

  if (sessionCount !== manifest.sessionCount) {
    errors.push(
      `sessionCount mismatch: manifest says ${manifest.sessionCount}, events have ${sessionCount}`
    );
  }
  if (taskCount !== manifest.taskCount) {
    errors.push(
      `taskCount mismatch: manifest says ${manifest.taskCount}, events have ${taskCount}`
    );
  }
  if (toolInvocationCount !== manifest.toolInvocationCount) {
    errors.push(
      `toolInvocationCount mismatch: manifest says ${manifest.toolInvocationCount}, events have ${toolInvocationCount}`
    );
  }
  if (browserDenialCount !== manifest.browserDenialCount) {
    errors.push(
      `browserDenialCount mismatch: manifest says ${manifest.browserDenialCount}, events have ${browserDenialCount}`
    );
  }

  // Check provenanceId consistency across events
  if (manifest.provenanceId) {
    for (const event of events) {
      const evtProvenance = event.details["provenanceId"] as string | undefined;
      if (evtProvenance !== undefined && evtProvenance !== manifest.provenanceId) {
        errors.push(
          `provenanceId mismatch in event: expected '${manifest.provenanceId}', got '${evtProvenance}'`
        );
        break;
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
