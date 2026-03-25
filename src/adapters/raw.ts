import type { WebhookEvent } from "../types";

export function adaptRaw(source: string, _headers: Headers, body: unknown): WebhookEvent {
  return {
    id: crypto.randomUUID(),
    source,
    type: "webhook",
    timestamp: new Date().toISOString(),
    payload: (body && typeof body === "object" ? body : { data: body }) as Record<string, unknown>,
    raw: body,
  };
}
