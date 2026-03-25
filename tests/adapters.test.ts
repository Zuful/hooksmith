import { test, expect, describe } from "bun:test";
import { adaptGitHub } from "../src/adapters/github";
import { adaptGitLab } from "../src/adapters/gitlab";
import { adaptRaw } from "../src/adapters/raw";
import { getAdapter, normalize } from "../src/adapters/index";
import githubPush from "./fixtures/github-push.json";
import gitlabMR from "./fixtures/gitlab-mr.json";

describe("GitHub adapter", () => {
  test("parses a push event", () => {
    const headers = new Headers({
      "x-github-event": "push",
      "x-github-delivery": "delivery-123",
    });

    const event = adaptGitHub(headers, githubPush);

    expect(event.id).toBe("delivery-123");
    expect(event.source).toBe("github");
    expect(event.type).toBe("push");
    expect(event.payload.ref).toBe("refs/heads/main");
    expect(event.payload.repo).toBeDefined();
    expect((event.payload.repo as Record<string, unknown>).full_name).toBe("acme/hooksmith");
    expect(event.payload.sender).toBeDefined();
    expect(event.raw).toEqual(githubPush);
    expect(event.timestamp).toBeTruthy();
  });

  test("uses action in type when present", () => {
    const headers = new Headers({
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-456",
    });
    const body = { action: "opened", repository: { name: "test" }, sender: { login: "user" } };
    const event = adaptGitHub(headers, body);

    expect(event.type).toBe("pull_request.opened");
    expect(event.payload.action).toBe("opened");
  });

  test("falls back to crypto.randomUUID when no delivery header", () => {
    const headers = new Headers({ "x-github-event": "ping" });
    const event = adaptGitHub(headers, {});

    expect(event.id).toBeTruthy();
    expect(event.id.length).toBeGreaterThan(0);
    expect(event.type).toBe("ping");
  });
});

describe("GitLab adapter", () => {
  test("parses a merge request event", () => {
    const headers = new Headers({
      "x-gitlab-event": "Merge Request Hook",
    });

    const event = adaptGitLab(headers, gitlabMR);

    expect(event.source).toBe("gitlab");
    expect(event.type).toBe("merge_request");
    expect(event.payload.action).toBe("open");
    expect(event.payload.project).toBeDefined();
    expect((event.payload.project as Record<string, unknown>).name).toBe("hooksmith");
    expect(event.payload.user).toBeDefined();
    expect(event.payload.ref).toBe("refs/merge-requests/7/head");
    expect(event.raw).toEqual(gitlabMR);
    expect(event.id).toBeTruthy();
  });

  test("maps known GitLab event types", () => {
    const knownEvents: Record<string, string> = {
      "Push Hook": "push",
      "Tag Push Hook": "tag_push",
      "Issue Hook": "issue",
      "Pipeline Hook": "pipeline",
    };

    for (const [header, expected] of Object.entries(knownEvents)) {
      const headers = new Headers({ "x-gitlab-event": header });
      const event = adaptGitLab(headers, {});
      expect(event.type).toBe(expected);
    }
  });

  test("falls back for unknown GitLab event types", () => {
    const headers = new Headers({ "x-gitlab-event": "Custom Hook" });
    const event = adaptGitLab(headers, {});
    expect(event.type).toBe("custom");
  });
});

describe("Raw adapter", () => {
  test("wraps object body as payload", () => {
    const headers = new Headers();
    const body = { key: "value", nested: { a: 1 } };
    const event = adaptRaw("stripe", headers, body);

    expect(event.source).toBe("stripe");
    expect(event.type).toBe("webhook");
    expect(event.payload).toEqual(body);
    expect(event.raw).toEqual(body);
    expect(event.id).toBeTruthy();
  });

  test("wraps non-object body in data field", () => {
    const headers = new Headers();
    const event = adaptRaw("custom", headers, "plain text");

    expect(event.payload).toEqual({ data: "plain text" });
    expect(event.raw).toBe("plain text");
  });
});

describe("Adapter registry", () => {
  test("getAdapter returns GitHub adapter for 'github'", () => {
    const adapter = getAdapter("github");
    const headers = new Headers({ "x-github-event": "push" });
    const event = adapter(headers, {});
    expect(event.source).toBe("github");
  });

  test("getAdapter returns GitLab adapter for 'gitlab'", () => {
    const adapter = getAdapter("gitlab");
    const headers = new Headers({ "x-gitlab-event": "Push Hook" });
    const event = adapter(headers, {});
    expect(event.source).toBe("gitlab");
  });

  test("getAdapter returns raw adapter for unknown sources", () => {
    const adapter = getAdapter("stripe");
    const headers = new Headers();
    const event = adapter(headers, { type: "charge.created" });
    expect(event.source).toBe("stripe");
    expect(event.type).toBe("webhook");
  });

  test("normalize delegates to the correct adapter", () => {
    const headers = new Headers({ "x-github-event": "push", "x-github-delivery": "norm-1" });
    const event = normalize("github", githubPush as Record<string, unknown>, headers);
    expect(event.source).toBe("github");
    expect(event.type).toBe("push");
    expect(event.id).toBe("norm-1");
  });
});
