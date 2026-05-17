/**
 * Standalone Node.js bootstrap for OpenClaw-Safe.
 *
 * Suitable for packaged distribution (bundled Node runtime + NSIS installer).
 * This is NOT an Electron app — it is a plain Node.js process that:
 *   1. Ensures all application directories exist.
 *   2. Writes a timestamped startup log.
 *   3. Starts the gateway on 127.0.0.1:4242.
 *   4. Opens the default browser to http://127.0.0.1:4242.
 *
 * Fatal error cases:
 *   - Port 4242 already in use → log, write startup log, exit(1).
 *   - DB cannot initialize   → log, write startup log, exit(1).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';
import { ensureAppPaths } from './core/paths';

const HOST = '127.0.0.1';
const PORT = 4242;
const URL = `http://${HOST}:${PORT}`;

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------

let _logPath: string | null = null;

function initLog(logDir: string): void {
  _logPath = path.join(logDir, 'startup.log');
}

function writeLog(line: string): void {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}\n`;
  process.stdout.write(msg);
  if (_logPath) {
    try {
      fs.appendFileSync(_logPath, msg);
    } catch {
      // best-effort
    }
  }
}

// ---------------------------------------------------------------------------
// Browser opener
// ---------------------------------------------------------------------------

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === 'win32') {
      child_process.exec(`start "" "${url}"`);
    } else if (platform === 'darwin') {
      child_process.exec(`open "${url}"`);
    } else {
      child_process.exec(`xdg-open "${url}"`);
    }
  } catch (err) {
    writeLog(`Warning: could not open browser automatically — navigate to ${url}`);
  }
}

// ---------------------------------------------------------------------------
// Gateway bootstrap (mirrors CLI start command)
// ---------------------------------------------------------------------------

async function startGateway(dbPath: string): Promise<void> {
  const { PolicyEngine } = await import('./core/policy');
  const { ToolBroker } = await import('./core/broker');
  const { AuditLog } = await import('./core/audit');
  const { SessionStore } = await import('./core/session');
  const { ApprovalStore } = await import('./core/approval');
  const { MemoryStore } = await import('./core/memory');
  const { Gateway } = await import('./core/gateway');

  let policyEngine: InstanceType<typeof PolicyEngine>;
  let auditLog: InstanceType<typeof AuditLog>;
  let sessionStore: InstanceType<typeof SessionStore>;
  let approvalStore: InstanceType<typeof ApprovalStore>;
  let memoryStore: InstanceType<typeof MemoryStore>;

  try {
    policyEngine = new PolicyEngine();
    auditLog = new AuditLog({ dbPath });
    const broker = new ToolBroker(policyEngine, auditLog);
    sessionStore = new SessionStore({ dbPath });
    approvalStore = new ApprovalStore({ dbPath });
    memoryStore = new MemoryStore({ dbPath });

    const gateway = new Gateway(
      { host: HOST, port: PORT, dbPath, gatewaySecret: '' },
      { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
    );

    await gateway.start();

    writeLog(`Gateway started — ${URL}`);
    writeLog(`Event stream: ws://${HOST}:${PORT}`);

    openBrowser(URL);

    process.on('SIGINT', async () => {
      writeLog('Stopping gateway…');
      await gateway.stop();
      auditLog.close();
      sessionStore.close();
      approvalStore.close();
      memoryStore.close();
      process.exit(0);
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('EADDRINUSE') || message.includes('address already in use')) {
      writeLog(`FATAL: Port ${PORT} is already in use. Is another instance running?`);
      writeLog(`Stop the existing process and try again.`);
    } else if (
      message.includes('SQLITE') ||
      message.includes('database') ||
      message.includes('cannot open')
    ) {
      writeLog(`FATAL: Database could not be initialized — ${message}`);
      writeLog(`Check permissions for: ${dbPath}`);
    } else {
      writeLog(`FATAL: Gateway failed to start — ${message}`);
    }

    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const paths = ensureAppPaths();
  initLog(paths.logs);

  writeLog('OpenClaw-Safe starting…');
  writeLog(`Data directory : ${paths.base}`);
  writeLog(`Database       : ${paths.db}`);

  await startGateway(paths.db);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Unhandled startup error: ${message}\n`);
    process.exit(1);
  });
}
