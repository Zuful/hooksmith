export interface WebhookEvent {
  id: string;          // UUID
  source: string;      // e.g. "github", "gitlab", "stripe"
  type: string;        // e.g. "push", "pull_request.opened"
  timestamp: string;   // ISO 8601
  payload: Record<string, unknown>;  // normalized, source-specific fields
  raw: unknown;        // original payload as-is
}
