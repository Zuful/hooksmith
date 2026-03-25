import type { WebhookEvent } from "../types";
import { adaptGitHub } from "./github";
import { adaptGitLab } from "./gitlab";
import { adaptRaw } from "./raw";

export type AdapterFn = (headers: Headers, body: unknown) => WebhookEvent;

export function getAdapter(source: string): AdapterFn {
  switch (source) {
    case "github":
      return adaptGitHub;
    case "gitlab":
      return adaptGitLab;
    default:
      return (headers, body) => adaptRaw(source, headers, body);
  }
}

/** Called by core/server.ts normalizeEvent */
export function normalize(
  source: string,
  payload: Record<string, unknown>,
  headers: Headers,
): WebhookEvent {
  const adapter = getAdapter(source);
  return adapter(headers, payload);
}

export { adaptGitHub, adaptGitLab, adaptRaw };
