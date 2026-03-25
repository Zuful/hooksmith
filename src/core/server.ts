import { createHmac, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WebhookEvent } from "../types.js";

const DEFAULT_PORT = 3420;
const DEFAULT_INBOX_DIR = join(homedir(), ".hooksmith", "inbox");

function getInboxDir(): string {
  return process.env.HOOKSMITH_INBOX_DIR || DEFAULT_INBOX_DIR;
}

function verifyGitHubSignature(
  payload: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
  return signature === expected;
}

function verifyGitLabToken(
  token: string | null,
  secret: string,
): boolean {
  if (!token) return false;
  return token === secret;
}

async function validateSignature(
  source: string,
  rawBody: string,
  headers: Headers,
): Promise<{ valid: boolean; error?: string }> {
  switch (source) {
    case "github": {
      const secret = process.env.GITHUB_WEBHOOK_SECRET;
      if (!secret) return { valid: true }; // no secret configured, skip validation
      const sig = headers.get("x-hub-signature-256");
      if (!verifyGitHubSignature(rawBody, sig, secret)) {
        return { valid: false, error: "Invalid GitHub signature" };
      }
      return { valid: true };
    }
    case "gitlab": {
      const secret = process.env.GITLAB_WEBHOOK_SECRET;
      if (!secret) return { valid: true };
      const token = headers.get("x-gitlab-token");
      if (!verifyGitLabToken(token, secret)) {
        return { valid: false, error: "Invalid GitLab token" };
      }
      return { valid: true };
    }
    default:
      return { valid: true };
  }
}

async function normalizeEvent(
  source: string,
  payload: Record<string, unknown>,
  headers: Headers,
): Promise<WebhookEvent> {
  // Try to use adapter registry if available
  try {
    const adapters = await import("../adapters/index.js");
    if (adapters.normalize) {
      return adapters.normalize(source, payload, headers);
    }
  } catch {
    // Adapter registry not available yet, use default normalization
  }

  return {
    id: randomUUID(),
    source,
    type: inferEventType(source, payload, headers),
    timestamp: new Date().toISOString(),
    payload,
    raw: payload,
  };
}

function inferEventType(
  source: string,
  payload: Record<string, unknown>,
  headers: Headers,
): string {
  if (source === "github") {
    return (headers.get("x-github-event") as string) || "unknown";
  }
  if (source === "gitlab") {
    return (payload.object_kind as string) || (headers.get("x-gitlab-event") as string) || "unknown";
  }
  return (payload.type as string) || "unknown";
}

async function saveEvent(event: WebhookEvent): Promise<void> {
  const inboxDir = getInboxDir();
  await mkdir(inboxDir, { recursive: true });
  const filePath = join(inboxDir, `${event.id}.json`);
  await Bun.write(filePath, JSON.stringify(event, null, 2));
}

async function handleWebhook(req: Request, source: string): Promise<Response> {
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return Response.json({ ok: false, error: "Failed to read body" }, { status: 400 });
  }

  // Validate signature
  const { valid, error } = await validateSignature(source, rawBody, req.headers);
  if (!valid) {
    return Response.json({ ok: false, error }, { status: 400 });
  }

  // Parse JSON
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Normalize and save
  try {
    const event = await normalizeEvent(source, payload, req.headers);
    await saveEvent(event);
    return Response.json({ ok: true, id: event.id });
  } catch (err) {
    console.error("Error processing webhook:", err);
    return Response.json({ ok: false, error: "Internal server error" }, { status: 500 });
  }
}

export function startServer(port?: number): ReturnType<typeof Bun.serve> {
  const listenPort = port ?? (Number(process.env.PORT) || DEFAULT_PORT);

  const server = Bun.serve({
    port: listenPort,
    async fetch(req) {
      const url = new URL(req.url);
      const match = url.pathname.match(/^\/webhook\/([a-zA-Z0-9_-]+)$/);

      if (req.method === "POST" && match) {
        const source = match[1]!;
        return handleWebhook(req, source);
      }

      if (url.pathname === "/health") {
        return Response.json({ status: "ok" });
      }

      return Response.json({ error: "Not found" }, { status: 404 });
    },
  });

  console.log(`Hooksmith server listening on port ${server.port}`);
  return server;
}

export { handleWebhook, validateSignature, saveEvent, normalizeEvent };
