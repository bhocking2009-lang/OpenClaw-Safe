/**
 * Plugin store for OpenClaw Secure.
 *
 * Persists plugin manifests and lifecycle state in SQLite.
 * Plugins interact with the rest of the system only through the broker and
 * policy engine — this store holds configuration only, not execution state.
 */

import Database from 'better-sqlite3';
import { PluginManifest, PluginState, ToolRiskClass } from './types';

export interface PluginStoreOptions {
  dbPath: string;
}

interface RawPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  capabilities: string;        // JSON array
  allowed_network_domains: string; // JSON array
  declared_secret_needs: string;   // JSON array
  execution_mode: string;
  package_hash: string;
  pinned_version: string;
  installed_at: string;
  reviewed_at: string | null;
  risk_class: string;
  state: PluginState;
}

function deserializePlugin(row: RawPlugin): PluginManifest {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    description: row.description,
    capabilities: JSON.parse(row.capabilities) as string[],
    allowedNetworkDomains: JSON.parse(row.allowed_network_domains) as string[],
    declaredSecretNeeds: JSON.parse(row.declared_secret_needs) as string[],
    executionMode: row.execution_mode,
    packageHash: row.package_hash,
    pinnedVersion: row.pinned_version,
    installedAt: row.installed_at,
    reviewedAt: row.reviewed_at ?? undefined,
    riskClass: row.risk_class as ToolRiskClass,
    state: row.state,
  };
}

export class PluginStore {
  private db: ReturnType<typeof Database>;

  constructor(opts: PluginStoreOptions) {
    this.db = Database(opts.dbPath);
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id                    TEXT PRIMARY KEY,
        name                  TEXT NOT NULL,
        version               TEXT NOT NULL,
        description           TEXT NOT NULL DEFAULT '',
        capabilities          TEXT NOT NULL DEFAULT '[]',
        allowed_network_domains TEXT NOT NULL DEFAULT '[]',
        declared_secret_needs TEXT NOT NULL DEFAULT '[]',
        execution_mode        TEXT NOT NULL DEFAULT 'isolated_process',
        package_hash          TEXT NOT NULL DEFAULT '',
        pinned_version        TEXT NOT NULL DEFAULT '',
        installed_at          TEXT NOT NULL,
        reviewed_at           TEXT,
        risk_class            TEXT NOT NULL DEFAULT 'C',
        state                 TEXT NOT NULL DEFAULT 'installed'
      )
    `);
  }

  install(manifest: PluginManifest): PluginManifest {
    const m = { ...manifest, state: 'installed' as PluginState };
    this.db.prepare(`
      INSERT OR REPLACE INTO plugins
        (id, name, version, description, capabilities, allowed_network_domains,
         declared_secret_needs, execution_mode, package_hash, pinned_version,
         installed_at, reviewed_at, risk_class, state)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      m.id,
      m.name,
      m.version,
      m.description,
      JSON.stringify(m.capabilities),
      JSON.stringify(m.allowedNetworkDomains),
      JSON.stringify(m.declaredSecretNeeds),
      m.executionMode,
      m.packageHash,
      m.pinnedVersion,
      m.installedAt,
      m.reviewedAt ?? null,
      m.riskClass,
      m.state,
    );
    return m;
  }

  get(id: string): PluginManifest | undefined {
    const row = this.db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as RawPlugin | undefined;
    return row ? deserializePlugin(row) : undefined;
  }

  list(): PluginManifest[] {
    return (this.db.prepare('SELECT * FROM plugins ORDER BY installed_at ASC').all() as RawPlugin[])
      .map(deserializePlugin);
  }

  setState(id: string, state: PluginState): PluginManifest | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;
    this.db.prepare('UPDATE plugins SET state = ? WHERE id = ?').run(state, id);
    return { ...existing, state };
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM plugins WHERE id = ?').run(id);
    return result.changes > 0;
  }

  close(): void {
    this.db.close();
  }
}
