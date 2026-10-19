import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sheetPath } from "../tools/install/sheet.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const childProgram = fileURLToPath(new URL("./fixtures/cursor-live/child.mjs", import.meta.url));
const mockSdk = fileURLToPath(new URL("./fixtures/cursor-live/mock-sdk", import.meta.url));
const live = process.env.T3_PSTACK_CURSOR_LIVE === "1" && process.env.CURSOR_API_KEY && process.env.T3_PSTACK_CURSOR_SDK;
const descriptions = [
  "Thermo-nuclear code quality audit (maintainability, structure, 1k-line rule, spaghetti, code-judo).",
  "Thermo-nuclear branch audit (bugs, breaking changes, security, devex, feature-flag leaks) scoped to the diff.",
];
const SAME_PROCESS_MARKER = "U6_SAME_PROCESS_MARKER_7f3a";

function scrub(text) {
  const key = process.env.CURSOR_API_KEY ?? "";
  return key ? String(text).split(key).join("[redacted]") : String(text);
}

function installerEnv(home) {
  return {
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    T3CODE_HOME: join(home, ".t3"),
    CURSOR_DATA_DIR: join(home, "cursor-data"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    PATH: join(home, "empty-bin"),
    TMPDIR: join(home, "tmp"),
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function installCursor(home) {
  const result = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), "install", "--cursor", "--json"], {
    cwd: repoRoot,
    env: installerEnv(home),
    encoding: "utf8",
  });
  expect(result.status, scrub(result.stderr)).toBe(0);
}

function seedControls(ws, nonces) {
  mkdirSync(join(ws, ".cursor/rules"), { recursive: true });
  mkdirSync(join(ws, ".cursor/agents"), { recursive: true });
  writeFileSync(
    join(ws, ".cursor/rules/live-control.mdc"),
    `---\ndescription: live proof control rule\nalwaysApply: true\n---\n\nControl rule ${nonces.rule}.\n`,
  );
  writeFileSync(
    join(ws, ".cursor/agents/live-control.md"),
    `---\nname: live-control\ndescription: Control subagent ${nonces.agent}.\n---\n\nReply with the word control.\n`,
  );
}

function quotedBothControls(turn, label, nonces) {
  expect(turn, `${label}: control rule quoted`).toContain(nonces.rule);
  expect(turn, `${label}: control subagent listed`).toContain(nonces.agent);
}

function runChild(home, ws, mode, sdk = process.env.T3_PSTACK_CURSOR_SDK) {
  const out = join(home, `live-${mode}.json`);
  const result = spawnSync("node", [childProgram, mode, out], {
    cwd: ws,
    env: {
      ...installerEnv(home),
      PATH: process.env.PATH,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      T3_PSTACK_CURSOR_SDK: sdk,
      LIVE_CWD: ws,
      LIVE_MARKER: SAME_PROCESS_MARKER,
      LIVE_RULE: join(home, ".cursor/plugins/local/t3-pstack-science/.cursor-plugin/rules/session-start.mdc"),
    },
    encoding: "utf8",
  });
  if (!existsSync(out)) throw new Error(scrub(`child wrote no result (status ${result.status}): ${result.stderr || result.stdout}`));
  const parsed = JSON.parse(readFileSync(out, "utf8"));
  if (result.status !== 0 || parsed.error) throw new Error(scrub(parsed.error || result.stderr || result.stdout));
  return parsed;
}

describe("Cursor live proof", () => {
  test("the child program parses", () => {
    const result = spawnSync("node", ["--check", childProgram], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  });

  test("the update turn counts only when it shows both controls", () => {
    const home = mkdtempSync(join(tmpdir(), "t3-pstack-cursor-mock-"));
    const ws = join(home, "ws");
    const nonces = { rule: `rule-${randomUUID()}`, agent: `agent-${randomUUID()}` };
    const controls = `${nonces.rule} ${nonces.agent}`;
    const pairWith = (updated) => {
      writeFileSync(join(ws, "mock-replies.json"), JSON.stringify([controls, controls, updated]));
      return runChild(home, ws, "pair", mockSdk);
    };
    try {
      mkdirSync(ws);
      mkdirSync(join(home, ".cursor/plugins/local/t3-pstack-science/.cursor-plugin/rules"), { recursive: true });
      expect(() => quotedBothControls(pairWith("").updated, "update", nonces), "an empty update reply").toThrow("update: control rule quoted");
      expect(() => quotedBothControls(pairWith(nonces.rule).updated, "update", nonces), "a reply without the subagent").toThrow("update: control subagent listed");
      const unmarked = pairWith(controls);
      quotedBothControls(unmarked.updated, "update", nonces);
      expect(unmarked.updated.includes(SAME_PROCESS_MARKER), "a controlled reply without the marker").toBe(false);
      const marked = pairWith(`${controls} ${SAME_PROCESS_MARKER}`);
      quotedBothControls(marked.updated, "update", nonces);
      expect(marked.updated.includes(SAME_PROCESS_MARKER), "a controlled reply with the marker").toBe(true);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test.skipIf(!live)("a T3-shaped session sees the installed rule by path and not our agent descriptions", async () => {
    const realCursor = join(homedir(), ".cursor");
    const home = mkdtempSync(join(tmpdir(), "t3-pstack-cursor-live-"));
    const marker = join(home, "marker");
    writeFileSync(marker, "start\n");
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    const ws = join(home, "ws");
    const nonces = { rule: `rule-${randomUUID()}`, agent: `agent-${randomUUID()}` };
    seedControls(ws, nonces);
    try {
      installCursor(home);
      const skill = join(home, ".cursor/plugins/local/t3-pstack-science/skills/poteto-mode/SKILL.md");
      const pair = runChild(home, ws, "pair");
      for (const [label, turn] of [["create", pair.created], ["resume", pair.resume]]) {
        quotedBothControls(turn, label, nonces);
        expect(turn, `${label}: our rule by absolute path`).toContain(skill);
        expect(turn, `${label}: no unexpanded root`).not.toContain("${CURSOR_PLUGIN_ROOT}");
        for (const description of descriptions) expect(turn, `${label}: no agent of ours as a subagent`).not.toContain(description);
      }
      quotedBothControls(pair.updated, "update", nonces);
      console.log(`same-process session saw the updated copy: ${pair.updated.includes(SAME_PROCESS_MARKER)}`);

      const sheet = sheetPath({ XDG_CONFIG_HOME: join(home, ".config") }, home);
      mkdirSync(dirname(sheet), { recursive: true });
      writeFileSync(sheet, "session hook: off\n");
      installCursor(home);
      const off = runChild(home, ws, "off");
      quotedBothControls(off.text, "off", nonces);
      expect(off.text, "off: our rule is gone").not.toContain(skill);
      expect(off.text, "off: our gate is gone").not.toContain("Follow this rule only when");

      const roots = ["plugins/local", "rules", "skills", "hooks.json"].map((name) => join(realCursor, name)).filter((path) => existsSync(path));
      if (roots.length) {
        const found = spawnSync("find", [...roots, "-newer", marker], { encoding: "utf8" });
        expect(found.status, scrub(found.stderr)).toBe(0);
        expect(scrub(found.stdout), "the real ~/.cursor is untouched").toBe("");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 900_000);
});
