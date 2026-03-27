import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WebhookEvent } from "../src/types";
import {
  insertEvent,
  findEvent,
  queryEvents,
  ackEvent,
  deleteProcessed,
  listSources,
  resetDb,
} from "../src/db";

let testDbPath: string;

function makeEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: crypto.randomUUID(),
    source: "github",
    type: "push",
    timestamp: new Date().toISOString(),
    payload: { ref: "refs/heads/main" },
    raw: {},
    ...overrides,
  };
}

beforeAll(() => {
  testDbPath = join(tmpdir(), `hooksmith-mcp-test-${Date.now()}.db`);
  process.env.HOOKSMITH_DB_PATH = testDbPath;
});

afterAll(async () => {
  resetDb();
  await rm(testDbPath, { force: true });
  delete process.env.HOOKSMITH_DB_PATH;
});

describe("MCP server tools", () => {
  test("inserted event can be retrieved by ID", () => {
    const event = makeEvent({ source: "github", type: "push" });
    insertEvent(event);

    const read = findEvent(event.id);
    expect(read).toBeTruthy();
    expect(read!.id).toBe(event.id);
    expect(read!.source).toBe("github");
    expect(read!.type).toBe("push");
  });

  test("findEvent returns null for unknown ID", () => {
    expect(findEvent("does-not-exist")).toBeNull();
  });

  test("queryEvents returns pending events, newest first", () => {
    const e1 = makeEvent({ timestamp: "2026-03-25T01:00:00Z" });
    const e2 = makeEvent({ timestamp: "2026-03-25T03:00:00Z" });
    const e3 = makeEvent({ timestamp: "2026-03-25T02:00:00Z" });
    insertEvent(e1);
    insertEvent(e2);
    insertEvent(e3);

    const events = queryEvents({ limit: 100 });
    for (let i = 0; i < events.length - 1; i++) {
      expect(new Date(events[i]!.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i + 1]!.timestamp).getTime(),
      );
    }
  });

  test("queryEvents filters by source", () => {
    const gh = makeEvent({ source: "github" });
    const gl = makeEvent({ source: "gitlab" });
    insertEvent(gh);
    insertEvent(gl);

    const githubEvents = queryEvents({ source: "github", limit: 100 });
    const gitlabEvents = queryEvents({ source: "gitlab", limit: 100 });

    expect(githubEvents.every((e) => e.source === "github")).toBe(true);
    expect(gitlabEvents.every((e) => e.source === "gitlab")).toBe(true);
    expect(githubEvents.length).toBeGreaterThanOrEqual(1);
    expect(gitlabEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("queryEvents filters by type", () => {
    const push = makeEvent({ type: "push" });
    const pr = makeEvent({ type: "pull_request" });
    insertEvent(push);
    insertEvent(pr);

    const pushEvents = queryEvents({ type: "push", limit: 100 });
    expect(pushEvents.every((e) => e.type === "push")).toBe(true);
  });

  test("ackEvent marks event as processed, hides it from default queryEvents", () => {
    const event = makeEvent();
    insertEvent(event);

    expect(ackEvent(event.id)).toBe(true);

    // Pending inbox should no longer contain this event
    const pending = queryEvents({ limit: 100 });
    expect(pending.find((e) => e.id === event.id)).toBeUndefined();

    // Should appear in processed view
    const processed = queryEvents({ status: "processed", limit: 100 });
    expect(processed.find((e) => e.id === event.id)).toBeTruthy();
  });

  test("ackEvent returns false for unknown or already-processed event", () => {
    expect(ackEvent("no-such-id")).toBe(false);
  });

  test("listSources returns unique sources", () => {
    insertEvent(makeEvent({ source: "stripe" }));
    insertEvent(makeEvent({ source: "stripe" })); // duplicate
    insertEvent(makeEvent({ source: "custom" }));

    const sources = listSources();
    expect(sources).toContain("stripe");
    expect(sources).toContain("custom");
    // No duplicates
    expect(sources.length).toBe(new Set(sources).size);
  });

  test("replayed event appears as new pending event", () => {
    const event = makeEvent({ source: "replay-test", type: "push" });
    insertEvent(event);
    ackEvent(event.id);

    // Original should be processed
    const processedBefore = queryEvents({ status: "processed", limit: 100 });
    expect(processedBefore.find((e) => e.id === event.id)).toBeTruthy();

    // Replay it
    const original = findEvent(event.id)!;
    const newId = crypto.randomUUID();
    const replayed = {
      id: newId,
      source: original.source,
      type: original.type,
      timestamp: new Date().toISOString(),
      payload: original.payload,
      raw: original.raw,
    };
    insertEvent(replayed);

    // New event should be pending
    const pending = queryEvents({ status: "pending", limit: 100 });
    expect(pending.find((e) => e.id === newId)).toBeTruthy();

    // Original should still be processed
    const processedAfter = queryEvents({ status: "processed", limit: 100 });
    expect(processedAfter.find((e) => e.id === event.id)).toBeTruthy();
  });

  test("deleteProcessed removes processed events", () => {
    const e1 = makeEvent({ source: "cleanup-test" });
    const e2 = makeEvent({ source: "cleanup-test" });
    insertEvent(e1);
    insertEvent(e2);
    ackEvent(e1.id);
    ackEvent(e2.id);

    const deleted = deleteProcessed("cleanup-test");
    expect(deleted).toBe(2);

    const remaining = queryEvents({ source: "cleanup-test", status: "processed", limit: 100 });
    expect(remaining.length).toBe(0);
  });
});
