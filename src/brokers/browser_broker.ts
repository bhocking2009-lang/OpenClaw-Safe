import { BrowserWorker, BrowserFetchResult, BrowserFetchOptions } from "../workers/browser";
import { AuditLog } from "../core/audit_log";

export class BrowserBroker {
  readonly toolClass = "browser";
  readonly riskLevel = "high";

  private readonly worker: BrowserWorker;

  constructor(options: BrowserFetchOptions = {}, private readonly auditLog?: AuditLog) {
    this.worker = new BrowserWorker(options, auditLog);
  }

  async execute(
    args: Record<string, unknown>,
    actorId: string,
    fetchImpl?: Parameters<BrowserWorker["fetch"]>[2]
  ): Promise<BrowserFetchResult> {
    const url = args["url"] as string;
    if (!url) throw new Error("BrowserBroker.execute: 'url' argument is required.");
    return this.worker.fetch(url, actorId, fetchImpl);
  }
}
