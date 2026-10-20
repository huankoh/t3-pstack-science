// The T3 sheet grammar and its check against an orchestrator_capabilities
// catalog. The fixture is a trimmed copy of a real catalog: Claude names its
// reasoning option `effort`, Codex, Grok, and Muse name it `reasoningEffort`, and an
// unauthenticated provider lists models it cannot run.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadModels } from "../tools/generate.mjs";
import { DOMAINS, GENERAL, SCIENCE, SHEET_DIR, checkSheet, family, parseEntry, parseSheet, seats, speedProblems } from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const script = join(root, "plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs");
const catalogPath = join(root, "tests/fixtures/t3-catalog.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const museCatalogPath = join(root, "tests/fixtures/t3-muse-catalog.json");
const museCatalog = JSON.parse(readFileSync(museCatalogPath, "utf8"));
const museRunCatalog = { providers: [...museCatalog.providers, ...catalog.providers.filter((p) => !["muse", "opencode"].includes(p.providerInstanceId))] };
const models = loadModels();
const check = (text, over = catalog) => checkSheet(parseSheet(text), { models, catalog: over });
const checkMuse = (text, over = museRunCatalog) => checkSheet(parseSheet(text), { models, catalog: over, mode: "muse" });
const PANEL = "interrogate reviewers";
const v2 = "# pstack model configuration (T3). One line per role. Delete a line to fall back to the skill default.\n# `inherit-parent` or `auto` as a value: the role runs on the parent chat's model (`delegate_task` omits `target`). Alias entries in a panel list still count toward its fan-out.\n# budget: large (xhigh)\nfeature, refactoring: claudeAgent/claude-opus-5-5 effort=xhigh\nbug-fix: claudeAgent/claude-fable-5-1 effort=xhigh\nperf-issue: claudeAgent/claude-fable-5-1 effort=xhigh\nhillclimb: claudeAgent/claude-fable-5-1 effort=xhigh\njudgment and prose: claudeAgent/claude-opus-5-5 effort=xhigh\nhardest tasks: claudeAgent/claude-fable-5-1 effort=xhigh\nhow explorer: claudeAgent/claude-opus-5-5 effort=xhigh\nhow explainer: claudeAgent/claude-opus-5-5 effort=xhigh\nwhy investigators: claudeAgent/claude-opus-5-5 effort=xhigh\nwhy synthesizer: claudeAgent/claude-opus-5-5 effort=xhigh\nreflect tooling: claudeAgent/claude-opus-5-5 effort=xhigh\nreflect judgment, divergent, synthesizer: claudeAgent/claude-opus-5-5 effort=xhigh\narena runners: claudeAgent/claude-opus-5-5 effort=xhigh, codex/gpt-6.1-sol reasoningEffort=xhigh, grok/grok-4.7 reasoningEffort=xhigh\narena cross-judge pool: claudeAgent/claude-opus-5-5 effort=xhigh, codex/gpt-6.1-sol reasoningEffort=xhigh, grok/grok-4.7 reasoningEffort=xhigh\nswarm workers: claudeAgent/claude-opus-5-5 effort=xhigh\narchitect runners: claudeAgent/claude-opus-5-5 effort=xhigh, codex/gpt-6.1-sol reasoningEffort=xhigh, grok/grok-4.7 reasoningEffort=xhigh\ninterrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh, codex/gpt-6.1-sol reasoningEffort=xhigh, grok/grok-4.7 reasoningEffort=xhigh\nsession hook: on\n";

describe("parseEntry", () => {
  test("keeps a Pi model ID that has its own provider prefix", () => {
    expect(parseEntry("pi/openai-codex/gpt-6.1-sol thinking=medium")).toEqual({
      providerInstanceId: "pi",
      model: "openai-codex/gpt-6.1-sol",
      options: { thinking: "medium" },
    });
    expect(family("openai-codex/gpt-6.1-sol")).toBe(family("gpt-6.1-sol"));
  });

  test("maps an entry onto a delegate_task target", () => {
    expect(parseEntry(" codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=priority ")).toEqual({
      providerInstanceId: "codex",
      model: "gpt-6.1-sol",
      options: { reasoningEffort: "xhigh", serviceTier: "priority" },
    });
  });

  test("inherit-parent and auto have no target and take no options", () => {
    expect(parseEntry("inherit-parent")).toBeNull();
    expect(parseEntry("auto")).toBeNull();
    expect(() => parseEntry("inherit-parent effort=high")).toThrow("inherit-parent takes no options");
  });

  test("splits at the first slash, so an OpenCode model ID keeps its own", () => {
    expect(parseEntry("opencode/openrouter/x-ai/grok-4.7 reasoningEffort=high")).toEqual({
      providerInstanceId: "opencode",
      model: "openrouter/x-ai/grok-4.7",
      options: { reasoningEffort: "high" },
    });
    expect(() => parseEntry("opencode/openrouter/")).toThrow("does not start with <providerInstanceId>/<modelId>");
  });

  test("a route prefix in the model ID does not decide its family", () => {
    expect(family("openrouter/x-ai/grok-4.7")).toBe("grok");
    expect(family("openrouter/anthropic/claude-opus-5-5")).toBe("claude");
    expect(family("gpt-6.1-sol")).toBe("gpt");
  });

  test("rejects a bare alias, an @level, and a repeated option", () => {
    expect(() => parseEntry("opus")).toThrow("does not start with <providerInstanceId>/<modelId>");
    expect(() => parseEntry("claudeAgent/claude-opus-5-5 @high")).toThrow('"@high" is not <optionId>=<value>');
    expect(() => parseEntry("grok/grok-4.7 reasoningEffort=high reasoningEffort=low")).toThrow('sets "reasoningEffort" twice');
  });
});

describe("checkSheet without a catalog", () => {
  test("checks the grammar and the panel rule, not whether a target dispatches here", () => {
    expect(check("bug-fix: someprovider/unlisted-model effort=max\nsession hook: on\n", null)).toEqual([]);
    expect(check(`bug-fix: claude-opus\n${PANEL}: someprovider/claude-a, otherprovider/claude-b\n`, null)).toEqual([
      'bug-fix: "claude-opus" does not start with <providerInstanceId>/<modelId>',
      `${PANEL}: a panel needs at least two model families among its targets (inherit-parent does not count), got claude`,
    ]);
  });
});

describe("checkSheet against a catalog", () => {
  test("the default sheet setup-pstack writes dispatches", () => {
    const setup = readFileSync(join(root, "plugins/pstack/skills/setup-pstack/SKILL.md"), "utf8");
    const sheet = setup.match(/```markdown\n(# pstack model configuration \(T3\)[\s\S]*?)```/)[1];
    expect(parseSheet(sheet)).toHaveLength(39);
    expect(check(sheet)).toEqual([]);
  });

  test("names each entry that cannot dispatch here", () => {
    expect(
      check(
        [
          "bug-fix: claudeCode/claude-opus-5-5",
          "how explorer: antigravity/gemini-4-argon",
          "why synthesizer: grok/grok-9",
          "swarm workers: claudeAgent/claude-opus-5-5 reasoningEffort=high fastMode=false",
          "feature, refactoring: codex/gpt-6.1-sol reasoningEffort=extreme serviceTier=default",
          "hillclimb: claudeAgent/claude-opus-5-5 fastMode=yes",
        ].join("\n"),
      ),
    ).toEqual([
      'bug-fix: claudeCode/claude-opus-5-5: no provider instance "claudeCode" in this T3',
      'how explorer: antigravity/gemini-4-argon: "antigravity" cannot run child tasks (Provider is not authenticated.)',
      'why synthesizer: grok/grok-9: "grok" does not list model "grok-9"',
      'swarm workers: claudeAgent/claude-opus-5-5: no option "reasoningEffort" (has effort, fastMode)',
      "feature, refactoring: codex/gpt-6.1-sol: reasoningEffort=extreme is not one of low, medium, high, xhigh, max, ultra",
      "hillclimb: claudeAgent/claude-opus-5-5: fastMode=yes is not standard speed, and this router never runs fast; write fastMode=false",
    ]);
  });

  test("a model whose options are omitted or null reports the option instead of crashing", () => {
    for (const options of [undefined, null]) {
      const bare = structuredClone(catalog);
      bare.providers.find((p) => p.providerInstanceId === "claudeAgent").models.push({ id: "claude-x", options });
      expect(check("bug-fix: claudeAgent/claude-x effort=high", bare)).toEqual([
        'bug-fix: claudeAgent/claude-x: no option "effort" (has none)',
      ]);
    }
  });

  test("a missing line checks its column default on a machine without muse", () => {
    const noMuse = structuredClone(catalog);
    noMuse.providers = noMuse.providers.filter((p) => p.providerInstanceId !== "muse");
    expect(check("session hook: on", noMuse)).toEqual([
      "arena runners", "arena cross-judge pool", "architect runners", "interrogate reviewers",
      "science interrogate reviewers",
    ].map((key) => `${key} (no line, tier default): muse/muse-wonder-full-1.0: no provider instance "muse" in this T3`));
  });

  test("a panel on one family fails, whatever providers serve it", () => {
    expect(check(`${PANEL}: claudeAgent/claude-opus-5-5 fastMode=false, codex_pool/claude-opus-5-5`)).toEqual([
      `${PANEL}: a panel needs at least two model families among its targets (inherit-parent does not count), got claude`,
    ]);
    expect(check(`${PANEL}: claudeAgent/claude-opus-5-5 fastMode=false, grok/grok-4.7`)).toEqual([]);
  });

  test("inherit-parent does not count toward a panel's two families", () => {
    expect(check(`${PANEL}: inherit-parent, grok/grok-4.7`)).toEqual([
      `${PANEL}: a panel needs at least two model families among its targets (inherit-parent does not count), got grok`,
    ]);
    expect(check(`${PANEL}: auto, claudeAgent/claude-fable-5-1, grok/grok-4.7`)).toEqual([]);
  });

  test("an option named like an Object prototype key is checked, not dropped", () => {
    expect(check("bug-fix: claudeAgent/claude-opus-5-5 __proto__=bogus fastMode=false")).toEqual([
      'bug-fix: claudeAgent/claude-opus-5-5: no option "__proto__" (has effort, fastMode)',
    ]);
  });

  test("a panel that repeats a target fails", () => {
    expect(check(`${PANEL}: claudeAgent/claude-opus-5-5 fastMode=false, grok/grok-4.7, claudeAgent/claude-opus-5-5 fastMode=false`)).toEqual([
      `${PANEL}: lists the same target twice`,
    ]);
  });

  test("a provider that cannot run cross-provider children fails, and its entries do not count as a family", () => {
    const noCross = structuredClone(catalog);
    noCross.providers.find((p) => p.providerInstanceId === "grok").canRunCrossProviderChildTask = false;
    expect(check(`${PANEL}: claudeAgent/claude-opus-5-5 fastMode=false, grok/grok-4.7`, noCross)).toEqual([
      `${PANEL}: grok/grok-4.7: "grok" cannot run child tasks`,
      `${PANEL}: a panel needs at least two model families among its targets (inherit-parent does not count), got claude`,
    ]);
  });

  test("only a panel role takes a list", () => {
    expect(check("bug-fix: claudeAgent/claude-fable-5-1, grok/grok-4.7")).toEqual(["bug-fix: takes one entry, not a list"]);
  });

  // Upstream renamed the role in 0.15.21. A sheet setup-pstack wrote before
  // that keeps the old label, which still counts.
  test("a strongest judgment line is checked as the hardest tasks role, and setting both fails", () => {
    expect(check("strongest judgment: grok/grok-4.7 reasoningEffort=xhigh")).toEqual([]);
    expect(check("strongest judgment: grok/grok-9")).toEqual(['strongest judgment: grok/grok-9: "grok" does not list model "grok-9"']);
    expect(check("hardest tasks: grok/grok-4.7\nstrongest judgment: grok/grok-4.7")).toEqual([
      '"strongest judgment" appears twice; only one line may set it',
    ]);
  });

  test("a role set twice fails rather than letting the last line win", () => {
    expect(check("swarm workers: grok/grok-4.7 effort=high\nswarm workers: grok/grok-4.7")).toEqual([
      'swarm workers: grok/grok-4.7: no option "effort" (has reasoningEffort)',
      '"swarm workers" appears twice; only one line may set it',
    ]);
  });

  test("a line shaped like a role line but malformed fails instead of being skipped", () => {
    const bad = [
      "bug-fix:  grok/grok-4.7",
      "hillclimb:",
      "  perf-issue: grok/grok-4.7",
      "Bug-fix: grok/grok-9",
      "- bug-fix: grok/grok-9",
      "`bug-fix`: grok/grok-9",
      "**bug-fix**: grok/grok-9",
      "1. bug-fix: grok/grok-9",
      "bug_fix: grok/grok-9",
      "Delete a line to use the tier default.",
    ];
    expect(check(bad.join("\n"))).toEqual(
      bad.map((_, i) => `line ${i + 1}: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)`),
    );
  });

  test("CRLF line ends and a byte-order mark parse like plain lines", () => {
    expect(check("\uFEFFbug-fix: grok/grok-9\r\nsession hook: on\r\n")).toEqual([
      'bug-fix: grok/grok-9: "grok" does not list model "grok-9"',
    ]);
  });

  test("default effort, an unknown role, and a bad hook value fail; headings and blank lines pass", () => {
    expect(check("# Sheet\n\ndefault effort: session\nhow critics: grok/grok-4.7\nsession hook: of")).toEqual([
      "default effort: T3 entries carry their own options; delete this line",
      '"how critics" is not a pstack role',
      'session hook: "of" is not on or off',
    ]);
  });
});

// Each test spawns real node processes, and the first node start on a cold CI
// runner can take several seconds.
const CLI_TIMEOUT = 30_000;

describe("t3-sheet.mjs CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3-sheet-"));
  const run = (path, sheet) => {
    writeFileSync(join(dir, "sheet.md"), sheet);
    return spawnSync("node", [path, join(dir, "sheet.md"), catalogPath], { encoding: "utf8" });
  };

  test("prints each problem and exits 1, through a symlink too", () => {
    symlinkSync(script, join(dir, "linked.mjs"));
    for (const path of [script, join(dir, "linked.mjs")]) {
      const result = run(path, "bug-fix: grok/grok-9\n");
      expect({ status: result.status, stdout: result.stdout }).toEqual({
        status: 1,
        stdout: 'bug-fix: grok/grok-9: "grok" does not list model "grok-9"\n',
      });
    }
  }, CLI_TIMEOUT);

  test("reads a science line from the two-column policy", () => {
    const result = run(script, "science bug-fix: codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default\n");
    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "ok: every role line parses and dispatches on this T3\n" });
  }, CLI_TIMEOUT);
});

