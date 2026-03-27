import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { deleteExpired, getDb, resetDb } from "../src/db";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

let testDbPath: string;

beforeAll(() => {
  testDbPath = join(tmpdir(), `hooksmith-ttl-test-${Date.now()}.db`);
  process.env.HOOKSMITH_DB_PATH = testDbPath;
  resetDb(); // force re-init with new path
});

afterAll(async () => {
  resetDb();
  await rm(testDbPath, { force: true });
  delete process.env.HOOKSMITH_DB_PATH;
});

function insertWithTimestamp(timestamp: string) {
  const id = randomUUID();
  getDb().run(
    `INSERT INTO events (id, source, type, timestamp, payload, raw, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [id, "test", "test", timestamp, "{}", "{}", Date.now()],
  );
  return id;
}

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

describe("TTL / deleteExpired", () => {
  test("deletes events older than maxAgeDays", () => {
    insertWithTimestamp(daysAgo(31));
    const deleted = deleteExpired(30);
    expect(deleted).toBe(1);
  });

  test("does NOT delete recent events", () => {
    const id = insertWithTimestamp(daysAgo(1));
    const deleted = deleteExpired(30);
    expect(deleted).toBe(0);
    // verify event still exists
    const row = getDb()
      .query<{ id: string }, [string]>("SELECT id FROM events WHERE id = ?")
      .get(id);
    expect(row).toBeTruthy();
  });

  test("returns correct count for multiple expired events", () => {
    insertWithTimestamp(daysAgo(40));
    insertWithTimestamp(daysAgo(35));
    insertWithTimestamp(daysAgo(2)); // should not be deleted
    const deleted = deleteExpired(30);
    expect(deleted).toBe(2);
  });
});
