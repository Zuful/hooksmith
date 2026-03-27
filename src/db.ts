import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import type { WebhookEvent } from "./types";

const DEFAULT_DB_DIR = join(homedir(), ".hooksmith");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "hooksmith.db");

function getDbPath(): string {
  return process.env.HOOKSMITH_DB_PATH || DEFAULT_DB_PATH;
}

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;

  const dbPath = getDbPath();
  mkdirSync(join(dbPath, ".."), { recursive: true });

  _db = new Database(dbPath);
  _db.run("PRAGMA journal_mode = WAL");
  _db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id          TEXT    PRIMARY KEY,
      source      TEXT    NOT NULL,
      type        TEXT    NOT NULL,
      timestamp   TEXT    NOT NULL,
      payload     TEXT    NOT NULL,
      raw         TEXT    NOT NULL,
      status      TEXT    NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL
    )
  `);
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_source ON events(source)");
  _db.run("CREATE INDEX IF NOT EXISTS idx_events_status ON events(status)");

  return _db;
}

// ── Write ────────────────────────────────────────────────────────────────────

export function insertEvent(event: WebhookEvent): void {
  getDb().run(
    `INSERT INTO events (id, source, type, timestamp, payload, raw, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      event.id,
      event.source,
      event.type,
      event.timestamp,
      JSON.stringify(event.payload),
      JSON.stringify(event.raw),
      Date.now(),
    ],
  );
}

export function ackEvent(id: string): boolean {
  const result = getDb().run(
    "UPDATE events SET status = 'processed' WHERE id = ? AND status = 'pending'",
    [id],
  );
  return result.changes > 0;
}

export function deleteProcessed(source?: string): number {
  let result;
  if (source) {
    result = getDb().run(
      "DELETE FROM events WHERE status = 'processed' AND source = ?",
      [source],
    );
  } else {
    result = getDb().run("DELETE FROM events WHERE status = 'processed'");
  }
  return result.changes;
}

// ── Read ─────────────────────────────────────────────────────────────────────

type Row = {
  id: string;
  source: string;
  type: string;
  timestamp: string;
  payload: string;
  raw: string;
};

function rowToEvent(row: Row): WebhookEvent {
  return {
    id: row.id,
    source: row.source,
    type: row.type,
    timestamp: row.timestamp,
    payload: JSON.parse(row.payload),
    raw: JSON.parse(row.raw),
  };
}

export function queryEvents(opts: {
  source?: string;
  type?: string;
  status?: "pending" | "processed";
  limit?: number;
}): WebhookEvent[] {
  const { source, type, status = "pending", limit = 20 } = opts;

  const conditions: string[] = ["status = ?"];
  const params: unknown[] = [status];

  if (source) {
    conditions.push("source = ?");
    params.push(source);
  }
  if (type) {
    conditions.push("type = ?");
    params.push(type);
  }

  params.push(limit);

  const sql = `
    SELECT id, source, type, timestamp, payload, raw
    FROM events
    WHERE ${conditions.join(" AND ")}
    ORDER BY timestamp DESC
    LIMIT ?
  `;

  const rows = getDb().query<Row, unknown[]>(sql).all(...params);
  return rows.map(rowToEvent);
}

export function findEvent(id: string): WebhookEvent | null {
  const row = getDb()
    .query<Row, [string]>(
      "SELECT id, source, type, timestamp, payload, raw FROM events WHERE id = ?",
    )
    .get(id);
  return row ? rowToEvent(row) : null;
}

export function listSources(): string[] {
  const rows = getDb()
    .query<{ source: string }, []>(
      "SELECT DISTINCT source FROM events ORDER BY source",
    )
    .all();
  return rows.map((r) => r.source);
}

export function deleteExpired(maxAgeDays: number): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);
  const result = getDb().run(
    "DELETE FROM events WHERE timestamp < ?",
    [cutoff.toISOString()]
  );
  return result.changes;
}

/** Close and reset the singleton — for use in tests only. */
export function resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