describe("t3-sheet.mjs --mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "t3-sheet-mode-"));
  const write = (name, text) => {
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  const cli = (...args) => spawnSync("node", [script, ...args], { encoding: "utf8" });
  const usage = "usage: t3-sheet.mjs [--mode standard|muse] <sheet.md> <catalog.json>\n";

  test("--mode muse exits 0 when the muse seats dispatch, wherever the flag sits", () => {
    const sheet = write("sheet.md", "session hook: on\n");
    const runCatalog = write("muse-run-catalog.json", JSON.stringify(museRunCatalog));
    for (const args of [
      ["--mode", "muse", sheet, runCatalog],
      [sheet, "--mode", "muse", runCatalog],
      [sheet, runCatalog, "--mode", "muse"],
    ]) {
      const result = cli(...args);
      expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "ok: every role line parses and dispatches on this T3\n" });
    }
  }, CLI_TIMEOUT);

  test("--mode muse exits 1 on a muse problem", () => {
    const sheet = write("bad.md", "muse bug-fix: muse/muse-wonder-1.0 reasoningEffort=extreme\n");
    const runCatalog = write("muse-run-catalog-bad.json", JSON.stringify(museRunCatalog));
    const result = cli("--mode", "muse", sheet, runCatalog);
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 1,
      stdout: "muse bug-fix: muse/muse-wonder-1.0: reasoningEffort=extreme is not one of minimal, low, medium, high, xhigh, max\n",
    });
  }, CLI_TIMEOUT);

  test("--mode muse exits 0 on a sheet whose only problem is a standard line", () => {
    const sheet = write("std-bad.md", "bug-fix: grok/grok-9\n");
    const runCatalog = write("muse-run-catalog-std.json", JSON.stringify(museRunCatalog));
    const result = cli("--mode", "muse", sheet, runCatalog);
    expect({ status: result.status, stdout: result.stdout }).toEqual({ status: 0, stdout: "ok: every role line parses and dispatches on this T3\n" });
  }, CLI_TIMEOUT);

  test("--mode muse exits 1 naming a malformed muse line", () => {
    const sheet = write("muse-malformed.md", "muse bug-fix auto\n");
    const runCatalog = write("muse-run-catalog-malformed.json", JSON.stringify(museRunCatalog));
    const result = cli("--mode", "muse", sheet, runCatalog);
    expect({ status: result.status, stdout: result.stdout }).toEqual({
      status: 1,
      stdout: 'line 1: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)\n',
    });
  }, CLI_TIMEOUT);

  test("--mode standard matches the default", () => {
    const sheet = write("std.md", "bug-fix: grok/grok-9\n");
    const plain = cli(sheet, catalogPath);
    const explicit = cli("--mode", "standard", sheet, catalogPath);
    expect([plain.status, plain.stdout, plain.stderr]).toEqual([explicit.status, explicit.stdout, explicit.stderr]);
    expect(plain.status).toBe(1);
  }, CLI_TIMEOUT);

  test.each([
    ["unknown mode", ["--mode", "fast", "<sheet>", "<catalog>"]],
    ["missing mode value", ["--mode"]],
    ["unknown flag", ["<sheet>", "<catalog>", "--speed"]],
    ["joined flag", ["--mode=muse", "<sheet>", "<catalog>"]],
    ["one path", ["<sheet>"]],
    ["three paths", ["<sheet>", "<catalog>", "<sheet>"]],
  ])("bad usage exits 2: %s", (_, template) => {
    const sheet = write("usage.md", "session hook: on\n");
    const args = template.map((a) => (a === "<sheet>" ? sheet : a === "<catalog>" ? museCatalogPath : a));
    const result = cli(...args);
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({ status: 2, stdout: "", stderr: usage });
  }, CLI_TIMEOUT);
});

