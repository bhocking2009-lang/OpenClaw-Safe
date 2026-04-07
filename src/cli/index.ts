/**
 * CLI for OpenClaw Secure.
 *
 * Provides commands to:
 *   - start the gateway daemon
 *   - list sessions, tasks, approvals
 *   - approve/deny pending approvals
 *   - query the audit log
 *   - export a replay pack
 */

import { Command } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import { getAppPaths, ensureAppPaths } from '../core/paths';

// We do a lazy import of the gateway stack to avoid loading SQLite
// unless the command actually needs it.
async function buildGateway(dbPath: string) {
  const { PolicyEngine } = await import('../core/policy');
  const { ToolBroker } = await import('../core/broker');
  const { AuditLog } = await import('../core/audit');
  const { SessionStore } = await import('../core/session');
  const { ApprovalStore } = await import('../core/approval');
  const { MemoryStore } = await import('../core/memory');
  const { Gateway } = await import('../core/gateway');

  const policyEngine = new PolicyEngine();
  const auditLog = new AuditLog({ dbPath });
  const broker = new ToolBroker(policyEngine, auditLog);
  const sessionStore = new SessionStore({ dbPath });
  const approvalStore = new ApprovalStore({ dbPath });
  const memoryStore = new MemoryStore({ dbPath });

  return { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, Gateway };
}

const DEFAULT_DB = getAppPaths().db;

