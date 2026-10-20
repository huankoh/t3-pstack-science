// Muse mode routing prose: one generated source stamped into every Models
// section, the session-start context, and the Cursor rule derived from it.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyRegions, museModeProse, sheetBlock } from "../tools/derive-t3.mjs";
import { loadModels } from "../tools/generate.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const models = loadModels();
const read = (rel) => readFileSync(join(repoRoot, rel), "utf8");
const phrases = [...models.muse.on, ...models.muse.off];
const HOOK = "plugins/pstack/hooks/session-start-context.md";

describe("muse mode prose", () => {
  test("every Models section carries the muse H3 with each trigger phrase and its own roles", () => {
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      const out = applyRegions(`plugins/pstack/skills/${skill}/SKILL.md`, "## Models\n", models);
      expect(out).toContain("### Muse mode");
      expect(out).toContain(museModeProse(models));
      for (const phrase of phrases) expect(out).toContain(`"${phrase}"`);
      for (const role of models.roles.filter((r) => r.skill === skill)) {
        expect(out).toContain(`\n| ${role.role} | \``);
      }
    }
  });

  test("the shipped Models sections match the generated muse prose", () => {
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      const shipped = read(`plugins/pstack/skills/${skill}/SKILL.md`);
      expect(shipped).toContain("### Muse mode");
      expect(shipped).toContain(museModeProse(models));
    }
  });

  test("regenerating a Models section and the hook region changes nothing twice", () => {
    for (const file of ["plugins/pstack/skills/poteto-mode/SKILL.md", HOOK]) {
      const once = applyRegions(file, read(file), models, { strict: true });
      expect(applyRegions(file, once, models, { strict: true })).toBe(once);
      expect(once).toBe(read(file));
    }
  });

  test("the hook context and the Cursor rule carry the phrases before any skill opens", () => {
    for (const rel of [HOOK, "plugins/pstack/.cursor-plugin/rules/session-start.mdc"]) {
      const text = read(rel);
      expect(text).toContain(museModeProse(models));
      for (const phrase of phrases) expect(text).toContain(`"${phrase}"`);
    }
  });

  test("the generated sheet fence names optional muse overrides and writes no muse lines", () => {
    const block = sheetBlock(models);
    expect(block).toContain("# Optional `muse <role>:` lines override muse mode only. A missing muse line uses the muse default, never a standard line.");
    expect(block.some((line) => line.startsWith("muse "))).toBe(false);
    expect(read("plugins/pstack/skills/setup-pstack/SKILL.md")).toContain("# Optional `muse <role>:` lines override muse mode only.");
  });

  test("poteto-mode stays under the byte cap with the muse section in", () => {
    expect(Buffer.byteLength(read("plugins/pstack/skills/poteto-mode/SKILL.md"))).toBeLessThanOrEqual(36000);
  });

  test("the fallback sentences refuse a standard or same-family default under mode muse", () => {
    const caveat = "Under `mode: muse`, a rejected target never falls back to a standard or same-family default.";
    const subs = JSON.parse(read("tools/substitutions.json")).substitutions;
    expect(subs.filter((r) => r.replacement.includes(caveat)).length).toBeGreaterThanOrEqual(4);
    for (const skill of ["how", "why", "arena", "reflect", "interrogate"]) {
      expect(read(`plugins/pstack/skills/${skill}/SKILL.md`)).toContain(caveat);
    }
  });

  test("the muse prose names the target rule, the panel rule, and the term readers by family", () => {
    const prose = museModeProse(models);
    expect(prose).toContain("A `muse <role>:` line must name a target.");
    expect(prose).toContain("`inherit-parent` and `auto` are rejected on a muse line.");
    expect(prose).toContain("Panels in `mode: muse` follow the normal two-family rule.");
    expect(prose).toContain("Muse-mode seats whose family is a science term reader (by default Muse and DeepSeek) read the terms.");
    expect(prose).toContain("A muse-mode seat whose family is not a science term reader (by default Opus) gets a term-free brief on a science task.");
    expect(prose).not.toContain("Only Opus gets a term-free brief");
    expect(prose).not.toContain("Muse seats read the terms");
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      expect(read(`plugins/pstack/skills/${skill}/SKILL.md`)).toContain("Panels in `mode: muse` follow the normal two-family rule.");
    }
    for (const rel of [HOOK, "plugins/pstack/.cursor-plugin/rules/session-start.mdc"]) {
      expect(read(rel)).toContain("Panels in `mode: muse` follow the normal two-family rule.");
    }
  });

  test("setup qualifies the aliases to standard lines and names every family", () => {
    const setup = read("plugins/pstack/skills/setup-pstack/SKILL.md");
    expect(setup).toContain("The aliases `inherit-parent` and `auto` are always valid on a standard line.");
    expect(setup).toContain("as the options for a standard line.");
    expect(setup).toContain("A `muse <role>:` line must name a target.");
    expect(setup).toContain("such as `claude`, `gpt`, `grok`, `muse`, or `deepseek`");
    expect(setup).not.toContain("`auto` are always valid.");
    expect(sheetBlock(models)).toContain("# `inherit-parent` or `auto` as a value on a standard line: the role runs on the parent chat's model (`delegate_task` omits `target`). A `muse <role>:` line must name a target. Alias entries in a panel list still count toward its fan-out.");
  });

  test("the muse table marks only Opus term-free in science", () => {
    const out = applyRegions("plugins/pstack/skills/arena/SKILL.md", "## Models\n", models);
    const musePart = out.split("### Muse mode")[1];
    expect(musePart).toContain("`claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false` (term-free brief in science)");
    expect(musePart).not.toContain("reasoningEffort=xhigh` (term-free");
    expect(musePart).not.toContain("variant=max` (term-free");
    expect(read("plugins/pstack/skills/arena/SKILL.md")).toContain("(term-free brief in science)");
  });

  test("the shared sheet paragraph qualifies the aliases to a standard line", () => {
    const out = applyRegions("plugins/pstack/skills/poteto-mode/SKILL.md", "## Models\n", models);
    expect(out).toContain("On a standard line, `inherit-parent` or `auto` omits `target`.");
    expect(read("plugins/pstack/skills/poteto-mode/SKILL.md")).toContain("On a standard line, `inherit-parent` or `auto` omits `target`.");
  });

  test("the docs name every provider muse mode needs and every panel family", () => {
    expect(read("README.md")).toContain("Muse mode needs the Muse, Claude, and OpenCode providers in T3.");
    expect(read("CHANGES.md")).toContain("Muse mode needs the Muse, Claude, and OpenCode providers in T3");
    expect(read("README.md")).toContain("Wonder Full, Opus 5.5, and DeepSeek sit on every muse mode panel");
    expect(read("CONTEXT.md")).toContain("Wonder Full, Opus 5.5, and DeepSeek sit on panels");
    expect(read("README.md")).not.toContain("Muse mode needs the Muse and OpenCode providers");
    expect(read("README.md")).not.toContain("Opus 5.5 and DeepSeek sit on every muse mode panel");
  });

  test("poteto-mode caps levels at xhigh, keeps DeepSeek at max, and reviews once by default", () => {
    const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
    expect(poteto).toContain("Raise it one step, up to `xhigh`, for the hardest or subtlest work.");
    expect(poteto).toContain("No child runs above `xhigh` unless the user asks for more in the chat, or picked the `unlimited` budget in `/setup-pstack`.");
    expect(poteto).toContain("An entry on the `deepseek` family always runs at `max`, its listed level, in every mode, and is never raised or lowered.");
    expect(poteto).toContain("In `mode: muse`, start from the level on the `muse <role>:` line or the muse default and raise or lower it per job by this same rule, never above `xhigh` unless the user asks for more or picked the `unlimited` budget. The sheet `# budget` comment does not set muse levels.");
    expect(poteto).toContain("By default the panel reviews the whole change once, with every reviewer on the line.");
    expect(poteto).toContain("One fix run then addresses that round's Act on findings and folds in accepted nits or drops them, with a reason for each dismissal.");
    expect(poteto).toContain("A `fail` gets another fix run and another artifact check, not another review, with at most three fix runs in all.");
    expect(poteto).toContain("The fix is not re-reviewed unless the user asks for more rounds.");
    expect(poteto).toContain("each later round reviews only the fix diff, and after three fix rounds the loop stops and reports the open findings, what kind of failure they suggest, and a recommendation.");
    expect(poteto).not.toContain("muse mode keeps its listed levels");
  });

  test("the eleven skills carry upstream's reasoning sentence exactly, with no muse caveat", () => {
    const upstream = "Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.";
    const caveat = "In `mode: muse`, use the level on the muse line or default; do not raise or lower it.";
    for (const skill of ["how", "arena", "interrogate", "reflect", "swarm", "why", "show-me-your-work", "automate-me", "figure-it-out", "no-comments", "recall"]) {
      const text = read(`plugins/pstack/skills/${skill}/SKILL.md`);
      expect(text).toContain(upstream);
      expect(text).not.toContain(caveat);
    }
    const subs = JSON.parse(read("tools/substitutions.json")).substitutions;
    expect(subs.some((r) => r.replacement.includes(caveat))).toBe(false);
  });

  test("no shipped file still says levels are fixed or not to raise or lower a muse level", () => {
    const stack = [join(repoRoot, "plugins"), join(repoRoot, "tools")];
    const hits = [];
    const check = (path, text) => {
      if (text.includes("Levels are fixed") || text.includes("do not raise or lower it")) hits.push(path);
    };
    while (stack.length) {
      const dir = stack.pop();
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === ".git") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) stack.push(path);
        else if (/\.(md|mdc|json|mjs|ts|sh|txt)$/.test(name)) check(path, readFileSync(path, "utf8"));
      }
    }
    for (const rel of ["README.md", "CONTEXT.md"]) check(join(repoRoot, rel), read(rel));
    expect(hits).toEqual([]);
    expect(read("tools/derive-t3.mjs")).not.toContain("Levels are fixed");
    expect(read("tools/substitutions.json")).not.toContain("do not raise or lower it");
  });

  test("every Models section, the hook context, and the Cursor rule carry the new muse level sentence", () => {
    const sentence = "Muse seats start at their listed level and are tuned per job per the **poteto-mode** skill's Subagents section, never above `xhigh` unless the user asks for more or picked the `unlimited` budget, and a DeepSeek seat always runs at `max`. The sheet `# budget` comment does not set muse levels.";
    expect(museModeProse(models)).toContain(sentence);
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      expect(read(`plugins/pstack/skills/${skill}/SKILL.md`)).toContain(sentence);
    }
    for (const rel of [HOOK, "plugins/pstack/.cursor-plugin/rules/session-start.mdc"]) {
      expect(read(rel)).toContain(sentence);
    }
  });

  test("the todolist, role-line, reasoning, and handback pins name muse mode", () => {
    const subs = JSON.parse(read("tools/substitutions.json")).substitutions;
    const byPattern = (p) => subs.find((r) => r.pattern === p)?.replacement ?? "";
    expect(byPattern("Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos.")).toContain("Record `mode: muse` or `mode: standard` after it");
    expect(byPattern("Prose and judgment read `judgment and prose`.")).toContain("or its `muse <role>:` line under `mode: muse`");
    expect(byPattern("Change only the effort level and whether the slug is fast,")).toContain("`reasoningEffort` on Codex and Muse");
    expect(byPattern("Change only the effort level and whether the slug is fast,")).not.toContain("muse mode keeps its listed levels");
    expect(byPattern("Before handing back, spawn a subagent on a different model family from the one that did the work.")).toContain("under `mode: muse`, read `muse interrogate reviewers` instead");
    expect(read("plugins/pstack/skills/show-me-your-work/SKILL.md")).toContain("under `mode: muse`, read `muse interrogate reviewers` instead");
    const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
    expect(poteto).toContain("Record `mode: muse` or `mode: standard` after it, per [Models](#models).");
    expect(poteto).toContain("such as `claude`, `gpt`, `grok`, or `muse`,");
    expect(read("plugins/pstack/skills/interrogate/SKILL.md")).toContain("such as `claude`, `gpt`, `grok`, or `muse`,");
  });

  test("no Models section caps the reasoning level at max", () => {
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      const out = applyRegions(`plugins/pstack/skills/${skill}/SKILL.md`, "## Models\n", models);
      expect(out).not.toContain("up to `max`");
      expect(out).toContain("The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, never above `xhigh` unless the user asks for more in the chat or picked the `unlimited` budget in `/setup-pstack`, and an entry on the `deepseek` family always runs at `max`, its listed level.");
      expect(read(`plugins/pstack/skills/${skill}/SKILL.md`)).not.toContain("up to `max`");
    }
  });

  test("setup keeps DeepSeek at max under every budget and sets no muse level", () => {
    const setup = read("plugins/pstack/skills/setup-pstack/SKILL.md");
    expect(setup).toContain("Leave an entry on the `deepseek` family at `max`, its listed level, whatever the budget.");
    expect(setup).toContain("The budget sets no muse level. A muse seat starts from its listed level and is tuned per job at dispatch, per the **poteto-mode** skill's Subagents section.");
    expect(setup).not.toContain("Muse mode keeps its listed levels");
  });
});