describe("the T3 session-start context", () => {
  const pluginRoot = join(root, "plugins/pstack");

  test.each(["claude", "codex"])("the %s hook tells the session to route and dispatch through T3", (runtime) => {
    const home = mkdtempSync(join(tmpdir(), "t3-session-"));
    const result = spawnSync("sh", [join(pluginRoot, "hooks/session-start.sh"), runtime], {
      encoding: "utf8",
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot, GIT_CONFIG_GLOBAL: "/dev/null" },
    });
    expect(result.status).toBe(0);
    for (const phrase of ["t3-pstack-science:poteto-mode", "~/.config/t3-pstack-science/models.md", "delegate_task"]) {
      expect(result.stdout).toContain(phrase);
    }
  });
});

describe("seats", () => {
  test("exports the router's fixed domain pair", () => {
    expect([GENERAL, SCIENCE, DOMAINS]).toEqual(["general", "science", ["general", "science"]]);
    expect(() => DOMAINS.push("extra")).toThrow(TypeError);
  });

  test("lists 19 general seats then 19 science seats in role order", () => {
    const keys = seats(models).map((s) => s.key);
    expect(keys).toHaveLength(38);
    expect(keys.slice(0, 3)).toEqual(["feature, refactoring", "bug-fix", "perf-issue"]);
    expect(keys[19]).toBe("science feature, refactoring");
    expect(keys.at(-1)).toBe("science interrogate reviewers");
    expect(seats(models).find((s) => s.key === "science bug-fix")).toEqual({
      key: "science bug-fix", alias: null, domain: "science", role: "bug-fix", skill: "poteto-mode", panel: false,
      defaults: [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }],
    });
  });

  test("a null tier omits that seat, and aliases exist only in general", () => {
    const policy = { domains: { general: { tiers: { code: null } }, science: { termReaders: ["gpt"], tiers: { code: "a/claude-a" } } }, roles: [{ role: "code unit", alias: "old code", tier: "code", skill: "how" }] };
    expect(seats(policy)).toEqual([{ key: "science code unit", alias: null, domain: "science", role: "code unit", skill: "how", panel: false, defaults: [{ entry: "a/claude-a", termFree: true }] }]);
    expect(checkSheet(parseSheet("code unit: a/claude-a"), { models: policy, catalog: null })).toEqual(['"code unit" has no general seat; write "science code unit"']);
  });
});

