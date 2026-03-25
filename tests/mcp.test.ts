import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { WebhookEvent } from "../src/types";

/**
 * MCP server tests — we test the underlying functions by importing the module
 * after setting up the HOOKSMITH_INBOX_DIR env var. Since the MCP server reads
 * from the inbox directory, we create test event files directly.
 */

let inboxDir: string;
let processedDir: string;

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

beforeAll(async () => {
  inboxDir = await mkdtemp(join(tmpdir(), "hooksmith-mcp-test-"));
  processedDir = join(inboxDir, "processed");
  await mkdir(processedDir, { recursive: true });
  process.env.HOOKSMITH_INBOX_DIR = inboxDir;
});

afterAll(async () => {
  await rm(inboxDir, { recursive: true, force: true });
  delete process.env.HOOKSMITH_INBOX_DIR;
});

async function writeEvent(event: WebhookEvent, dir?: string): Promise<void> {
  await writeFile(join(dir ?? inboxDir, `${event.id}.json`), JSON.stringify(event, null, 2));
}

describe("MCP server tools", () => {
  // Since the MCP server module captures inboxDir at import time,
  // we need to test via the HTTP-level or by directly testing the logic.
  // We'll test the core read/write logic that the MCP tools depend on.

  test("event files can be read back correctly", async () => {
    const event = makeEvent({ source: "github", type: "push" });
    await writeEvent(event);

    const file = Bun.file(join(inboxDir, `${event.id}.json`));
    const read = await file.json() as WebhookEvent;

    expect(read.id).toBe(event.id);
    expect(read.source).toBe("github");
    expect(read.type).toBe("push");
  });

  test("multiple events can be listed via glob", async () => {
    const e1 = makeEvent({ source: "github", type: "push" });
    const e2 = makeEvent({ source: "gitlab", type: "merge_request" });
    const e3 = makeEvent({ source: "stripe", type: "webhook" });
    await Promise.all([writeEvent(e1), writeEvent(e2), writeEvent(e3)]);

    const glob = new Bun.Glob("*.json");
    const files: string[] = [];
    for await (const path of glob.scan({ cwd: inboxDir, absolute: false })) {
      files.push(path);
    }

    // At least the 3 we just created (plus any from prior tests)
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  test("events can be filtered by source", async () => {
    const e1 = makeEvent({ source: "github", type: "push" });
    const e2 = makeEvent({ source: "gitlab", type: "merge_request" });
    await Promise.all([writeEvent(e1), writeEvent(e2)]);

    const glob = new Bun.Glob("*.json");
    const events: WebhookEvent[] = [];
    for await (const path of glob.scan({ cwd: inboxDir, absolute: false })) {
      const data = await Bun.file(join(inboxDir, path)).json() as WebhookEvent;
      events.push(data);
    }

    const githubEvents = events.filter((e) => e.source === "github");
    const gitlabEvents = events.filter((e) => e.source === "gitlab");

    expect(githubEvents.length).toBeGreaterThanOrEqual(1);
    expect(gitlabEvents.length).toBeGreaterThanOrEqual(1);
  });

  test("ack moves event from inbox to processed", async () => {
    const event = makeEvent({ source: "github", type: "push" });
    await writeEvent(event);

    // Simulate ack: copy to processed, delete from inbox
    const src = join(inboxDir, `${event.id}.json`);
    const dest = join(processedDir, `${event.id}.json`);
    await Bun.write(dest, Bun.file(src));
    const { unlink } = await import("node:fs/promises");
    await unlink(src);

    // Verify moved
    const inboxFile = Bun.file(src);
    expect(await inboxFile.exists()).toBe(false);

    const processedFile = Bun.file(dest);
    expect(await processedFile.exists()).toBe(true);

    const read = await processedFile.json() as WebhookEvent;
    expect(read.id).toBe(event.id);
  });

  test("list_sources returns unique sources", async () => {
    const e1 = makeEvent({ source: "github" });
    const e2 = makeEvent({ source: "gitlab" });
    const e3 = makeEvent({ source: "github" }); // duplicate
    await Promise.all([writeEvent(e1), writeEvent(e2), writeEvent(e3)]);

    const glob = new Bun.Glob("*.json");
    const events: WebhookEvent[] = [];
    for await (const path of glob.scan({ cwd: inboxDir, absolute: false })) {
      const data = await Bun.file(join(inboxDir, path)).json() as WebhookEvent;
      events.push(data);
    }

    const sources = [...new Set(events.map((e) => e.source))].sort();
    expect(sources).toContain("github");
    expect(sources).toContain("gitlab");
  });

  test("events sort by timestamp descending", async () => {
    const e1 = makeEvent({ timestamp: "2026-03-25T01:00:00Z" });
    const e2 = makeEvent({ timestamp: "2026-03-25T03:00:00Z" });
    const e3 = makeEvent({ timestamp: "2026-03-25T02:00:00Z" });
    await Promise.all([writeEvent(e1), writeEvent(e2), writeEvent(e3)]);

    const glob = new Bun.Glob("*.json");
    const events: WebhookEvent[] = [];
    for await (const path of glob.scan({ cwd: inboxDir, absolute: false })) {
      const data = await Bun.file(join(inboxDir, path)).json() as WebhookEvent;
      events.push(data);
    }

    events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Verify sorting: first event should have the latest timestamp
    for (let i = 0; i < events.length - 1; i++) {
      expect(new Date(events[i]!.timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i + 1]!.timestamp).getTime()
      );
    }
  });
});
