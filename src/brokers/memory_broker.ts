import { AuditLog } from "../core/audit_log";

export interface MemoryBrokerResult {
  operation: "get" | "set" | "delete" | "list";
  key?: string;
  value?: unknown;
  keys?: string[];
}

export class MemoryBroker {
  readonly toolClass = "memory";
  readonly riskLevel = "low";

  private store: Map<string, unknown> = new Map();

  constructor(private readonly auditLog?: AuditLog) {}

  execute(args: Record<string, unknown>, actorId: string): MemoryBrokerResult {
    // TODO: emit audit event via this.auditLog when audit integration is added
    void actorId;
    const operation = (args["operation"] as string) ?? "get";
    const key = args["key"] as string | undefined;

    switch (operation) {
      case "set": {
        if (!key) throw new Error("MemoryBroker: 'key' is required for set operation.");
        this.store.set(key, args["value"]);
        return { operation: "set", key, value: args["value"] };
      }
      case "get": {
        if (!key) throw new Error("MemoryBroker: 'key' is required for get operation.");
        return { operation: "get", key, value: this.store.get(key) };
      }
      case "delete": {
        if (!key) throw new Error("MemoryBroker: 'key' is required for delete operation.");
        this.store.delete(key);
        return { operation: "delete", key };
      }
      case "list": {
        return { operation: "list", keys: Array.from(this.store.keys()) };
      }
      default:
        throw new Error(`MemoryBroker: unknown operation '${operation}'.`);
    }
  }
}