describe("muse seats", () => {
  test("lists 19 muse seats in role order, marking only Opus defaults term-free in science", () => {
    const muse = seats(models, { mode: "muse" });
    expect(muse.map((s) => s.key)).toEqual(models.roles.map((r) => `muse ${r.role}`));
    expect(muse.flatMap((s) => s.defaults)).toHaveLength(27);
    for (const seat of muse) {
      expect(seat.alias).toBeNull();
      for (const d of seat.defaults) {
        expect(d.termFree).toBe(family(parseEntry(d.entry).model) === "claude");
      }
    }
    expect(muse.flatMap((s) => s.defaults.filter((d) => d.termFree).map((d) => `${s.key}: ${d.entry}`))).toEqual([
      "muse arena runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "muse arena cross-judge pool: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "muse architect runners: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      "muse interrogate reviewers: claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
    ]);
    for (const d of muse.flatMap((s) => s.defaults)) {
      if (family(parseEntry(d.entry).model) === "muse") expect(d.termFree).toBe(false);
    }
  });

  test("derives muse defaults from the muse tiers", () => {
    expect(seats(models, { mode: "muse" }).find((s) => s.key === "muse bug-fix")).toEqual({
      key: "muse bug-fix", alias: null, domain: "muse", role: "bug-fix", skill: "poteto-mode", panel: false,
      defaults: [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }],
    });
    expect(seats(models, { mode: "muse" }).find((s) => s.key === "muse mechanical code")).toEqual({
      key: "muse mechanical code", alias: null, domain: "muse", role: "mechanical code", skill: "poteto-mode", panel: false,
      defaults: [{ entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false }],
    });
    expect(seats(models, { mode: "muse" }).find((s) => s.key === "muse interrogate reviewers")).toEqual({
      key: "muse interrogate reviewers", alias: null, domain: "muse", role: "interrogate reviewers", skill: "interrogate", panel: true,
      defaults: [
        { entry: "muse/muse-wonder-full-1.0 reasoningEffort=xhigh", termFree: false },
        { entry: "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", termFree: true },
        { entry: "opencode/opencode-go/deepseek-v4.1-flash variant=max", termFree: false },
      ],
    });
  });
});

