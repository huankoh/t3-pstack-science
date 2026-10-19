import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const oldName = "t3-" + "pstack";
const identityPatterns = [
  new RegExp(`${oldName}@${oldName}`, "g"),
  new RegExp(`chhoumann/${oldName}(?![\\w-])`, "g"),
  new RegExp(`\\b${oldName}:[a-z0-9][a-z0-9-]*`, "g"),
  new RegExp("([\"'`])" + oldName + "(?: \\([^\"'`]*\\))?\\1", "g"),
];
const sheetPatterns = [
  new RegExp(`\\b${oldName}[/\\\\]`, "g"),
  new RegExp(`\\b${oldName}-models\\.md\\b`, "g"),
];
const legacyPath = "tests/fixtures/identity/legacy-install.json";
const upstreamPath = "tests/fixtures/identity/upstream-lines.txt";
const fixtures = new Set([legacyPath, upstreamPath]);
const provenance = (path) =>
  path === "CHANGES.md" || /^NOTICE.*\.md$/.test(basename(path)) || /^LICEN[CS]E(?:[.-]|$)/.test(basename(path));

function identityProblems(files) {
  const problems = [];
  for (const { path, text } of files) {
    if (provenance(path) || fixtures.has(path)) continue;
    for (const [index, line] of text.split("\n").entries()) {
      if (path === "tools/substitutions.json" && /^\s*"rationale":/.test(line)) continue;
      if (path === "tools/install/common.mjs" && line === `export const FOREIGN_PLUGIN_ID = "${oldName}@${oldName}";`) continue;
      const patterns = path.startsWith("tests/") ? identityPatterns : [...identityPatterns, ...sheetPatterns];
      const found = new Set(patterns.flatMap((pattern) => [...line.matchAll(pattern)].map((match) => match[0])));
      for (const value of found) problems.push(`${path}:${index + 1}: ${value}`);
    }
  }
  return problems;
}

describe("plugin identity", () => {
  const legacy = readFileSync(join(root, legacyPath), "utf8");

  test("names the file, line, and old identity outside provenance", () => {
    expect(identityProblems([{ path: "plugin.json", text: legacy }])).toEqual([
      `plugin.json:2: "${oldName}"`,
      `plugin.json:3: ${oldName}@${oldName}`,
      `plugin.json:4: chhoumann/${oldName}`,
      `plugin.json:5: ${oldName}:poteto-mode`,
      `plugin.json:6: ${oldName}/`,
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

  const upstreamLines = readFileSync(join(root, upstreamPath), "utf8").trimEnd().split("\n");
  const upstreamCases = [];
  for (let i = 0; i < upstreamLines.length; i += 2) {
    upstreamCases.push([upstreamLines[i].slice(4), upstreamLines[i + 1]]);
  }
  test.each(upstreamCases)("flags the pre-rename runtime line from %s", (source, text) => {
    const path = source.replace(/:\d+$/, "");
    expect(identityProblems([{ path, text }]).length).toBeGreaterThan(0);
  });

  test.each(["/", "$", "`", ""])("flags a skill namespace with prefix %s", (prefix) => {
    const text = `${prefix}${oldName}:poteto-mode`;
    expect(identityProblems([{ path: "tests/example.mjs", text }])).toEqual([
      `tests/example.mjs:1: ${oldName}:poteto-mode`,
    ]);
  });

  test("allows foreign sheet paths only under tests, while guarding other identity forms there", () => {
    const text = [`${oldName}/models.md`, `${oldName}\\models.md`, `${oldName}-models.md`].join("\n");
    expect(identityProblems([{ path: "tests/foreign.mjs", text }])).toEqual([]);
    expect(identityProblems([{ path: "hooks/start.sh", text }])).toHaveLength(3);
    for (const text of [`chhoumann/${oldName}`, `${oldName}:how`, `"${oldName}"`]) {
      expect(identityProblems([{ path: "tests/foreign.mjs", text }])).toHaveLength(1);
    }
  });

  test("keeps this fork's name and the end-of-line carried-by comment", () => {
    const name = `${oldName}-science`;
    const text = [`${name}@${name}`, `chhoumann/${name}`, `${name}:how`, `"${name}"`,
      `${name}/models.md`, `${name}\\models.md`, `${name}-models.md`,
      `// carried by ${oldName}:`].join("\n");
    expect(identityProblems([{ path: "watch-pr/verdicts.test.ts", text }])).toEqual([]);
  });

  test("tracked files use this fork's current identity", () => {
    const paths = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
    const files = paths.map((path) => ({ path, text: readFileSync(join(root, path), "utf8") })).filter(({ text }) => !text.includes("\0"));
    expect(identityProblems(files)).toEqual([]);
  });
});