export function createCLI(): Command {
  const program = new Command();

  program
    .name('openclaw')
    .description('OpenClaw Secure — local-first policy-brokered agent OS')
    .version('1.0.0');

  // -----------------------------------------------------------------------
  // start
  // -----------------------------------------------------------------------
  program
    .command('start')
    .description('Start the gateway daemon')
    .option('--port <port>', 'Port to listen on', '4242')
    .option('--host <host>', 'Host to bind to', '127.0.0.1')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .option('--secret <secret>', 'Gateway shared secret', '')
    .action(async (opts: { port: string; host: string; db: string; secret: string }) => {
      // If using the default DB, ensure all app directories exist.
      // If using a custom --db path, just ensure its parent directory exists.
      if (opts.db === DEFAULT_DB) {
        ensureAppPaths();
      } else {
        const dbDir = path.dirname(opts.db);
        fs.mkdirSync(dbDir, { recursive: true });
      }

      const { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore, Gateway } =
        await buildGateway(opts.db);

      const gateway = new Gateway(
        {
          host: opts.host,
          port: parseInt(opts.port, 10),
          dbPath: opts.db,
          gatewaySecret: opts.secret,
        },
        { policyEngine, broker, auditLog, sessionStore, approvalStore, memoryStore }
      );

      await gateway.start();
      console.log(`OpenClaw Secure gateway started on http://${opts.host}:${opts.port}`);
      console.log(`Event stream: ws://${opts.host}:${opts.port}`);
      console.log('Press Ctrl+C to stop.');

      process.on('SIGINT', async () => {
        console.log('\nStopping gateway...');
        await gateway.stop();
        auditLog.close();
        sessionStore.close();
        approvalStore.close();
        memoryStore.close();
        process.exit(0);
      });
    });

  // -----------------------------------------------------------------------
  // sessions
  // -----------------------------------------------------------------------
  program
    .command('sessions')
    .description('List sessions for a principal')
    .requiredOption('--principal <id>', 'Principal ID')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (opts: { principal: string; db: string }) => {
      const { sessionStore } = await buildGateway(opts.db);
      const sessions = sessionStore.listSessionsByPrincipal(opts.principal);
      if (sessions.length === 0) {
        console.log('No sessions found.');
      } else {
        console.table(
          sessions.map((s) => ({
            id: s.id,
            mode: s.mode,
            budget: s.budget,
            elevated: s.elevationState,
            created: s.createdAt,
          }))
        );
      }
      sessionStore.close();
    });

  // -----------------------------------------------------------------------
  // tasks
  // -----------------------------------------------------------------------
  program
    .command('tasks')
    .description('List tasks for a session')
    .requiredOption('--session <id>', 'Session ID')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (opts: { session: string; db: string }) => {
      const { sessionStore } = await buildGateway(opts.db);
      const tasks = sessionStore.listTasksBySession(opts.session);
      if (tasks.length === 0) {
        console.log('No tasks found.');
      } else {
        console.table(
          tasks.map((t) => ({
            id: t.id,
            title: t.title,
            state: t.state,
            sandbox: t.sandboxClass,
            created: t.createdAt,
          }))
        );
      }
      sessionStore.close();
    });

  // -----------------------------------------------------------------------
  // approvals
  // -----------------------------------------------------------------------
  program
    .command('approvals')
    .description('List pending approvals')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (opts: { db: string }) => {
      const { approvalStore } = await buildGateway(opts.db);
      const pending = approvalStore.listPending();
      if (pending.length === 0) {
        console.log('No pending approvals.');
      } else {
        for (const req of pending) {
          console.log(`\n[${req.id}] ${req.requestedAction}`);
          console.log(`  Risk class : ${req.riskClass}`);
          console.log(`  Diff       : ${req.humanReadableDiff}`);
          console.log(`  Scope      : ${JSON.stringify(req.proposedScope)}`);
          console.log(`  Created    : ${req.createdAt}`);
        }
      }
      approvalStore.close();
    });

  program
    .command('approve <id>')
    .description('Approve a pending approval request')
    .requiredOption('--approver <id>', 'Approver principal ID')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (id: string, opts: { approver: string; db: string }) => {
      const { approvalStore } = await buildGateway(opts.db);
      const result = approvalStore.resolve(id, opts.approver, 'approved');
      if (!result) {
        console.error('Approval request not found or already resolved.');
        process.exitCode = 1;
      } else {
        console.log(`Approved: ${id}`);
      }
      approvalStore.close();
    });

  program
    .command('deny <id>')
    .description('Deny a pending approval request')
    .requiredOption('--approver <id>', 'Approver principal ID')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (id: string, opts: { approver: string; db: string }) => {
      const { approvalStore } = await buildGateway(opts.db);
      const result = approvalStore.resolve(id, opts.approver, 'denied');
      if (!result) {
        console.error('Approval request not found or already resolved.');
        process.exitCode = 1;
      } else {
        console.log(`Denied: ${id}`);
      }
      approvalStore.close();
    });

  // -----------------------------------------------------------------------
  // audit
  // -----------------------------------------------------------------------
  program
    .command('audit')
    .description('Query the audit log')
    .option('--session <id>', 'Filter by session ID')
    .option('--task <id>', 'Filter by task ID')
    .option('--principal <id>', 'Filter by principal ID')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (opts: { session?: string; task?: string; principal?: string; db: string }) => {
      const { auditLog } = await buildGateway(opts.db);
      let records;
      if (opts.session) records = auditLog.queryBySession(opts.session);
      else if (opts.task) records = auditLog.queryByTask(opts.task);
      else if (opts.principal) records = auditLog.queryByPrincipal(opts.principal);
      else records = auditLog.exportAll();

      if (records.length === 0) {
        console.log('No audit records found.');
      } else {
        console.table(
          records.map((r) => ({
            id: r.id.slice(0, 8),
            event: r.eventType,
            tool: r.toolName ?? '-',
            runtime: r.runtimeTarget ?? '-',
            started: r.startedAt,
            error: r.error ?? '-',
          }))
        );
      }
      auditLog.close();
    });

  // -----------------------------------------------------------------------
  // replay-export
  // -----------------------------------------------------------------------
  program
    .command('replay-export')
    .description('Export a replay pack for a session')
    .requiredOption('--session <id>', 'Session ID')
    .option('--out <path>', 'Output file path', './replay-pack.json')
    .option('--db <path>', 'Database path', DEFAULT_DB)
    .action(async (opts: { session: string; out: string; db: string }) => {
      const { auditLog } = await buildGateway(opts.db);
      const records = auditLog.queryBySession(opts.session);
      const pack = {
        version: '1',
        sessionId: opts.session,
        exportedAt: new Date().toISOString(),
        records,
      };
      fs.writeFileSync(opts.out, JSON.stringify(pack, null, 2));
      console.log(`Replay pack written to ${opts.out} (${records.length} records)`);
      auditLog.close();
    });

  return program;
}