describe("domain sheet keys", () => {
  test("a catalog without claudeAgent names the general seats that now default to Opus", () => {
    const noClaudeAgent = { providers: museRunCatalog.providers.filter((p) => p.providerInstanceId !== "claudeAgent") };
    const problems = check("", noClaudeAgent);
    const named = problems.map((p) => p.split(" (no line, tier default):")[0]);
    const opusSeats = seats(models).filter((s) => s.defaults.some((d) => d.entry.startsWith("claudeAgent/claude-opus-5-5"))).map((s) => s.key);
    expect(named).toEqual(opusSeats);
    expect(named.filter((k) => !k.startsWith("science "))).toEqual(models.roles.map((r) => r.role).filter((r) => r !== "final review"));
    expect(problems[0]).toBe('feature, refactoring (no line, tier default): claudeAgent/claude-opus-5-5: no provider instance "claudeAgent" in this T3');
  });

  test("a literal v2 sheet passes the grammar check", () => {
    expect(check(v2, null)).toEqual([]);
    expect(check("bug-fix: claudeAgent/claude-fable-5-1 effort=xhigh\nscience bug-fix: claudeAgent/claude-fable-5-1 effort=xhigh")).toEqual([]);
  });

  test("catalog validation reports v2 entries that omit a listed speed option", () => {
    expect(check(v2)).toEqual([
      'feature, refactoring: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'judgment and prose: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'how explorer: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'how explainer: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'why investigators: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'why synthesizer: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'reflect tooling: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'reflect judgment, divergent, synthesizer: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'arena runners: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'arena runners: codex/gpt-6.1-sol: sets no serviceTier; this router never runs fast, so write serviceTier=default',
      'arena runners: a panel needs at least two model families among its targets (inherit-parent does not count), got grok',
      'arena cross-judge pool: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'arena cross-judge pool: codex/gpt-6.1-sol: sets no serviceTier; this router never runs fast, so write serviceTier=default',
      'arena cross-judge pool: a panel needs at least two model families among its targets (inherit-parent does not count), got grok',
      'swarm workers: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'architect runners: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'architect runners: codex/gpt-6.1-sol: sets no serviceTier; this router never runs fast, so write serviceTier=default',
      'architect runners: a panel needs at least two model families among its targets (inherit-parent does not count), got grok',
      'interrogate reviewers: claudeAgent/claude-opus-5-5: sets no fastMode; this router never runs fast, so write fastMode=false',
      'interrogate reviewers: codex/gpt-6.1-sol: sets no serviceTier; this router never runs fast, so write serviceTier=default',
      'interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got grok',
    ]);
  });

  test.each([
    ["science bug-fix: grok/grok-9", ['science bug-fix: grok/grok-9: "grok" does not list model "grok-9"']],
    ["general bug-fix: grok/grok-4.7", ['"general bug-fix": unprefixed lines set the general column; write "bug-fix"']],
    ["science strongest judgment: grok/grok-4.7", ['"science strongest judgment": write "science hardest tasks"; the old name counts only on an unprefixed line']],
    ["science session hook: on", ['"science session hook" is not a pstack role']],
    ["science swarm workers: grok/grok-4.7\nscience swarm workers: grok/grok-4.7", ['"science swarm workers" appears twice; only one line may set it']],
    ["science interrogate reviewers: codex/gpt-6-astra serviceTier=default, codex/gpt-6.1-sol serviceTier=default", ['science interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got gpt']],
  ])("checks %s", (text, expected) => expect(check(text)).toEqual(expected));
});

