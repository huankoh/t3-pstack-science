import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { fingerprint, lockFix } from "./install-cursor-shared.mjs";
import { chmodDeniesReads as chmodDenies } from "./session-hook-sheets.mjs";

const scratch = [];
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true });
});
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), "t3-pstack-cursor-"));
  scratch.push(dir);
  return dir;
};

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const version = JSON.parse(readFileSync(join(repoRoot, "plugins/pstack/.claude-plugin/plugin.json"), "utf8")).version;

function seedCursor(home) {
  const cacheSkill = join(home, ".cursor/plugins/cache/cursor-public/pstack/abc/skills/poteto-mode");
  const other = join(home, ".cursor/plugins/local/other-plugin");
  mkdirSync(cacheSkill, { recursive: true });
  mkdirSync(join(other, "skills/poteto-mode"), { recursive: true });
  writeFileSync(join(cacheSkill, "SKILL.md"), "# cached\n");
  writeFileSync(join(other, "skills/poteto-mode/SKILL.md"), "# other\n");
  writeFileSync(join(other, "keep.txt"), "keep\n");
  mkdirSync(join(home, ".t3/userdata"), { recursive: true });
  writeFileSync(
    join(home, ".t3/userdata/settings.json"),
    `${JSON.stringify({
      providerInstances: {
        cursor_main: { driver: "cursor", config: { homePath: join(home, "not-cursor"), binaryPath: "/opt/cursor" } },
        cursor_other: { driver: "cursor", enabled: false, environment: [{ name: "CURSOR_HOME", value: join(home, "cursor-env") }] },
      },
    })}\n`,
  );
}

function runInstaller(home, args) {
  const r = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), ...args], {
    cwd: repoRoot,
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      T3CODE_HOME: join(home, ".t3"),
      CURSOR_DATA_DIR: join(home, "cursor-data"),
      CLAUDE_CONFIG_DIR: join(home, ".claude"),
      CODEX_HOME: join(home, ".codex"),
      PATH: join(home, "empty-bin"),
      TMPDIR: join(home, "tmp"),
      GIT_CONFIG_GLOBAL: "/dev/null",
    },
    encoding: "utf8",
  });
  return r;
}

