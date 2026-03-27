import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { startServer } from "../src/core/server";
import { resetDb } from "../src/db";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import githubPush from "./fixtures/github-push.json";
import gitlabMR from "./fixtures/gitlab-mr.json";

let server: ReturnType<typeof startServer>;
let testDbPath: string;

beforeAll(() => {
  testDbPath = join(tmpdir(), `hooksmith-test-${Date.now()}.db`);
  process.env.HOOKSMITH_DB_PATH = testDbPath;
  server = startServer(0); // port 0 = random available port
});

afterAll(async () => {
  server.stop();
  resetDb();
  await rm(testDbPath, { force: true });
  delete process.env.HOOKSMITH_DB_PATH;
});

function url(path: string): string {
  return `http://localhost:${server.port}${path}`;
}

describe("Webhook server", () => {
  test("GET /health returns ok", async () => {
    const res = await fetch(url("/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
  });

  test("GET /unknown returns 404", async () => {
    const res = await fetch(url("/unknown"));
    expect(res.status).toBe(404);
  });

  test("POST /webhook/github stores a GitHub push event", async () => {
    const res = await fetch(url("/webhook/github"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "push",
        "x-github-delivery": "test-delivery-001",
      },
      body: JSON.stringify(githubPush),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();

    // Verify the event was stored in the DB
    const { findEvent } = await import("../src/db");
    const event = findEvent(body.id);
    expect(event).toBeTruthy();
    expect(event!.source).toBe("github");
    expect(event!.type).toBe("push");
    expect(event!.raw).toBeDefined();
  });

  test("POST /webhook/gitlab stores a GitLab MR event", async () => {
    const res = await fetch(url("/webhook/gitlab"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-gitlab-event": "Merge Request Hook",
      },
      body: JSON.stringify(gitlabMR),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.id).toBeTruthy();
  });

  test("POST /webhook/custom stores a raw event", async () => {
    const res = await fetch(url("/webhook/custom"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "test", data: 42 }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  test("POST with invalid JSON returns 400", async () => {
    const res = await fetch(url("/webhook/github"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Invalid JSON");
  });

  test("POST to non-webhook path returns 404", async () => {
    const res = await fetch(url("/other"), {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("multiple events accumulate in the DB", async () => {
    const { queryEvents } = await import("../src/db");
    const before = queryEvents({ source: "github", limit: 100 }).length;

    await fetch(url("/webhook/github"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "ping",
        "x-github-delivery": "ping-001",
      },
      body: JSON.stringify({}),
    });

    await fetch(url("/webhook/github"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "ping",
        "x-github-delivery": "ping-002",
      },
      body: JSON.stringify({}),
    });

    const after = queryEvents({ source: "github", limit: 100 }).length;
    expect(after).toBe(before + 2);
  });
});
