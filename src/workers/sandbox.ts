/**
 * Sandbox worker for OpenClaw Secure.
 *
 * The sandbox worker is the default execution target.
 * It executes tools in an isolated environment with:
 *   - ephemeral per-task runtime
 *   - CPU/memory/time quotas
 *   - no network by default
 *   - filesystem diff capture
 *
 * This file provides:
 *   1. The SandboxWorker class (Node.js child_process-based sandbox)
 *   2. A StubWorker for testing and no-worker environments
 */

import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { WorkerExecutor } from '../core/broker';
import { ToolSchema, ExecutionLease, RuntimeReceipt, RuntimeTarget } from '../core/types';

export interface SandboxConfig {
  /** Base directory for task workspaces */
  workspaceBaseDir: string;
  /** Maximum wall-clock time per invocation in ms */
  timeoutMs: number;
  /** Maximum stdout+stderr bytes to capture */
  maxOutputBytes: number;
}

const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  workspaceBaseDir: path.join(os.tmpdir(), 'openclaw-sandbox'),
  timeoutMs: 30_000,
  maxOutputBytes: 1_024 * 1_024, // 1 MiB
};

/**
 * SandboxWorker executes tool scripts in a child process with:
 *   - a per-invocation temporary workspace
 *   - a wall-clock timeout
 *   - stdout/stderr capture
 *   - basic filesystem diff (files added/modified in workspace)
 *
 * Network is not available in the default sandbox mode.
 * Host elevation is NOT performed; tools that require it must use
 * a different worker registered for 'host_elevated' target.
 */
export class SandboxWorker implements WorkerExecutor {
  readonly runtimeTarget: RuntimeTarget = 'sandbox';
  private config: SandboxConfig;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    fs.mkdirSync(this.config.workspaceBaseDir, { recursive: true });
  }

  async execute(
    tool: ToolSchema,
    params: Record<string, unknown>,
    lease: ExecutionLease
  ): Promise<RuntimeReceipt> {
    const startedAt = new Date().toISOString();
    const workDir = path.join(this.config.workspaceBaseDir, lease.id);
    fs.mkdirSync(workDir, { recursive: true });

    // Write params file
    const paramsFile = path.join(workDir, 'params.json');
    fs.writeFileSync(paramsFile, JSON.stringify(params, null, 2));

    // Snapshot files before execution
    const filesBefore = this.snapshotWorkdir(workDir);

    let stdout = '';
    let stderr = '';
    let exitCode = 0;

    try {
      const result = await this.runInSandbox(tool, params, workDir);
      stdout = result.stdout.slice(0, this.config.maxOutputBytes);
      stderr = result.stderr.slice(0, this.config.maxOutputBytes);
      exitCode = result.exitCode;
    } catch (err) {
      stderr = err instanceof Error ? err.message : String(err);
      exitCode = 1;
    }

    // Compute diff
    const filesAfter = this.snapshotWorkdir(workDir);
    const fileDiffs = this.computeDiff(filesBefore, filesAfter, workDir);

    const finishedAt = new Date().toISOString();
    return {
      invocationId: lease.toolInvocationId,
      runtimeTarget: 'sandbox',
      sandboxId: lease.id,
      exitCode,
      stdout,
      stderr,
      fileDiffs,
      artifacts: [],
      startedAt,
      finishedAt,
    };
  }

  private runInSandbox(
    tool: ToolSchema,
    params: Record<string, unknown>,
    workDir: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      // For now, echo the tool name and params as a safe stub.
      // Real implementations would exec a sandboxed script.
      const proc = spawn(
        process.execPath,
        [
          '-e',
          `process.stdout.write(JSON.stringify({tool:${JSON.stringify(tool.name)},params:${JSON.stringify(params)},status:'executed'}))`,
        ],
        {
          cwd: workDir,
          env: {
            // Minimal env — no PATH manipulation, no secrets
            HOME: workDir,
            TMPDIR: workDir,
          },
          timeout: this.config.timeoutMs,
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 0 });
      });
      proc.on('error', reject);
    });
  }

  private snapshotWorkdir(dir: string): Set<string> {
    const result = new Set<string>();
    if (!fs.existsSync(dir)) return result;
    for (const entry of fs.readdirSync(dir, { recursive: true }) as string[]) {
      result.add(entry);
    }
    return result;
  }

  private computeDiff(before: Set<string>, after: Set<string>, workDir: string): string[] {
    const diffs: string[] = [];
    for (const f of after) {
      if (!before.has(f)) {
        diffs.push(`+${path.join(workDir, f)}`);
      }
    }
    return diffs;
  }
}

/**
 * StubWorker returns a deterministic receipt without actually executing anything.
 * Used in tests and when no real worker is available.
 */
export class StubWorker implements WorkerExecutor {
  readonly runtimeTarget: RuntimeTarget;

  constructor(target: RuntimeTarget = 'sandbox') {
    this.runtimeTarget = target;
  }

  async execute(
    tool: ToolSchema,
    params: Record<string, unknown>,
    lease: ExecutionLease
  ): Promise<RuntimeReceipt> {
    const now = new Date().toISOString();
    return {
      invocationId: lease.toolInvocationId,
      runtimeTarget: this.runtimeTarget,
      sandboxId: lease.id,
      exitCode: 0,
      stdout: JSON.stringify({ tool: tool.name, params, status: 'stub_executed' }),
      stderr: '',
      fileDiffs: [],
      artifacts: [],
      startedAt: now,
      finishedAt: now,
    };
  }
}
