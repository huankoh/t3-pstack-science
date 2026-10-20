// Muse mode routing prose: one generated source stamped into every Models
// section, the session-start context, and the Cursor rule derived from it.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { applyRegions, museModeProse } from "../tools/derive-t3.mjs";
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

  test("the todolist, role-line, reasoning, and handback pins name muse mode", () => {
    const subs = JSON.parse(read("tools/substitutions.json")).substitutions;
    const byPattern = (p) => subs.find((r) => r.pattern === p)?.replacement ?? "";
    expect(byPattern("Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos.")).toContain("Record `mode: muse` or `mode: standard` after it");
    expect(byPattern("Prose and judgment read `judgment and prose`.")).toContain("or its `muse <role>:` line under `mode: muse`");
    expect(byPattern("Change only the effort level and whether the slug is fast,")).toContain("`reasoningEffort` on Codex and Muse");
    expect(byPattern("Change only the effort level and whether the slug is fast,")).toContain("muse mode keeps its listed levels");
    expect(byPattern("Before handing back, spawn a subagent on a different model family from the one that did the work.")).toContain("under `mode: muse`, read `muse interrogate reviewers` instead");
    expect(read("plugins/pstack/skills/show-me-your-work/SKILL.md")).toContain("under `mode: muse`, read `muse interrogate reviewers` instead");
    const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
    expect(poteto).toContain("Record `mode: muse` or `mode: standard` after it, per [Models](#models).");
    expect(poteto).toContain("such as `claude`, `gpt`, `grok`, or `muse`,");
    expect(read("plugins/pstack/skills/interrogate/SKILL.md")).toContain("such as `claude`, `gpt`, `grok`, or `muse`,");
  });
});
