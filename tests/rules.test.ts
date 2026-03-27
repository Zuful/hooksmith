import { test, expect, describe } from "bun:test";
import { matchesRule, shouldAccept, type Rule } from "../src/rules";

describe("matchesRule", () => {
  test("rule with source and type matches exact event", () => {
    const rule: Rule = { source: "github", type: "push", action: "accept" };
    expect(matchesRule(rule, "github", "push")).toBe(true);
  });

  test("rule with source and type does not match different type", () => {
    const rule: Rule = { source: "github", type: "push", action: "accept" };
    expect(matchesRule(rule, "github", "pull_request")).toBe(false);
  });

  test("rule with only source matches any type", () => {
    const rule: Rule = { source: "github", action: "reject" };
    expect(matchesRule(rule, "github", "push")).toBe(true);
    expect(matchesRule(rule, "github", "issue")).toBe(true);
  });

  test("rule with only source does not match different source", () => {
    const rule: Rule = { source: "github", action: "reject" };
    expect(matchesRule(rule, "gitlab", "push")).toBe(false);
  });

  test("wildcard rule (no source or type) matches everything", () => {
    const rule: Rule = { action: "accept" };
    expect(matchesRule(rule, "github", "push")).toBe(true);
    expect(matchesRule(rule, "gitlab", "issue")).toBe(true);
  });
});

describe("shouldAccept", () => {
  test("no rules → accept all", () => {
    expect(shouldAccept([], "github", "push")).toBe(true);
    expect(shouldAccept([], "gitlab", "issue")).toBe(true);
  });

  test("exact source+type match accept", () => {
    const rules: Rule[] = [
      { source: "github", type: "push", action: "accept" },
    ];
    expect(shouldAccept(rules, "github", "push")).toBe(true);
  });

  test("exact source+type match reject", () => {
    const rules: Rule[] = [
      { source: "github", type: "push", action: "reject" },
    ];
    expect(shouldAccept(rules, "github", "push")).toBe(false);
  });

  test("source-only match (no type in rule)", () => {
    const rules: Rule[] = [{ source: "gitlab", action: "reject" }];
    expect(shouldAccept(rules, "gitlab", "push")).toBe(false);
    expect(shouldAccept(rules, "gitlab", "issue")).toBe(false);
    expect(shouldAccept(rules, "github", "push")).toBe(true); // different source, no match → default accept
  });

  test("wildcard catch-all rejects everything", () => {
    const rules: Rule[] = [{ action: "reject" }];
    expect(shouldAccept(rules, "github", "push")).toBe(false);
    expect(shouldAccept(rules, "gitlab", "issue")).toBe(false);
  });

  test("first-match wins (conflicting rules)", () => {
    const rules: Rule[] = [
      { source: "github", type: "push", action: "accept" },
      { source: "github", action: "reject" },
      { action: "accept" },
    ];
    // github+push matches first rule → accept
    expect(shouldAccept(rules, "github", "push")).toBe(true);
    // github+issue skips first rule, matches second → reject
    expect(shouldAccept(rules, "github", "issue")).toBe(false);
    // gitlab+push skips first two, matches third → accept
    expect(shouldAccept(rules, "gitlab", "push")).toBe(true);
  });
});
