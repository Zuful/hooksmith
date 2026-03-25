import type { WebhookEvent } from "../types";

const EVENT_MAP: Record<string, string> = {
  "Push Hook": "push",
  "Tag Push Hook": "tag_push",
  "Merge Request Hook": "merge_request",
  "Issue Hook": "issue",
  "Note Hook": "note",
  "Pipeline Hook": "pipeline",
  "Job Hook": "job",
  "Wiki Page Hook": "wiki_page",
  "Deployment Hook": "deployment",
  "Release Hook": "release",
};

export function adaptGitLab(headers: Headers, body: unknown): WebhookEvent {
  const gitlabEvent = headers.get("x-gitlab-event") ?? "unknown";
  const type = EVENT_MAP[gitlabEvent] ?? gitlabEvent.toLowerCase().replace(/\s+hook$/, "").replace(/\s+/g, "_");
  const payload = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const action = payload.object_attributes
    ? ((payload.object_attributes as Record<string, unknown>).action as string | undefined)
    : undefined;
  const project = payload.project as Record<string, unknown> | undefined;
  const user = payload.user as Record<string, unknown> | undefined;
  const ref = payload.ref as string | undefined;

  return {
    id: crypto.randomUUID(),
    source: "gitlab",
    type,
    timestamp: new Date().toISOString(),
    payload: { action, project, user, ref },
    raw: body,
  };
}