describe("muse sheet lines", () => {
  const fence = () => {
    const setup = readFileSync(join(root, "plugins/pstack/skills/setup-pstack/SKILL.md"), "utf8");
    return setup.match(/```markdown\n(# pstack model configuration \(T3\)[\s\S]*?)```/)[1];
  };

  test("existing sheets read the same with and without an explicit standard mode", () => {
    expect(checkSheet(parseSheet(v2), { models, catalog, mode: "standard" })).toEqual(check(v2));
    expect(checkSheet(parseSheet(fence()), { models, catalog, mode: "standard" })).toEqual([]);
    expect(check(fence())).toEqual([]);
  });

  test("a muse line is checked like any line", () => {
    expect(checkMuse("muse bug-fix: muse/muse-wonder-1.0 reasoningEffort=xhigh")).toEqual([]);
    expect(checkMuse("muse bug-fix: opus")).toEqual(['muse bug-fix: "opus" does not start with <providerInstanceId>/<modelId>']);
    expect(checkMuse("muse bug-fix: muse/muse-wonder-1.0 reasoningEffort=extreme")).toEqual([
      "muse bug-fix: muse/muse-wonder-1.0: reasoningEffort=extreme is not one of minimal, low, medium, high, xhigh, max",
    ]);
    expect(checkMuse("muse bug-fix: muse/muse-wonder-1.0 reasoningEffort=xhigh\nmuse bug-fix: muse/muse-wonder-1.0 reasoningEffort=xhigh")).toEqual([
      '"muse bug-fix" appears twice; only one line may set it',
    ]);
  });

  test("a muse panel needs two runnable families, like a standard panel", () => {
    expect(checkMuse("muse interrogate reviewers: muse/muse-wonder-full-1.0 reasoningEffort=xhigh, claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false")).toEqual([]);
    expect(check("interrogate reviewers: muse/muse-wonder-full-1.0 reasoningEffort=xhigh, muse/muse-wonder-1.0 reasoningEffort=xhigh", null)).toEqual([
      "interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got muse",
    ]);
    expect(checkMuse("muse interrogate reviewers: muse/muse-wonder-full-1.0 reasoningEffort=xhigh, muse/muse-wonder-1.0 reasoningEffort=xhigh")).toEqual([
      "muse interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got muse",
    ]);
    expect(checkMuse("muse interrogate reviewers: muse/muse-wonder-1.0 reasoningEffort=xhigh")).toEqual([
      "muse interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got muse",
    ]);
    expect(checkMuse("muse interrogate reviewers: muse/muse-wonder-1.0 reasoningEffort=xhigh, muse/muse-wonder-1.0 reasoningEffort=xhigh")).toEqual([
      "muse interrogate reviewers: lists the same target twice",
      "muse interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got muse",
    ]);
    expect(checkMuse("muse interrogate reviewers: muse/muse-wonder-full-1.0 reasoningEffort=xhigh, claudeAgent/claude-opus-5-5 effort=extreme fastMode=false")).toEqual([
      "muse interrogate reviewers: claudeAgent/claude-opus-5-5: effort=extreme is not one of low, medium, high, xhigh, max",
      "muse interrogate reviewers: a panel needs at least two model families among its targets (inherit-parent does not count), got muse",
    ]);
  });

  test("a muse line rejects inherit-parent and auto", () => {
    expect(check("muse bug-fix: inherit-parent")).toEqual(['muse bug-fix: "inherit-parent" is not allowed on a muse line; write a target']);
    expect(check("muse bug-fix: auto")).toEqual(['muse bug-fix: "auto" is not allowed on a muse line; write a target']);
    expect(checkMuse("muse bug-fix: inherit-parent")).toEqual(['muse bug-fix: "inherit-parent" is not allowed on a muse line; write a target']);
  });

  test.each([
    ["muse science bug-fix", '"muse science bug-fix": a muse seat takes no domain; write "muse bug-fix"', true],
    ["science muse bug-fix", '"science muse bug-fix": a muse seat takes no domain; write "muse bug-fix"', false],
    ["muse strongest judgment", '"muse strongest judgment": write "muse hardest tasks"; the old name counts only on an unprefixed line', true],
  ])("hint %s", (text, expected, inMuse) => {
    expect(check(`${text}: grok/grok-4.7`)).toEqual([expected]);
    expect(checkMuse(`${text}: grok/grok-4.7`)).toEqual(inMuse ? [expected] : []);
  });

  test("muse mode checks only muse lines, malformed muse lines included, plus omitted muse defaults", () => {
    const malformed = 'line 1: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)';
    expect(parseSheet(" muse bug-fix: x\n")).toEqual([{ line: 1, text: " muse bug-fix: x", key: undefined, value: undefined }]);
    expect(checkMuse("bug-fix: opus\n")).toEqual([]);
    expect(checkMuse(" bug-fix: x\n")).toEqual([]);
    expect(checkMuse("muse bug-fix auto\n")).toEqual([malformed]);
    expect(checkMuse("muse bug-fix:auto\n")).toEqual([malformed]);
    expect(checkMuse(" muse bug-fix: x\n")).toEqual([malformed]);
    expect(checkMuse("bug-fix: opus\nmuse bug-fix auto\n")).toEqual([
      'line 2: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)',
    ]);
  });

  test("a muse line whose target this catalog lacks stays silent without muse mode", () => {
    const noSpark = structuredClone(museRunCatalog);
    const museProvider = noSpark.providers.find((p) => p.providerInstanceId === "muse");
    museProvider.models = museProvider.models.filter((m) => m.id !== "muse-spark-1.3");
    expect(check("muse mechanical code: muse/muse-spark-1.3 reasoningEffort=max", noSpark)).toEqual([]);
    expect(check("muse interrogate reviewers: muse/muse-spark-1.3 reasoningEffort=max, claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false", noSpark)).toEqual([]);
    expect(checkSheet(parseSheet("muse mechanical code: muse/muse-spark-1.3 reasoningEffort=max"), { models, catalog: noSpark, mode: "muse" })).toEqual([
      'muse mechanical code: muse/muse-spark-1.3: "muse" does not list model "muse-spark-1.3"',
    ]);
  });

  test("muse mode names every muse seat whose default cannot run here", () => {
    const lacking = structuredClone(catalog);
    lacking.providers = lacking.providers.filter((p) => !["muse", "claudeAgent"].includes(p.providerInstanceId));
    const full = 'muse/muse-wonder-full-1.0: no provider instance "muse" in this T3';
    const opus = 'claudeAgent/claude-opus-5-5: no provider instance "claudeAgent" in this T3';
    const missing = (key, target) => `${key} (no line, tier default): ${target}`;
    expect(checkSheet(parseSheet("session hook: on\n"), { models, catalog: lacking, mode: "muse" })).toEqual([
      missing("muse judgment and prose", full),
      missing("muse hardest tasks", full),
      missing("muse final review", full),
      missing("muse how explainer", full),
      missing("muse why synthesizer", full),
      missing("muse reflect judgment, divergent, synthesizer", full),
      missing("muse arena runners", full),
      missing("muse arena runners", opus),
      missing("muse arena cross-judge pool", full),
      missing("muse arena cross-judge pool", opus),
      missing("muse architect runners", full),
      missing("muse architect runners", opus),
      missing("muse interrogate reviewers", full),
      missing("muse interrogate reviewers", opus),
    ]);
  });

  test("muse mode passes on a catalog that lists the Muse, Opus, and DeepSeek models", () => {
    expect(checkMuse("session hook: on\n")).toEqual([]);
    expect(checkMuse("muse bug-fix: muse/muse-wonder-1.0 reasoningEffort=xhigh\nmuse interrogate reviewers: muse/muse-wonder-full-1.0 reasoningEffort=xhigh, claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false\n")).toEqual([]);
  });
});

