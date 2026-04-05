/**
 * Artifact store for OpenClaw Secure.
 *
 * Persists artifact metadata produced during tool execution.
 * Artifacts are append-only records. Content lives at the artifact URI;
 * this store tracks the metadata (type, provenance, checksum, retention).
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Artifact, ArtifactType, RetentionClass } from './types';

export interface ArtifactStoreOptions {
  dbPath: string;
}

export class ArtifactStore {
  private db: Database.Database;

  constructor(options: ArtifactStoreOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        uri TEXT NOT NULL,
        provenance_id TEXT NOT NULL,
        checksum TEXT NOT NULL,
        retention_class TEXT NOT NULL DEFAULT 'session',
        label TEXT,
        invocation_id TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_artifacts_provenance ON artifacts(provenance_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_type ON artifacts(type);
      CREATE INDEX IF NOT EXISTS idx_artifacts_invocation ON artifacts(invocation_id);
    `);
  }

  store(params: {
    type: ArtifactType;
    uri: string;
    provenanceId: string;
    checksum: string;
    retentionClass?: RetentionClass;
    label?: string;
    invocationId?: string;
  }): Artifact {
    const artifact: Artifact = {
      id: uuidv4(),
      type: params.type,
      uri: params.uri,
      provenanceId: params.provenanceId,
      checksum: params.checksum,
      retentionClass: params.retentionClass ?? 'session',
      label: params.label,
      invocationId: params.invocationId,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO artifacts (id, type, uri, provenance_id, checksum, retention_class, label, invocation_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        artifact.id,
        artifact.type,
        artifact.uri,
        artifact.provenanceId,
        artifact.checksum,
        artifact.retentionClass,
        artifact.label ?? null,
        artifact.invocationId ?? null,
        artifact.createdAt
      );
    return artifact;
  }

  getById(id: string): Artifact | undefined {
    const row = this.db
      .prepare('SELECT * FROM artifacts WHERE id = ?')
      .get(id) as RawArtifact | undefined;
    return row ? deserialize(row) : undefined;
  }

  listByProvenance(provenanceId: string): Artifact[] {
    return (
      this.db
        .prepare('SELECT * FROM artifacts WHERE provenance_id = ? ORDER BY created_at ASC')
        .all(provenanceId) as RawArtifact[]
    ).map(deserialize);
  }

  listByInvocation(invocationId: string): Artifact[] {
    return (
      this.db
        .prepare('SELECT * FROM artifacts WHERE invocation_id = ? ORDER BY created_at ASC')
        .all(invocationId) as RawArtifact[]
    ).map(deserialize);
  }

  listAll(): Artifact[] {
    return (
      this.db
        .prepare('SELECT * FROM artifacts ORDER BY created_at DESC')
        .all() as RawArtifact[]
    ).map(deserialize);
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM artifacts WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization
// ---------------------------------------------------------------------------

interface RawArtifact {
  id: string;
  type: string;
  uri: string;
  provenance_id: string;
  checksum: string;
  retention_class: string;
  label: string | null;
  invocation_id: string | null;
  created_at: string;
}

function deserialize(row: RawArtifact): Artifact {
  return {
    id: row.id,
    type: row.type as ArtifactType,
    uri: row.uri,
    provenanceId: row.provenance_id,
    checksum: row.checksum,
    retentionClass: row.retention_class as RetentionClass,
    label: row.label ?? undefined,
    invocationId: row.invocation_id ?? undefined,
    createdAt: row.created_at,
  };
}


export interface ArtifactStoreOptions {
  dbPath: string;
}
