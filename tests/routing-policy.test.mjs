import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { checkSheet, family, parseEntry, parseSheet, seats } from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { applyRegions, sheetBlock } from "../tools/derive-t3.mjs";
import { loadModels } from "../tools/generate.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const models = loadModels();

describe("two-column routing", () => {
  test.each(["general", "science"])("the %s defaults match the approved tiers and every panel spans families", (domain) => {
    const tiers = models.domains[domain].tiers;
    expect(tiers).toEqual({
      code: "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
      explore: "opencode/opencode-go/deepseek-v4.1-flash variant=max",
      judgment: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default",
      mechanical: "opencode/opencode-go/deepseek-v4.1-flash variant=max",
      final: "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default",
      runners: [
        "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
        "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
        "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
      ],
      judges: [
        "codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default",
        "muse/muse-wonder-full-1.0 reasoningEffort=xhigh",
        "claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false",
      ],
      reviewers: [
        "opencode/opencode-go/deepseek-v4.1-flash variant=max",
        "codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default",
      ],
    });
    for (const panel of [tiers.runners, tiers.judges, tiers.reviewers]) {
      expect(new Set(panel.map((entry) => family(parseEntry(entry).model))).size).toBeGreaterThanOrEqual(2);
    }
  });

  test("science term readers are GPT, Muse, and DeepSeek, and only science Opus seats are term-free", () => {
    expect(models.domains.science.termReaders).toEqual(["gpt", "muse", "deepseek"]);
    for (const seat of seats(models)) {
      for (const entry of seat.defaults) {
        expect(entry.termFree).toBe(seat.domain === "science" && family(parseEntry(entry.entry).model) === "claude");
      }
    }
  });

  test("the policy contains only domains and their shared roles", () => {
    expect(Object.keys(models)).toEqual(["domains", "roles"]);
  });

  test("a retired override names the release and tells the user to delete it", () => {
    expect(checkSheet(parseSheet("muse bug-fix: muse/muse-wonder-full-1.0 reasoningEffort=xhigh"), { models, catalog: null })).toEqual([
      '"muse bug-fix": muse mode was removed in 2.0.0-rc.14-science.4; delete this line',
    ]);
  });

  test("shipped files contain no retired routing instructions", () => {
    const files = ["README.md", "CONTEXT.md", "CONTRIBUTING.md"];
    const walk = (dir) => {
      for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
        if (["node_modules", ".git"].includes(entry.name)) continue;
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(md|mdc|json|mjs|ts|sh|txt)$/.test(path)) files.push(path);
      }
    };
    walk("plugins");
    walk("tools");
    const hits = files.filter((path) => {
      let text = read(path);
      if (path === "plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs") {
        text = text.replace("muse mode was removed in 2.0.0-rc.14-science.4; delete this line", "");
      }
      return /muse[ -]mode|mode: muse|museMode|muse <role>:/i.test(text);
    });
    expect(hits).toEqual([]);
  });

  test("the hook context and Cursor rule have no retired region", () => {
    for (const path of ["plugins/pstack/hooks/session-start-context.md", "plugins/pstack/.cursor-plugin/rules/session-start.mdc"]) {
      expect(read(path)).not.toMatch(/muse-mode:(?:start|end)|mode: muse|muse mode/i);
    }
  });

  test("the generated sheet has exactly the shared roles in each column", () => {
    const lines = parseSheet(sheetBlock(models).join("\n"));
    expect(lines.map((line) => line.key)).toEqual([
      ...models.roles.map((r) => r.role),
      ...models.roles.map((r) => `science ${r.role}`),
      "session hook",
    ]);
    expect(checkSheet(lines, { models, catalog: null })).toEqual([]);
  });

  test("poteto-mode stays within the byte cap", () => {
    expect(Buffer.byteLength(read("plugins/pstack/skills/poteto-mode/SKILL.md"))).toBeLessThanOrEqual(36000);
  });

  test("per-job levels retain the xhigh cap, DeepSeek exception, and one review round", () => {
    const poteto = read("plugins/pstack/skills/poteto-mode/SKILL.md");
    expect(poteto).toContain("Raise it one step, up to `xhigh`, for the hardest or subtlest work.");
    expect(poteto).toContain("No child runs above `xhigh` unless the user asks for more in the chat, or picked the `unlimited` budget in `/setup-pstack`.");
    expect(poteto).toContain("An entry on the `deepseek` family always runs at `max`, its listed level");
    expect(poteto).toContain("By default the panel reviews the whole change once, with every reviewer on the line.");
    expect(poteto).toContain("The fix is not re-reviewed unless the user asks for more rounds.");
    expect(poteto).toContain("A `fail` gets another fix run and another artifact check, not another review, with at most three fix runs in all.");
    expect(read("plugins/pstack/skills/setup-pstack/SKILL.md")).toContain("Leave an entry on the `deepseek` family at `max`, its listed level, whatever the budget.");
    for (const skill of new Set(models.roles.map((r) => r.skill))) {
      const out = applyRegions(`plugins/pstack/skills/${skill}/SKILL.md`, "## Models\n", models);
      expect(out).toContain("never above `xhigh` unless the user asks for more in the chat or picked the `unlimited` budget");
      expect(out).toContain("an entry on the `deepseek` family always runs at `max`");
    }
  });
});
