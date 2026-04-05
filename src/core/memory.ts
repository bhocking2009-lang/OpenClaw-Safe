/**
 * Memory service for OpenClaw Secure.
 *
 * Memory is layered, not a vague blob:
 *   - transcript  : conversation turns
 *   - task        : task-scoped working memory
 *   - factual     : asserted facts
 *   - preference  : user/operator preferences
 *   - episodic    : past episode summaries
 *   - document    : source document cache
 *   - summary     : derived summaries
 *
 * Source-backed memory and evidence linking are first-class.
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { MemoryItem, MemoryKind, RedactClass } from './types';

export interface MemoryStoreOptions {
  dbPath: string;
}

export interface MemoryQuery {
  namespace?: string;
  kind?: MemoryKind;
  redactClass?: RedactClass;
  /** Minimum confidence [0,1] */
  minConfidence?: number;
  limit?: number;
}

export class MemoryStore {
  private db: Database.Database;

  constructor(options: MemoryStoreOptions) {
    this.db = new Database(options.dbPath);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_items (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        source_refs TEXT NOT NULL DEFAULT '[]',
        confidence REAL NOT NULL DEFAULT 1.0,
        redact_class TEXT NOT NULL DEFAULT 'internal',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_namespace ON memory_items(namespace);
      CREATE INDEX IF NOT EXISTS idx_memory_kind ON memory_items(kind);
      CREATE INDEX IF NOT EXISTS idx_memory_redact ON memory_items(redact_class);
    `);
  }

  store(params: {
    namespace: string;
    kind: MemoryKind;
    content: string;
    sourceRefs?: string[];
    confidence?: number;
    redactClass?: RedactClass;
  }): MemoryItem {
    const item: MemoryItem = {
      id: uuidv4(),
      namespace: params.namespace,
      kind: params.kind,
      content: params.content,
      sourceRefs: params.sourceRefs ?? [],
      confidence: params.confidence ?? 1.0,
      redactClass: params.redactClass ?? 'internal',
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO memory_items
          (id, namespace, kind, content, source_refs, confidence, redact_class, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.id,
        item.namespace,
        item.kind,
        item.content,
        JSON.stringify(item.sourceRefs),
        item.confidence,
        item.redactClass,
        item.createdAt
      );
    return item;
  }

  getById(id: string): MemoryItem | undefined {
    const row = this.db
      .prepare('SELECT * FROM memory_items WHERE id = ?')
      .get(id) as RawMemory | undefined;
    return row ? deserializeMemory(row) : undefined;
  }

  query(query: MemoryQuery): MemoryItem[] {
    const conditions: string[] = [];
    const values: (string | number)[] = [];

    if (query.namespace) {
      conditions.push('namespace = ?');
      values.push(query.namespace);
    }
    if (query.kind) {
      conditions.push('kind = ?');
      values.push(query.kind);
    }
    if (query.redactClass) {
      conditions.push('redact_class = ?');
      values.push(query.redactClass);
    }
    if (query.minConfidence !== undefined) {
      conditions.push('confidence >= ?');
      values.push(query.minConfidence);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = query.limit ? `LIMIT ${query.limit}` : '';
    const sql = `SELECT * FROM memory_items ${where} ORDER BY confidence DESC, created_at DESC ${limit}`;
    const rows = this.db.prepare(sql).all(...values) as RawMemory[];
    return rows.map(deserializeMemory);
  }

  deleteById(id: string): void {
    this.db.prepare('DELETE FROM memory_items WHERE id = ?').run(id);
  }

  deleteByNamespace(namespace: string): void {
    this.db.prepare('DELETE FROM memory_items WHERE namespace = ?').run(namespace);
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal deserialization
// ---------------------------------------------------------------------------

interface RawMemory {
  id: string;
  namespace: string;
  kind: string;
  content: string;
  source_refs: string;
  confidence: number;
  redact_class: string;
  created_at: string;
}

function deserializeMemory(row: RawMemory): MemoryItem {
  return {
    id: row.id,
    namespace: row.namespace,
    kind: row.kind as MemoryKind,
    content: row.content,
    sourceRefs: JSON.parse(row.source_refs) as string[],
    confidence: row.confidence,
    redactClass: row.redact_class as RedactClass,
    createdAt: row.created_at,
  };
}
