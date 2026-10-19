// models.json is the T3 model policy every stamped Models section,
// interrogate's reviewer table, and setup-pstack's sheet block derive from.
// parseModels checks its shape when the generator loads it, and a role label
// is the runtime join key between the sheet the user writes and the prose that
// tells the agent which role to look up.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import * as sheet from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { t3Regions } from "../tools/derive-t3.mjs";
import { loadModels, parseModels } from "../tools/generate.mjs";
import { markdownFiles } from "../tools/validate-skills.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(repoRoot, "plugins/pstack/skills");
const raw = JSON.parse(readFileSync(join(repoRoot, "plugins/pstack/models.json"), "utf8"));
const models = loadModels();

describe("committed models.json", () => {
  test("the file stays one row per role so a role change is a one-line diff", () => {
    const text = readFileSync(join(repoRoot, "plugins/pstack/models.json"), "utf8");
    expect(text.match(/^\s*\{ "role"/gm)).toHaveLength(raw.roles.length);
  });

  test("a released sheet's strongest judgment line still names the hardest tasks role", () => {
    expect(raw.roles.find((r) => r.alias === "strongest judgment")?.role).toBe("hardest tasks");
  });

  test("the domain policy promises 19 roles and eight tiers", () => {
    expect(Object.keys(models.domains)).toEqual(["general", "science"]);
    expect(models.roles).toHaveLength(19);
    expect(Object.keys(models.domains.general.tiers)).toEqual(["code", "explore", "judgment", "mechanical", "final", "runners", "judges", "reviewers"]);
    expect(Object.keys(models.domains.science.tiers)).toEqual(["code", "explore", "judgment", "mechanical", "final", "runners", "judges", "reviewers"]);
  });

  test("science workers and research delegates promise Grok defaults", () => {
    const science = sheet.seats(models).filter((s) => s.domain === "science" && !s.panel);
    expect(science.map((s) => [s.role, s.defaults[0].entry])).toEqual([
      ["feature, refactoring", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["bug-fix", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["perf-issue", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["hillclimb", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["judgment and prose", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["hardest tasks", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["mechanical code", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["final review", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["how explorer", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["how explainer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["why investigators", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["why synthesizer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["reflect tooling", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
      ["reflect judgment, divergent, synthesizer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["swarm workers", "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false"],
    ]);
    expect(models.roles.filter((r) => r.tier === "explore").map((r) => r.role)).toEqual([
      "how explorer", "why investigators", "reflect tooling",
    ]);
  });

  test("mechanical code and final review promise the same defaults in both columns", () => {
    expect(sheet.seats(models).filter((s) => ["mechanical code", "final review"].includes(s.role)).map((s) => [s.key, s.defaults])).toEqual([
      ["mechanical code", [{ entry: "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false", termFree: false }]],
      ["final review", [{ entry: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default", termFree: false }]],
      ["science mechanical code", [{ entry: "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false", termFree: false }]],
      ["science final review", [{ entry: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default", termFree: false }]],
    ]);
    expect(models.roles.slice(6, 8)).toEqual([
      { role: "mechanical code", tier: "mechanical", skill: "poteto-mode" },
      { role: "final review", tier: "final", skill: "poteto-mode" },
    ]);
    expect(models.roles.map((r) => r.role)).not.toContain("term-free code");
  });

  test("only science panel defaults outside its term readers need term-free briefs", () => {
    expect(sheet.seats(models).flatMap((s) => s.defaults.filter((d) => d.termFree).map((d) => `${s.key}: ${d.entry}`))).toEqual([
      "science arena runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science arena cross-judge pool: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science architect runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science interrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
    ]);
  });

  test("every default promises xhigh and explicit standard speed", () => {
    expect([...new Set(sheet.seats(models).flatMap((s) => s.defaults.map((d) => d.entry)))].sort()).toEqual([
      "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default",
      "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
      "cursor/grok-4.7 reasoning_effort=xhigh fastMode=false",
    ]);
  });

});

describe("parseModels", () => {
  const fixture = {
    domains: {
      general: { tiers: { code: "cursor/grok-4.7 fastMode=false", judgment: "claudeAgent/claude-opus-5-5 fastMode=false", runners: ["a/claude-a", "b/gpt-b"] } },
      science: { covers: "scientific work", termReaders: ["gpt", "grok"], tiers: { code: "codex/gpt-6.1-sol serviceTier=default", judgment: "codex/gpt-6-astra serviceTier=default", runners: ["a/claude-a", "b/gpt-b"] } },
    },
    roles: [{ role: "bug-fix", tier: "code", skill: "poteto-mode" }, { role: "hardest tasks", alias: "strongest judgment", tier: "judgment", skill: "poteto-mode" }, { role: "why investigators", tier: "code", skill: "why" }],
  };
  const parse = (mutate, skillExists = () => true) => {
    const policy = structuredClone(fixture);
    mutate(policy);
    return () => parseModels(policy, skillExists);
  };

  test("accepts the domain policy unchanged, including an absent seat written null", () => {
    const policy = structuredClone(fixture);
    policy.domains.science.tiers.judgment = null;
    expect(parseModels(policy, () => true)).toBe(policy);
  });

  test.each([
    ["missing science", (p) => delete p.domains.science],
    ["wrong order", (p) => p.domains = { science: p.domains.science, general: p.domains.general }],
    ["extra domain", (p) => p.domains.law = p.domains.science],
    ["no domains", (p) => delete p.domains],
    ["joined domain names", (p) => p.domains = { "general,science": p.domains.general }],
  ])("requires general then science, %s", (_, mutate) => {
    expect(parse(mutate)).toThrow('models.json: "domains" must hold "general" then "science"');
  });

  test("science requires its covers and term readers", () => {
    expect(parse((p) => delete p.domains.science.covers)).toThrow('models.json: domain "science" needs "covers", the task class the gate routes to it');
    expect(parse((p) => delete p.domains.science.termReaders)).toThrow('models.json: domain "science" needs "termReaders", the families that may read its terms');
  });

  test.each([[[]], [["gpt", "gpt"]], [["GPT"]], ["gpt"]])("rejects invalid term readers %j", (value) => {
    expect(parse((p) => p.domains.science.termReaders = value)).toThrow('models.json: domain "science" needs "termReaders", the families that may read its terms');
  });

  test("rejects unknown domain fields and a term rule on general", () => {
    expect(parse((p) => p.domains.science.extra = true)).toThrow('models.json: domain "science" has unknown field "extra"');
    expect(parse((p) => p.domains.general.termReaders = ["gpt"])).toThrow('models.json: domain "general" takes no termReaders; unprefixed v2 sheet lines set it, and they had no term rule');
    expect(parse((p) => p.domains.general.covers = "everything")).toThrow('models.json: domain "general" takes no covers; unprefixed v2 sheet lines set it, and they had no term rule');
  });

  test("malformed policy containers keep their boundary diagnostics", () => {
    expect(parse((p) => p.roles = {})).toThrow('models.json: "roles" must be a list');
    expect(parse((p) => p.domains.science = null)).toThrow('models.json: domain "science" must be an object');
    expect(parse((p) => p.domains.general.tiers = {})).toThrow('models.json: domain "general" needs a non-empty "tiers" object');
    expect(parse((p) => p.domains.science.tiers.code = 7)).toThrow('models.json: domain "science" tier "code" must be one entry, a list, or null');
  });

  test("every column names every tier", () => {
    expect(parse((p) => delete p.domains.science.tiers.code)).toThrow('models.json: domain "science" has no tier "code"; write null if it has no such seat');
    expect(parse((p) => p.domains.science.tiers.extra = "b/gpt-b")).toThrow('models.json: domain "science" names tier "extra", which "general" does not');
  });

  test("tier shapes agree across columns and at least one seat exists", () => {
    expect(parse((p) => p.domains.science.tiers.runners = "b/gpt-b")).toThrow('models.json: tier "runners" is a list in "general" but one entry in "science"');
    expect(parse((p) => { p.domains.general.tiers.code = null; p.domains.science.tiers.code = null; })).toThrow('models.json: tier "code" has no seat in any domain');
  });

  test("entries name concrete, single-spaced targets", () => {
    expect(parse((p) => p.domains.general.tiers.code = "opus")).toThrow('models.json: domain "general" tier "code": "opus" does not start with <providerInstanceId>/<modelId>');
    expect(parse((p) => p.domains.science.tiers.code = "inherit-parent")).toThrow('models.json: domain "science" tier "code" must name a target, not inherit the parent');
    expect(parse((p) => p.domains.general.tiers.code = "b/gpt-b  effort=xhigh")).toThrow('models.json: domain "general" tier "code": "b/gpt-b  effort=xhigh" is not one entry written with single spaces');
  });

  test("a default with nonstandard speed fails", () => {
    expect(parse((p) => p.domains.science.tiers.code = "codex/gpt-6.1-sol serviceTier=priority")).toThrow('models.json: domain "science" tier "code": serviceTier=priority is not standard speed, and this router never runs fast; write serviceTier=default');
  });

  test("a panel spans two families without repeating entries", () => {
    expect(parse((p) => p.domains.science.tiers.runners = ["a/gpt-a", "b/gpt-b"])).toThrow('models.json: domain "science" tier "runners": the panel needs at least two model families');
    expect(parse((p) => p.domains.science.tiers.runners = ["a/gpt-a", "a/gpt-a"])).toThrow('models.json: domain "science" tier "runners" lists an entry twice');
  });

  test("role labels and aliases are unique and unambiguous sheet keys", () => {
    expect(parse((p) => p.roles.push({ ...p.roles[0] }))).toThrow('models.json: role "bug-fix" appears twice');
    expect(parse((p) => p.roles[0].alias = "strongest judgment")).toThrow('models.json: role "strongest judgment" appears twice');
    expect(parse((p) => p.roles[0].role = "session hook")).toThrow('models.json: role "session hook" is a reserved sheet key');
    expect(parse((p) => p.roles[0].alias = "science notes")).toThrow('models.json: role "science notes" starts with the domain name "science", so its sheet line would be ambiguous');
  });

  test("roles name a defined tier and an existing skill", () => {
    expect(parse((p) => p.roles[0].tier = "strongest")).toThrow('models.json: role "bug-fix" names tier "strongest", which no domain defines');
    expect(parse(() => {}, (skill) => skill !== "why")).toThrow('models.json: role "why investigators" names skill "why", which has no SKILL.md');
  });

});

describe("role labels reach the prose", () => {
  // The prose may hyphenate a label ("how-explorer" for the sheet's
  // "how explorer") and names only the first segment of a comma-joined label.
  const normalize = (text) => text.toLowerCase().replace(/[-\s]+/g, " ");

  function skillProse(skill) {
    return markdownFiles(join(skillsDir, skill))
      .map((file) => {
        const lines = readFileSync(file, "utf8").split("\n");
        const owned = t3Regions(models)
          .filter((r) => r.file === relative(repoRoot, file))
          .map((r) => r.locate(lines))
          .filter(Boolean);
        return lines.filter((_, i) => !owned.some(([s, e]) => i >= s && i < e)).join("\n");
      })
      .join("\n");
  }

  for (const role of models.roles) {
    test(`"${role.role}" is named by the ${role.skill} skill outside its stamped regions`, () => {
      const needle = normalize(role.role.split(",")[0]);
      expect(normalize(skillProse(role.skill))).toContain(needle);
    });
  }
});
