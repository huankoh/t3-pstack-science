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

  test("the domain policy promises 19 roles and ten tiers", () => {
    expect(Object.keys(models.domains)).toEqual(["general", "science"]);
    expect(models.roles).toHaveLength(19);
    expect(Object.keys(models.domains.general.tiers)).toEqual(["code", "explore", "judgment", "prose", "mechanical", "final", "runners", "designers", "judges", "reviewers"]);
    expect(Object.keys(models.domains.science.tiers)).toEqual(["code", "explore", "judgment", "prose", "mechanical", "final", "runners", "designers", "judges", "reviewers"]);
  });

  test("science code uses Sol and research delegates use DeepSeek", () => {
    const science = sheet.seats(models).filter((s) => s.domain === "science" && !s.panel);
    expect(science.map((s) => [s.role, s.defaults[0].entry])).toEqual([
      ["feature, refactoring", "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default"],
      ["bug-fix", "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default"],
      ["perf-issue", "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default"],
      ["hillclimb", "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default"],
      ["judgment and prose", "muse/muse-wonder-full-1.0 reasoningEffort=high"],
      ["hardest tasks", "codex/gpt-6-astra reasoningEffort=high serviceTier=default"],
      ["mechanical code", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["final review", "codex/gpt-6-astra reasoningEffort=high serviceTier=default"],
      ["how explorer", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["how explainer", "muse/muse-wonder-full-1.0 reasoningEffort=high"],
      ["why investigators", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["why synthesizer", "muse/muse-wonder-full-1.0 reasoningEffort=high"],
      ["reflect tooling", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["reflect judgment, divergent, synthesizer", "codex/gpt-6-astra reasoningEffort=high serviceTier=default"],
      ["swarm workers", "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default"],
    ]);
    expect(models.roles.filter((r) => r.tier === "explore").map((r) => r.role)).toEqual([
      "how explorer", "why investigators", "reflect tooling",
    ]);
  });

  test("mechanical code promises its column default and final review promises the same default in both columns", () => {
    expect(sheet.seats(models).filter((s) => ["mechanical code", "final review"].includes(s.role)).map((s) => [s.key, s.defaults])).toEqual([
      ["mechanical code", [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }]],
      ["final review", [{ entry: "codex/gpt-6-astra reasoningEffort=high serviceTier=default", termFree: false }]],
      ["science mechanical code", [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }]],
      ["science final review", [{ entry: "codex/gpt-6-astra reasoningEffort=high serviceTier=default", termFree: false }]],
    ]);
    expect(["mechanical code", "final review"].map((role) => models.roles.find((r) => r.role === role))).toEqual([
      { role: "mechanical code", tier: "mechanical", skill: "poteto-mode" },
      { role: "final review", tier: "final", skill: "poteto-mode" },
    ]);
    expect(models.roles.map((r) => r.role)).not.toContain("term-free code");
  });

  const family = (entry) => sheet.family(sheet.parseEntry(entry).model);
  const independentReviewer = (column, authors) => ["interrogate reviewers", "arena cross-judge pool"]
    .flatMap((role) => column.find((seat) => seat.role === role).defaults)
    .find((entry) => !authors.has(family(entry.entry))) ?? "BLOCKED: independent review";

  test.each([
    [["feature, refactoring"], ["gpt"], { entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }],
    [["feature, refactoring", "hardest tasks"], ["gpt"], { entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }],
    [["mechanical code"], ["deepseek"], null],
    [["feature, refactoring", "mechanical code"], ["deepseek", "gpt"], { entry: "muse/muse-wonder-full-1.0 reasoningEffort=high", termFree: false }],
  ])("both columns select the handback reviewer for authors %j", (roles, expectedFamilies, expectedExtra) => {
    for (const domain of sheet.DOMAINS) {
      const column = sheet.seats(models).filter((seat) => seat.domain === domain);
      const authors = new Set(roles.map((role) => family(column.find((seat) => seat.role === role).defaults[0].entry)));
      expect([...authors].sort()).toEqual(expectedFamilies);
      const final = column.find((seat) => seat.role === "final review").defaults[0];
      expect(final).toEqual({ entry: "codex/gpt-6-astra reasoningEffort=high serviceTier=default", termFree: false });
      const extra = authors.has(family(final.entry)) ? independentReviewer(column, authors) : null;
      expect(extra).toEqual(expectedExtra);
      expect(independentReviewer(column, authors)).toEqual(expectedExtra ?? {
        entry: "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default", termFree: false,
      });
    }
  });

  test.each(sheet.DOMAINS)("the %s judges pool preserves family exclusion and term-free briefs before blocking", (domain) => {
    const column = sheet.seats(models).filter((seat) => seat.domain === domain);
    expect(independentReviewer(column, new Set(["gpt", "deepseek", "muse"]))).toEqual({
      entry: "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", termFree: domain === "science",
    });
    const authors = new Set(column.flatMap((seat) => seat.defaults.map((entry) => family(entry.entry))));
    expect(independentReviewer(column, authors)).toBe("BLOCKED: independent review");
  });

  test("only science panel defaults outside its term readers need term-free briefs", () => {
    expect(sheet.seats(models).flatMap((s) => s.defaults.filter((d) => d.termFree).map((d) => `${s.key}: ${d.entry}`))).toEqual([
      "science arena runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science arena cross-judge pool: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science architect runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
    ]);
  });

  test("every default promises its pinned entry, with explicit standard speed where the provider lists a speed option", () => {
    expect([...new Set(sheet.seats(models).flatMap((s) => s.defaults.map((d) => d.entry)))].sort()).toEqual([
      "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "codex/gpt-6-astra reasoningEffort=high serviceTier=default",
      "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
      "muse/muse-wonder-full-1.0 reasoningEffort=high",
      "opencode/opencode-go/deepseek-v4.1-flash variant=max",
    ]);
  });

  test("every DeepSeek entry is variant=max with no speed option", () => {
    const tierEntries = Object.values(raw.domains).flatMap((domain) => Object.values(domain.tiers).flat());
    const deepseek = tierEntries.filter((e) => sheet.family(sheet.parseEntry(e).model) === "deepseek");
    expect(deepseek).toHaveLength(6);
    for (const entry of deepseek) {
      expect(entry).toBe("opencode/opencode-go/deepseek-v4.1-flash variant=max");
      expect(sheet.parseEntry(entry).options).toEqual({ variant: "max" });
    }
    expect(raw.domains.science.termReaders).toEqual(["gpt", "muse", "deepseek"]);
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
    expect(parse((p) => p.roles[0].role = "muse bug-fix")).toThrow('models.json: role "muse bug-fix" starts with the reserved prefix "muse "');
    expect(parse((p) => p.roles[0].alias = "muse notes")).toThrow('models.json: role "muse notes" starts with the reserved prefix "muse "');
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
