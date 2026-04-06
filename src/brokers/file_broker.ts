import { AuditLog } from "../core/audit_log";

export interface FileBrokerResult {
  operation: string;
  path: string;
  content?: unknown;
}

export class FileBroker {
  readonly toolClass = "file";
  readonly riskLevel = "medium";

  constructor(private readonly auditLog?: AuditLog) {}

  execute(
    args: Record<string, unknown>,
    actorId: string
  ): FileBrokerResult {
    // TODO: emit audit event via this.auditLog when audit integration is added
    void actorId;
    const operation = (args["operation"] as string) ?? "read";
    const path = (args["path"] as string) ?? "";
    const content = args["content"];

    return { operation, path, content };
  }
}
