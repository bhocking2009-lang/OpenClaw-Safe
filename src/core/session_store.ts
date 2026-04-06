import Database from "better-sqlite3";

export interface SessionRecord {
  sessionId: string;
  principalId: string;
  budget: number;
  createdAt: string;
  active: boolean;
}

interface SessionRow {
  session_id: string;
  principal_id: string;
  budget: number;
  created_at: string;
  active: number;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath = ":memory:") {
    this.db = new Database(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        principal_id TEXT NOT NULL,
        budget INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1
      )
    `);
  }

  create(sessionId: string, principalId: string, budget: number): SessionRecord {
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        "INSERT INTO sessions (session_id, principal_id, budget, created_at, active) VALUES (?, ?, ?, ?, 1)"
      )
      .run(sessionId, principalId, budget, createdAt);
    return { sessionId, principalId, budget, createdAt, active: true };
  }

  get(sessionId: string): SessionRecord | undefined {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow | undefined;
    if (!row) return undefined;
    return this.deserialize(row);
  }

  decrementBudget(sessionId: string, amount: number): SessionRecord {
    this.db
      .prepare("UPDATE sessions SET budget = budget - ? WHERE session_id = ?")
      .run(amount, sessionId);
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId) as SessionRow;
    return this.deserialize(row);
  }

  close(): void {
    this.db.close();
  }

  private deserialize(row: SessionRow): SessionRecord {
    return {
      sessionId: row.session_id,
      principalId: row.principal_id,
      budget: row.budget,
      createdAt: row.created_at,
      active: row.active === 1,
    };
  }
}
