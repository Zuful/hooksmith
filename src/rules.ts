import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type Rule = {
  source?: string;
  type?: string;
  action: "accept" | "reject";
};

export function loadRules(): Rule[] {
  const rulesPath =
    process.env.HOOKSMITH_RULES_PATH ||
    join(homedir(), ".hooksmith", "rules.json");

  try {
    if (!existsSync(rulesPath)) return [];
    const file = Bun.file(rulesPath);
    // Use synchronous read
    const content = require("node:fs").readFileSync(rulesPath, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function matchesRule(rule: Rule, source: string, type: string): boolean {
  if (rule.source !== undefined && rule.source !== source) return false;
  if (rule.type !== undefined && rule.type !== type) return false;
  return true;
}

export function shouldAccept(
  rules: Rule[],
  source: string,
  type: string,
): boolean {
  for (const rule of rules) {
    if (matchesRule(rule, source, type)) {
      return rule.action === "accept";
    }
  }
  return true; // default accept
}
