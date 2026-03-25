import { test, expect, describe, afterAll, beforeAll } from "bun:test";
import { startServer } from "../src/core/server";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import githubPush from "./fixtures/github-push.json";
import gitlabMR from "./fixtures/gitlab-mr.json";

let server: ReturnType<typeof startServer>;
let inboxDir: string;

beforeAll(async () => {
  inboxDir = await mkdtemp(join(tmpdir(), "hooksmith-test-"));
  process.env.HOOKSMITH_INBOX_DIR = inboxDir;
  server = startServer(0); // port 0 = random available port
});

afterAll(async () => {
  server.stop();
  await rm(inboxDir, { recursive: true, force: true });
  delete process.env.HOOKSMITH_INBOX_DIR;
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

    // Verify event file was created in inbox
    const files = await readdir(inboxDir);
    const eventFile = files.find((f) => f.endsWith(".json"));
    expect(eventFile).toBeTruthy();

    const eventData = JSON.parse(await readFile(join(inboxDir, eventFile!), "utf-8"));
    expect(eventData.source).toBe("github");
    expect(eventData.type).toBe("push");
    expect(eventData.raw).toBeDefined();
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

  test("multiple events accumulate in inbox", async () => {
    // Clear inbox for counting
    const existingFiles = await readdir(inboxDir);
    const initialCount = existingFiles.filter((f) => f.endsWith(".json")).length;

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

    const files = await readdir(inboxDir);
    const newCount = files.filter((f) => f.endsWith(".json")).length;
    expect(newCount).toBe(initialCount + 2);
  });
});
