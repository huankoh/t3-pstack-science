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

  test("science workers and research delegates promise DeepSeek defaults", () => {
    const science = sheet.seats(models).filter((s) => s.domain === "science" && !s.panel);
    expect(science.map((s) => [s.role, s.defaults[0].entry])).toEqual([
      ["feature, refactoring", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["bug-fix", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["perf-issue", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["hillclimb", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["judgment and prose", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["hardest tasks", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["mechanical code", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["final review", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["how explorer", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["how explainer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["why investigators", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["why synthesizer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["reflect tooling", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      ["reflect judgment, divergent, synthesizer", "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default"],
      ["swarm workers", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
    ]);
    expect(models.roles.filter((r) => r.tier === "explore").map((r) => r.role)).toEqual([
      "how explorer", "why investigators", "reflect tooling",
    ]);
  });

  test("mechanical code promises its column default and final review promises the same default in both columns", () => {
    expect(sheet.seats(models).filter((s) => ["mechanical code", "final review"].includes(s.role)).map((s) => [s.key, s.defaults])).toEqual([
      ["mechanical code", [{ entry: "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", termFree: false }]],
      ["final review", [{ entry: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default", termFree: false }]],
      ["science mechanical code", [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }]],
      ["science final review", [{ entry: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default", termFree: false }]],
    ]);
    expect(["mechanical code", "final review"].map((role) => models.roles.find((r) => r.role === role))).toEqual([
      { role: "mechanical code", tier: "mechanical", skill: "poteto-mode" },
      { role: "final review", tier: "final", skill: "poteto-mode" },
    ]);
    expect(models.roles.map((r) => r.role)).not.toContain("term-free code");
  });

  test.each([
    [["feature, refactoring"], ["deepseek"], null],
    [["feature, refactoring", "hardest tasks"], ["deepseek", "gpt"], {
      entry: "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", termFree: true,
    }],
  ])("science handback selects an independent reviewer for authors %j", (roles, expectedFamilies, expectedExtra) => {
    const family = (entry) => sheet.family(sheet.parseEntry(entry).model);
    const science = sheet.seats(models).filter((s) => s.domain === "science");
    const authors = new Set(roles.map((role) => family(science.find((s) => s.role === role).defaults[0].entry)));
    expect([...authors].sort()).toEqual(expectedFamilies);
    const final = science.find((s) => s.role === "final review").defaults[0];
    expect(final).toEqual({ entry: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default", termFree: false });
    const extra = authors.has(family(final.entry))
      ? science.find((s) => s.role === "interrogate reviewers").defaults.find((d) => !authors.has(family(d.entry)))
      : null;
    expect(extra).toEqual(expectedExtra);
  });

  test("only science panel defaults outside its term readers need term-free briefs", () => {
    expect(sheet.seats(models).flatMap((s) => s.defaults.filter((d) => d.termFree).map((d) => `${s.key}: ${d.entry}`))).toEqual([
      "science arena runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science arena cross-judge pool: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science architect runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "science interrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
    ]);
  });

  test("every default promises its pinned entry, with explicit standard speed where the provider lists a speed option", () => {
    expect([...new Set(sheet.seats(models).flatMap((s) => s.defaults.map((d) => d.entry)))].sort()).toEqual([
      "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default",
      "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
      "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
      "opencode/opencode-go/deepseek-v4.1-flash variant=max",
    ]);
  });

  test("every DeepSeek entry is variant=max with no speed option", () => {
    const tierEntries = [
      ...Object.values(raw.domains.science.tiers).flatMap((v) => [v].flat()),
      ...Object.values(raw.muse.tiers).flatMap((v) => [v].flat()),
    ];
    const deepseek = tierEntries.filter((e) => sheet.family(sheet.parseEntry(e).model) === "deepseek");
    expect(deepseek).toHaveLength(12);
    for (const entry of deepseek) {
      expect(entry).toBe("opencode/opencode-go/deepseek-v4.1-flash variant=max");
      expect(sheet.parseEntry(entry).options).toEqual({ variant: "max" });
    }
    expect(raw.domains.science.termReaders).toEqual(["gpt", "grok", "muse", "deepseek"]);
  });

});

describe("parseModels", () => {
  const fixture = {
    domains: {
      general: { tiers: { code: "cursor/grok-4.7 fastMode=false", judgment: "claudeAgent/claude-opus-5-5 fastMode=false", runners: ["a/claude-a", "b/gpt-b"] } },
      science: { covers: "scientific work", termReaders: ["gpt", "grok"], tiers: { code: "codex/gpt-6.1-sol serviceTier=default", judgment: "codex/gpt-6-astra serviceTier=default", runners: ["a/claude-a", "b/gpt-b"] } },
    },
    roles: [{ role: "bug-fix", tier: "code", skill: "poteto-mode" }, { role: "hardest tasks", alias: "strongest judgment", tier: "judgment", skill: "poteto-mode" }, { role: "why investigators", tier: "code", skill: "why" }],
    muse: {
      on: ["muse mode"],
      off: ["normal mode", "standard mode"],
      tiers: {
        code: "muse/muse-wonder-1.0 reasoningEffort=xhigh",
        judgment: "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
        runners: ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false"],
      },
    },
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

  test("muse is required and holds only on, off, and tiers", () => {
    expect(parse((p) => delete p.muse)).toThrow('models.json: "muse" must be an object');
    expect(parse((p) => p.muse = null)).toThrow('models.json: "muse" must be an object');
    expect(parse((p) => p.muse.covers = "cheap work")).toThrow('models.json: "muse" has unknown field "covers"');
    expect(parse((p) => p.muse.termReaders = ["muse"])).toThrow('models.json: "muse" has unknown field "termReaders"');
  });

  test.each([
    ["missing", "on", undefined],
    ["empty", "on", []],
    ["repeated", "on", ["muse mode", "muse mode"]],
    ["blank", "on", [""]],
    ["whitespace-only", "on", ["  "]],
    ["uppercase", "on", ["Muse mode"]],
    ["non-string", "on", ["muse mode", 7]],
    ["untrimmed", "on", [" muse mode"]],
    ["missing", "off", undefined],
    ["empty", "off", []],
    ["uppercase", "off", ["Normal mode"]],
    ["untrimmed", "off", ["normal mode "]],
  ])("muse switch phrases reject %s %s", (_, key, value) => {
    expect(parse((p) => p.muse[key] = value)).toThrow(`models.json: "muse" "${key}" must be a non-empty list of distinct non-empty lowercase phrases with no surrounding spaces`);
  });

  test("muse on and off share no phrase", () => {
    expect(parse((p) => p.muse.off = ["normal mode", "muse mode"])).toThrow('models.json: "muse" lists "muse mode" in both "on" and "off"');
  });

  test("muse tiers name exactly the standard tiers, with the same shapes and no null", () => {
    expect(parse((p) => delete p.muse.tiers)).toThrow('models.json: "muse" needs a "tiers" object');
    expect(parse((p) => p.muse.tiers = null)).toThrow('models.json: "muse" needs a "tiers" object');
    expect(parse((p) => delete p.muse.tiers.code)).toThrow('models.json: "muse" has no tier "code"');
    expect(parse((p) => p.muse.tiers.extra = "b/gpt-b")).toThrow('models.json: "muse" names tier "extra", which no domain defines');
    expect(parse((p) => p.muse.tiers.code = null)).toThrow('models.json: muse tier "code" must be one entry or a list');
    expect(parse((p) => p.muse.tiers.code = ["a/claude-a", "b/gpt-b"])).toThrow('models.json: muse tier "code" must be one entry, like the standard "code" seat');
    expect(parse((p) => p.muse.tiers.runners = "b/gpt-b")).toThrow('models.json: muse tier "runners" must be a list, like the standard "runners" panel');
  });

  test("muse entries name concrete standard-speed targets", () => {
    expect(parse((p) => p.muse.tiers.code = "opus")).toThrow('models.json: muse tier "code": "opus" does not start with <providerInstanceId>/<modelId>');
    expect(parse((p) => p.muse.tiers.code = "inherit-parent")).toThrow('models.json: muse tier "code" must name a target, not inherit the parent');
    expect(parse((p) => p.muse.tiers.code = "auto")).toThrow('models.json: muse tier "code" must name a target, not inherit the parent');
    expect(parse((p) => p.muse.tiers.code = "muse/muse-wonder-1.0 reasoningEffort=xhigh fastMode=true")).toThrow('models.json: muse tier "code": fastMode=true is not standard speed, and this router never runs fast; write fastMode=false');
  });

  test("a muse panel needs two families, like a standard panel", () => {
    expect(parse((p) => p.muse.tiers.runners = ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false"])).not.toThrow();
    expect(parse((p) => p.muse.tiers.runners = ["a/claude-a", "b/gpt-b"])).not.toThrow();
    expect(parse((p) => p.muse.tiers.runners = ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "muse/muse-wonder-1.0 reasoningEffort=xhigh"])).toThrow('models.json: muse tier "runners": the panel needs at least two model families');
    expect(parse((p) => p.muse.tiers.runners = ["a/gpt-a", "b/gpt-b"])).toThrow('models.json: muse tier "runners": the panel needs at least two model families');
    expect(parse((p) => p.muse.tiers.runners = ["muse/muse-wonder-1.0 reasoningEffort=xhigh"])).toThrow('models.json: muse tier "runners": the panel needs at least two model families');
    expect(parse((p) => p.muse.tiers.runners = ["a/gpt-a", "a/gpt-a"])).toThrow('models.json: muse tier "runners" lists an entry twice');
  });

  test("a role label starting with the muse prefix is ambiguous", () => {
    expect(parse((p) => p.roles[0].role = "muse bug-fix")).toThrow('models.json: role "muse bug-fix" starts with "muse ", so its sheet line would be ambiguous');
    expect(parse((p) => p.roles[0].alias = "muse old name")).toThrow('models.json: role "muse old name" starts with "muse ", so its sheet line would be ambiguous');
  });

});

describe("muse mode policy", () => {
  test("the shipped muse block validates and matches the plan", () => {
    expect(parseModels(structuredClone(raw), () => true).muse).toEqual({
      on: ["muse mode"],
      off: ["normal mode", "standard mode", "turn off muse mode"],
      tiers: {
        code: "opencode/opencode-go/deepseek-v4.1-flash variant=max",
        explore: "opencode/opencode-go/deepseek-v4.1-flash variant=max",
        judgment: "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
        mechanical: "opencode/opencode-go/deepseek-v4.1-flash variant=max",
        final: "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
        runners: ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
        judges: ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
        reviewers: ["muse/muse-wonder-full-1.0 reasoningEffort=xhigh", "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", "opencode/opencode-go/deepseek-v4.1-flash variant=max"],
      },
    });
  });

  test("muse mode has no codex target", () => {
    expect(JSON.stringify(models.muse.tiers)).not.toContain("codex/");
    const entries = Object.values(models.muse.tiers).flatMap((v) => [v].flat());
    expect(entries.some((e) => sheet.parseEntry(e).providerInstanceId === "codex")).toBe(false);
    expect([...new Set(entries.map((e) => sheet.parseEntry(e).providerInstanceId))].sort()).toEqual(["claudeAgent", "muse", "opencode"]);
  });

  test("muse tiers run Wonder Full and DeepSeek at fixed levels and Opus and DeepSeek on every panel", () => {
    for (const [tier, value] of Object.entries(models.muse.tiers)) {
      const entries = [value].flat().map((entry) => sheet.parseEntry(entry));
      for (const entry of entries) {
        if (entry.model === "claude-opus-5-5") {
          expect(entry.providerInstanceId).toBe("claudeAgent");
          expect(entry.options).toEqual({ effort: "xhigh", fastMode: "false" });
        } else if (entry.providerInstanceId === "opencode") {
          expect(entry.model).toBe("opencode-go/deepseek-v4.1-flash");
          expect(sheet.family(entry.model)).toBe("deepseek");
          expect(entry.options).toEqual({ variant: "max" });
        } else {
          expect(entry.providerInstanceId).toBe("muse");
          expect(sheet.family(entry.model)).toBe("muse");
          expect(entry.model).toBe("muse-wonder-full-1.0");
          expect(entry.options).toEqual({ reasoningEffort: "xhigh" });
        }
      }
      if (Array.isArray(value)) {
        expect([...sheet.panelFamilies(entries)].sort()).toEqual(["claude", "deepseek", "muse"]);
      } else {
        expect(entries[0].providerInstanceId).toBe(["judgment", "final"].includes(tier) ? "muse" : "opencode");
      }
    }
    expect(sheet.parseEntry(models.muse.tiers.mechanical)).toEqual({
      providerInstanceId: "opencode",
      model: "opencode-go/deepseek-v4.1-flash",
      options: { variant: "max" },
    });
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
