import type { WebhookEvent } from "../types";

export function adaptGitHub(headers: Headers, body: unknown): WebhookEvent {
  const event = headers.get("x-github-event") ?? "unknown";
  const deliveryId = headers.get("x-github-delivery") ?? crypto.randomUUID();
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const action = payload.action as string | undefined;
  const type = action ? `${event}.${action}` : event;

  const repo = payload.repository as Record<string, unknown> | undefined;
  const sender = payload.sender as Record<string, unknown> | undefined;
  const ref = payload.ref as string | undefined;

  return {
    id: deliveryId,
    source: "github",
    type,
    timestamp: new Date().toISOString(),
    payload: { action, repo, sender, ref },
    raw: body,
  };
}
