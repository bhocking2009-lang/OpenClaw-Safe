import { AuditLog } from "../core/audit_log";

export interface ProcessBrokerResult {
  command: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
}

export class ProcessBroker {
  readonly toolClass = "process";
  readonly riskLevel = "high";

  constructor(private readonly auditLog?: AuditLog) {}

  execute(
    args: Record<string, unknown>,
    actorId: string
  ): ProcessBrokerResult {
    const command = (args["command"] as string) ?? "";
    const cmdArgs = (args["args"] as string[]) ?? [];

    // Simulation only – no real process spawning in the broker layer
    return {
      command,
      args: cmdArgs,
      exitCode: 0,
      stdout: `[simulated output for: ${command}]`,
      stderr: "",
    };
  }
}