describe("standard speed", () => {
  test.each([
    ["claudeAgent/claude-nonexistent", '"claudeAgent" does not list model "claude-nonexistent"'],
    ["unlisted/claude-a", 'no provider instance "unlisted" in this T3'],
  ])("unknown options on %s allow the speed option to be deleted", (target, unavailable) => {
    expect(check(`bug-fix: ${target} fastMode=true`)).toEqual([
      `bug-fix: ${target}: fastMode=true is not standard speed, and this router never runs fast; write fastMode=false, or delete fastMode if the model lists no such option`,
      `bug-fix: ${target}: ${unavailable}`,
    ]);
  });

  test.each([
    ["fastMode=true", 'bug-fix: claudeAgent/claude-fable-5-1: no option "fastMode" (has effort); delete fastMode'],
    ["fastMode=false", 'bug-fix: claudeAgent/claude-fable-5-1: no option "fastMode" (has effort); delete fastMode'],
    ["serviceTier=priority", 'bug-fix: claudeAgent/claude-fable-5-1: no option "serviceTier" (has effort); delete serviceTier'],
    ["serviceTier=default", 'bug-fix: claudeAgent/claude-fable-5-1: no option "serviceTier" (has effort); delete serviceTier'],
  ])("an unsupported speed option %s is deleted, not set to a standard value", (pair, expected) => {
    expect(check(`bug-fix: claudeAgent/claude-fable-5-1 effort=xhigh ${pair}`)).toEqual([
      expected,
    ]);
  });

  test("speed validation reports every nonstandard option without catalog duplicates", () => {
    expect(speedProblems(parseEntry("a/gpt-a fastMode=true serviceTier=priority"))).toEqual([
      "fastMode=true is not standard speed, and this router never runs fast; write fastMode=false",
      "serviceTier=priority is not standard speed, and this router never runs fast; write serviceTier=default",
    ]);
    expect(check("bug-fix: claudeAgent/claude-opus-5-5 fastMode=true")).toEqual([
      "bug-fix: claudeAgent/claude-opus-5-5: fastMode=true is not standard speed, and this router never runs fast; write fastMode=false",
    ]);
    expect(check("science bug-fix: codex/gpt-6.1-sol serviceTier=priority")).toEqual([
      "science bug-fix: codex/gpt-6.1-sol: serviceTier=priority is not standard speed, and this router never runs fast; write serviceTier=default",
    ]);
  });

  test("without a catalog speed advice allows an option the model does not list to be deleted", () => {
    expect(check("bug-fix: claudeAgent/claude-fable-5-1 effort=xhigh fastMode=true serviceTier=priority", null)).toEqual([
      "bug-fix: claudeAgent/claude-fable-5-1: fastMode=true is not standard speed, and this router never runs fast; write fastMode=false, or delete fastMode if the model lists no such option",
      "bug-fix: claudeAgent/claude-fable-5-1: serviceTier=priority is not standard speed, and this router never runs fast; write serviceTier=default, or delete serviceTier if the model lists no such option",
    ]);
  });

  test("each option reports its catalog or speed problem once, in entry order", () => {
    expect(check("bug-fix: claudeAgent/claude-opus-5-5 effort=extreme fastMode=true serviceTier=priority")).toEqual([
      "bug-fix: claudeAgent/claude-opus-5-5: effort=extreme is not one of low, medium, high, xhigh, max",
      "bug-fix: claudeAgent/claude-opus-5-5: fastMode=true is not standard speed, and this router never runs fast; write fastMode=false",
      'bug-fix: claudeAgent/claude-opus-5-5: no option "serviceTier" (has effort, fastMode); delete serviceTier',
    ]);
  });

  test("requires all listed speed options on concrete targets, but not inherit aliases", () => {
    expect(check("bug-fix: cursor/grok-4.7 reasoning_effort=xhigh")).toEqual([
      "bug-fix: cursor/grok-4.7: sets no fastMode; this router never runs fast, so write fastMode=false",
    ]);
    expect(check("science bug-fix: inherit-parent")).toEqual([]);
    expect(check("science bug-fix: codex/gpt-6.1-sol", null)).toEqual([]);
  });
});

test("the session hook reads the sheet directory the installer writes", () => {
  expect(readFileSync(join(root, "plugins/pstack/hooks/session-start.sh"), "utf8")).toContain(`/${SHEET_DIR}/models.md`);
});