describe("install.mjs and ~/.cursor", () => {
  test("install, update, and doctor leave a seeded Cursor home byte-identical", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const before = fingerprint(join(home, ".cursor"));
    for (const command of ["install", "update", "doctor"]) {
      const r = runInstaller(home, [command, "--json"]);
      expect(r.status, r.stderr).toBe(0);
      expect(fingerprint(join(home, ".cursor")), command).toEqual(before);
    }
    expect(existsSync(join(home, "not-cursor"))).toBe(false);
    expect(existsSync(join(home, "cursor-env"))).toBe(false);
  });

  test("install --cursor converges, doctor warns about the other plugins, and uninstall removes only our copy", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const seeded = fingerprint(join(home, ".cursor"));
    const installed = runInstaller(home, ["install", "--cursor", "--json"]);
    expect(installed.status, installed.stderr).toBe(0);
    const report = JSON.parse(installed.stdout);
    expect(report.failed).toBe(0);
    expect(report.settings.instances).toBe(0);
    const cursor = report.homes.find((row) => row.harness === "cursor");
    expect(cursor.dir).toBe(join(home, ".cursor"));
    expect(cursor.from).toEqual(["default", "T3 instance cursor_main", "T3 instance cursor_other (disabled)"]);
    expect(cursor.steps[0]).toBe(`installed ${version} in plugins/local/t3-pstack-science`);
    expect(existsSync(join(home, "not-cursor"))).toBe(false);
    const dest = join(home, ".cursor/plugins/local/t3-pstack-science");
    const rule = readFileSync(join(dest, ".cursor-plugin/rules/session-start.mdc"), "utf8");
    expect(rule).toContain(join(dest, "skills/poteto-mode/SKILL.md"));
    expect(rule).not.toContain("${CURSOR_PLUGIN_ROOT}");
    const copy = fingerprint(dest);

    const again = runInstaller(home, ["install", "--cursor", "--source", repoRoot, "--json"]);
    expect(again.status, again.stderr).toBe(0);
    const rerun = JSON.parse(again.stdout).homes.find((row) => row.harness === "cursor");
    expect(rerun.steps).toEqual([]);
    expect(fingerprint(dest)).toEqual(copy);

    const doctor = runInstaller(home, ["doctor", "--cursor", "--json"]);
    expect(doctor.status, doctor.stderr).toBe(0);
    const checked = JSON.parse(doctor.stdout);
    expect(checked.failed).toBe(0);
    const warnings = checked.homes.find((row) => row.harness === "cursor").checks.filter((row) => row.name === "other plugins" && row.warn);
    expect(warnings.map((row) => row.detail)).toEqual([
      expect.stringContaining("pstack at"),
      expect.stringContaining("other-plugin at"),
    ]);
    expect(warnings.every((row) => row.fix === "none needed; this installer never changes other plugins")).toBe(true);
    expect(fingerprint(dest)).toEqual(copy);

    const removed = runInstaller(home, ["uninstall", "--cursor", "--json"]);
    expect(removed.status, removed.stderr).toBe(0);
    const gone = JSON.parse(removed.stdout).homes.find((row) => row.harness === "cursor");
    expect(gone.steps[0]).toBe(`removed ${version} from plugins/local/t3-pstack-science`);
    expect(readdirSync(join(home, ".cursor/plugins/local")).sort()).toEqual(["other-plugin"]);
    expect(fingerprint(join(home, ".cursor/plugins/cache"))).toEqual(
      seeded.filter((row) => row.startsWith("plugins/cache/")).map((row) => row.slice("plugins/cache/".length)),
    );
  });

  test("a remote --source other than this repo is a usage error and writes nothing", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const before = fingerprint(join(home, ".cursor"));
    const r = runInstaller(home, ["install", "--cursor", "--source", "someone/else"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("someone/else");
    expect(fingerprint(join(home, ".cursor"))).toEqual(before);
    expect(existsSync(join(home, ".cursor/plugins/local/t3-pstack-science"))).toBe(false);
  });

  test("uninstall --cursor removes our copy without reading the plugin source or the sheet", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    expect(runInstaller(home, ["install", "--cursor"]).status).toBe(0);
    mkdirSync(join(home, ".config/t3-pstack-science"), { recursive: true });
    writeFileSync(join(home, ".config/t3-pstack-science/models.md"), "bug-fix: nope\n");
    const notAPlugin = tmp();
    const text = runInstaller(home, ["uninstall", "--cursor", "--source", notAPlugin]);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).toBe(
      ["t3-pstack-science uninstall --cursor", "", "Cursor  ~/.cursor  (default, T3 instance cursor_main, T3 instance cursor_other (disabled))", `  - removed ${version} from plugins/local/t3-pstack-science`, ""].join("\n"),
    );
    expect(readdirSync(join(home, ".cursor/plugins/local"))).toEqual(["other-plugin"]);
    const json = runInstaller(home, ["uninstall", "--cursor", "--json"]);
    expect(json.status, json.stderr).toBe(0);
    expect(JSON.parse(json.stdout)).toEqual({
      command: "uninstall",
      homes: [
        {
          harness: "cursor",
          dir: join(home, ".cursor"),
          from: ["default", "T3 instance cursor_main", "T3 instance cursor_other (disabled)"],
          steps: ["nothing to remove"],
          checks: [],
        },
      ],
      failed: 0,
    });
  });

  test("uninstall --cursor exits 1 and changes nothing when the folder is not ours", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const dest = join(home, ".cursor/plugins/local/t3-pstack-science");
    mkdirSync(dest);
    writeFileSync(join(dest, "theirs.txt"), "theirs\n");
    const before = fingerprint(join(home, ".cursor"));
    const r = runInstaller(home, ["uninstall", "--cursor", "--json"]);
    expect(r.status, r.stderr).toBe(1);
    const [row] = JSON.parse(r.stdout).homes;
    expect(row.checks).toEqual([
      expect.objectContaining({
        name: "uninstall",
        ok: false,
        fix: `move or rename \`${dest}\`; this installer never changes a folder it did not create`,
      }),
    ]);
    expect(fingerprint(join(home, ".cursor"))).toEqual(before);
  });

  test.skipIf(!chmodDenies)("an uninstall --cursor failure with no fix of its own says to rerun uninstall", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    const local = join(home, ".cursor/plugins/local");
    mkdirSync(local, { recursive: true });
    chmodSync(local, 0o555);
    let r;
    try {
      r = runInstaller(home, ["uninstall", "--cursor", "--json"]);
    } finally {
      chmodSync(local, 0o755);
    }
    expect(r.status, r.stderr).toBe(1);
    expect(JSON.parse(r.stdout).homes[0].checks).toEqual([
      expect.objectContaining({
        name: "uninstall",
        ok: false,
        detail: expect.stringContaining("EACCES"),
        fix: "rerun `npx -y github:huankoh/t3-pstack-science uninstall --cursor`",
      }),
    ]);
  });

  test("install --cursor names the fix for a folder that is not ours and for a lock another run holds", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const local = join(home, ".cursor/plugins/local");
    const dest = join(local, "t3-pstack-science");
    const cursorCheck = (r) => JSON.parse(r.stdout).homes.find((row) => row.harness === "cursor").checks;
    mkdirSync(dest);
    writeFileSync(join(dest, "theirs.txt"), "theirs\n");
    const foreign = runInstaller(home, ["install", "--cursor", "--json"]);
    expect(foreign.status, foreign.stderr).toBe(1);
    expect(cursorCheck(foreign)).toEqual([
      expect.objectContaining({
        name: "install",
        ok: false,
        fix: `move or rename \`${dest}\`; this installer never changes a folder it did not create`,
      }),
    ]);

    rmSync(dest, { recursive: true });
    const lock = join(local, ".t3-pstack-science.lock");
    mkdirSync(lock);
    const busyFix = lockFix(lock);
    const busy = runInstaller(home, ["install", "--cursor", "--json"]);
    expect(busy.status, busy.stderr).toBe(1);
    expect(cursorCheck(busy)).toEqual([expect.objectContaining({ name: "install", ok: false, fix: busyFix })]);
    const busyUninstall = runInstaller(home, ["uninstall", "--cursor", "--json"]);
    expect(busyUninstall.status, busyUninstall.stderr).toBe(1);
    expect(cursorCheck(busyUninstall)).toEqual([expect.objectContaining({ name: "uninstall", ok: false, fix: busyFix })]);
    expect(existsSync(dest), "nothing installed while the lock is held").toBe(false);
  });

  test("uninstall without --cursor is a usage error and writes nothing", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const before = fingerprint(join(home, ".cursor"));
    const r = runInstaller(home, ["uninstall"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("usage:");
    expect(fingerprint(join(home, ".cursor"))).toEqual(before);
  });

  test("a local source without a Cursor manifest still serves Claude Code and Codex, and --cursor rejects it before writing", () => {
    const home = tmp();
    mkdirSync(join(home, "empty-bin"));
    mkdirSync(join(home, "tmp"));
    seedCursor(home);
    const source = tmp();
    for (const name of [".claude-plugin", ".agents", "tools"]) symlinkSync(join(repoRoot, name), join(source, name));
    mkdirSync(join(source, "plugins/pstack"), { recursive: true });
    for (const name of readdirSync(join(repoRoot, "plugins/pstack"))) {
      if (name === ".cursor-plugin") continue;
      symlinkSync(join(repoRoot, "plugins/pstack", name), join(source, "plugins/pstack", name));
    }
    const before = fingerprint(join(home, ".cursor"));
    const plain = runInstaller(home, ["install", "--source", source, "--json"]);
    expect(plain.status, plain.stderr).toBe(0);
    expect(plain.stderr).not.toContain(".cursor-plugin");
    expect(fingerprint(join(home, ".cursor"))).toEqual(before);
    const rejected = runInstaller(home, ["install", "--cursor", "--source", source]);
    expect(rejected.status).toBe(2);
    expect(rejected.stderr).toContain(join(source, "plugins/pstack/.cursor-plugin/plugin.json"));
    expect(fingerprint(join(home, ".cursor"))).toEqual(before);
  });
});
