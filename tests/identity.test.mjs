import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const oldName = "t3-pstack";
const needles = [
  `${oldName}@${oldName}`,
  `github:chhoumann/${oldName}`,
  `/${oldName}:`,
  `~/.config/${oldName}/`,
];
const fixtures = new Set(["tests/fixtures/identity/legacy-install.json"]);
const provenance = (path) =>
  path === "CHANGES.md" || /^NOTICE.*\.md$/.test(basename(path)) || /^LICEN[CS]E(?:[.-]|$)/.test(basename(path));

function identityProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (provenance(path) || fixtures.has(path)) continue;
    for (const [index, line] of text.split("\n").entries()) {
      if (path === "tools/substitutions.json" && /^\s*"rationale":/.test(line)) continue;
      if (path === "tools/install/common.mjs" && line === `export const FOREIGN_PLUGIN_ID = "${oldName}@${oldName}";`) continue;
      const found = needles.filter((needle) => line.includes(needle));
      const name = line.match(/"name"\s*:\s*"t3-pstack"/)?.[0];
      if (name) found.push(name);
      for (const value of found) problems.push(`${path}:${index + 1}: ${value}`);
    }
  }
  return problems;
}

describe("plugin identity", () => {
  const legacyPath = "tests/fixtures/identity/legacy-install.json";
  const legacy = readFileSync(join(root, legacyPath), "utf8");

  test("names the file, line, and old identity outside provenance", () => {
    expect(identityProblems([{ path: "plugin.json", text: legacy }])).toEqual([
      `plugin.json:2: "name": "${oldName}"`,
      `plugin.json:3: ${oldName}@${oldName}`,
      `plugin.json:4: github:chhoumann/${oldName}`,
      `plugin.json:5: /${oldName}:`,
      `plugin.json:6: ~/.config/${oldName}/`,
    ]);
  });

  test("keeps explicit provenance and legacy fixtures, but scans replacement text and other fixtures", () => {
    const needle = `${oldName}@${oldName}`;
    expect(identityProblems([
      { path: "CHANGES.md", text: legacy },
      { path: "NOTICE-skills.md", text: legacy },
      { path: "plugins/pstack/skills/poteto-mode/references/licenses/NOTICE.md", text: legacy },
      { path: "LICENSE", text: legacy },
      { path: legacyPath, text: legacy },
      { path: "tools/substitutions.json", text: `  "rationale": "${needle}"\n  "replacement": "${needle}"` },
      { path: "tests/fixtures/unreviewed.json", text: needle },
      { path: "tools/install/common.mjs", text: `export const FOREIGN_PLUGIN_ID = "${needle}";\nexport const PLUGIN_ID = "${needle}";` },
    ])).toEqual([
      `tools/substitutions.json:2: ${needle}`,
      `tests/fixtures/unreviewed.json:1: ${needle}`,
      `tools/install/common.mjs:2: ${needle}`,
    ]);
  });

  test("tracked files use this fork's current identity", () => {
    const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const files = paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") })).filter(({ text }) => !text.includes("\0"));
    expect(identityProblems(files)).toEqual([]);
  });
});
