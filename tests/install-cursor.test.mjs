import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cursorTree, doctorCursor, installCursor, readCopy, treeDiff, uninstallCursor } from "../tools/install/cursor.mjs";
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

const RULE = ".cursor-plugin/rules/session-start.mdc";
const ruleText = "Read `${CURSOR_PLUGIN_ROOT}/skills/poteto-mode/SKILL.md`.\nKeep this sentence.\n";

function plugin() {
  const root = tmp();
  mkdirSync(join(root, "skills/poteto-mode"), { recursive: true });
  mkdirSync(join(root, "agents"), { recursive: true });
  mkdirSync(join(root, "hooks"), { recursive: true });
  mkdirSync(join(root, ".cursor-plugin/rules"), { recursive: true });
  writeFileSync(join(root, "skills/poteto-mode/SKILL.md"), "# poteto-mode\n");
  writeFileSync(join(root, "skills/poteto-mode/run.sh"), "#!/bin/sh\n");
  chmodSync(join(root, "skills/poteto-mode/run.sh"), 0o755);
  writeFileSync(join(root, "agents/poteto-agent.md"), "# agent\n");
  writeFileSync(join(root, "models.json"), '{"domains":{}}\n');
  writeFileSync(join(root, ".cursor-plugin/plugin.json"), `${JSON.stringify({ name: "t3-pstack-science", version: "9.9.9" }, null, 2)}\n`);
  writeFileSync(join(root, RULE), ruleText);
  writeFileSync(join(root, "hooks/hooks.json"), "{}\n");
  writeFileSync(join(root, "skills/.DS_Store"), "store\n");
  mkdirSync(join(root, "skills/poteto-mode/node_modules/dep"), { recursive: true });
  writeFileSync(join(root, "skills/poteto-mode/node_modules/dep/index.js"), "module.exports = 1;\n");
  return root;
}

function thrown(run) {
  try {
    run();
  } catch (err) {
    return err;
  }
  throw new Error("expected the run to throw");
}

const doctorLockFix = (lock) => lockFix(lock, "rerun `npx -y github:huankoh/t3-pstack-science install --cursor`");
const homeOf = (root) => ({ dir: root });
const ctxFor = (pluginRoot, sessionHookOff = false) => ({ pluginRoot, sessionHookOff });
const text = (tree, rel) => tree.get(rel).bytes.toString("utf8");

describe("cursorTree", () => {
  test("copies the Cursor roots, skips hooks, node_modules, and .DS_Store, and rewrites only the rule", () => {
    const root = plugin();
    const dest = join(tmp(), ".cursor/plugins/local/t3-pstack-science");
    const tree = cursorTree(root, { dest, sessionRule: true });
    expect([...tree.keys()].sort()).toEqual([
      ".cursor-plugin/plugin.json",
      RULE,
      "agents/poteto-agent.md",
      "models.json",
      "skills/poteto-mode/SKILL.md",
      "skills/poteto-mode/run.sh",
    ]);
    expect(text(tree, "skills/poteto-mode/SKILL.md")).toBe(readFileSync(join(root, "skills/poteto-mode/SKILL.md"), "utf8"));
    expect(text(tree, RULE)).toBe(`Read \`${dest}/skills/poteto-mode/SKILL.md\`.\nKeep this sentence.\n`);
    expect(tree.get("skills/poteto-mode/run.sh").mode).toBe(0o755);
    expect(tree.get("skills/poteto-mode/SKILL.md").mode).toBe(0o644);
  });

  test("puts a destination with replacement patterns into the rule literally", () => {
    const dest = join(tmp(), "a$&b$'c$`d/.cursor/plugins/local/t3-pstack-science");
    const tree = cursorTree(plugin(), { dest, sessionRule: true });
    expect(text(tree, RULE)).toBe(`Read \`${dest}/skills/poteto-mode/SKILL.md\`.\nKeep this sentence.\n`);
  });

  test("drops the session rule when the sheet turns it off", () => {
    const dest = join(tmp(), "dest");
    const tree = cursorTree(plugin(), { dest, sessionRule: false });
    expect(tree.has(RULE)).toBe(false);
    expect(tree.has(".cursor-plugin/plugin.json")).toBe(true);
  });

  test("throws when the source contains a symlink", () => {
    const root = plugin();
    symlinkSync(join(root, "models.json"), join(root, "skills/poteto-mode/alias.json"));
    expect(() => cursorTree(root, { dest: join(tmp(), "dest"), sessionRule: true })).toThrow("symlink");
  });
});

describe("readCopy", () => {
  test("distinguishes an absent path, our manifest, and a foreign path", () => {
    const root = tmp();
    const dest = join(root, "plugins/local/t3-pstack-science");
    expect(readCopy(dest)).toEqual({ kind: "absent" });

    const elsewhere = join(root, "elsewhere");
    mkdirSync(join(root, "plugins/local"), { recursive: true });
    writeFileSync(elsewhere, "keep\n");
    symlinkSync(elsewhere, dest);
    expect(readCopy(dest)).toEqual({ kind: "foreign", why: "a symlink" });
    rmSync(dest);

    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "plugin.json"), "{}\n");
    expect(readCopy(dest).kind).toBe("foreign");
    expect(readFileSync(join(dest, "plugin.json"), "utf8")).toBe("{}\n");
  });
});

describe("install, doctor, and uninstall", () => {
  const setup = () => {
    const pluginRoot = plugin();
    const cursorHome = tmp();
    const dest = join(cursorHome, "plugins/local/t3-pstack-science");
    return { pluginRoot, cursorHome, dest, target: homeOf(cursorHome) };
  };

  test("install converges, and a rerun has no steps and writes nothing", () => {
    const { pluginRoot, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const steps = installCursor(target, ctx);
    expect(steps).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
    const before = statSync(join(dest, "models.json")).mtimeMs;
    expect(installCursor(target, ctx)).toEqual([]);
    expect(statSync(join(dest, "models.json")).mtimeMs).toBe(before);
    const copy = readCopy(dest);
    expect(copy.kind).toBe("ours");
    expect(treeDiff(cursorTree(pluginRoot, { dest, sessionRule: true }), copy.tree)).toEqual([]);
  });

  test("a tampered or extra file is reported, then repaired", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    installCursor(target, ctx);
    writeFileSync(join(dest, "skills/poteto-mode/SKILL.md"), "tampered\n");
    writeFileSync(join(dest, "extra.txt"), "extra\n");
    const doctor = doctorCursor(target, ctx);
    expect(doctor.find((row) => row.name === "installed")).toMatchObject({
      ok: false,
      detail: "2 files differ (first 5: extra.txt, skills/poteto-mode/SKILL.md)",
    });
    expect(installCursor(target, ctx)).toEqual(["rewrote 2 files that differed from 9.9.9"]);
    expect(treeDiff(cursorTree(pluginRoot, { dest, sessionRule: true }), readCopy(dest).tree)).toEqual([]);
    expect(doctorCursor(target, ctx).find((row) => row.name === "installed").ok).toBe(true);
    writeFileSync(join(dest, ".cursor-plugin/plugin.json"), `${JSON.stringify({ name: "t3-pstack-science", version: "1.0.0" })}\n`);
    expect(installCursor(target, ctx)).toEqual(["updated 1.0.0 to 9.9.9"]);
  });

  test("a failed swap puts the previous copy back and leaves no staging behind", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    installCursor(target, ctxFor(pluginRoot));
    const previous = readCopy(dest).tree;
    writeFileSync(join(pluginRoot, "skills/poteto-mode/SKILL.md"), "# poteto-mode, changed\n");
    const rename = (from, to) => {
      if (from.endsWith(".tmp")) throw Object.assign(new Error("simulated rename failure"), { code: "EIO" });
      renameSync(from, to);
    };
    expect(() => installCursor(target, { ...ctxFor(pluginRoot), testHooks: { rename } })).toThrow("simulated rename failure");
    const copy = readCopy(dest);
    expect(copy.kind).toBe("ours");
    expect(treeDiff(previous, copy.tree), "the previous copy is back in place").toEqual([]);
    expect(readdirSync(join(cursorHome, "plugins/local"))).toEqual(["t3-pstack-science"]);
  });

  test("a failed restore keeps the swap error, gives the restore error as its cause, and removes the staged tree", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const local = join(cursorHome, "plugins/local");
    installCursor(target, ctxFor(pluginRoot));
    writeFileSync(join(pluginRoot, "skills/poteto-mode/SKILL.md"), "# poteto-mode, changed\n");
    const rename = (from, to) => {
      if (from.endsWith(".tmp")) throw Object.assign(new Error("simulated swap failure"), { code: "EIO" });
      if (from.endsWith(".old")) throw Object.assign(new Error("simulated restore failure"), { code: "EIO" });
      renameSync(from, to);
    };
    let thrown;
    try {
      installCursor(target, { ...ctxFor(pluginRoot), testHooks: { rename } });
    } catch (err) {
      thrown = err;
    }
    expect(thrown?.message).toBe("simulated swap failure");
    expect(thrown.cause?.message).toBe("simulated restore failure");
    expect(readdirSync(local), "only the previous copy is left, set aside").toEqual([
      expect.stringMatching(/^\.t3-pstack-science\.[0-9a-f-]{36}\.old$/),
    ]);
    expect(installCursor(target, ctxFor(pluginRoot)), "the next run converges").toEqual([
      "installed 9.9.9 in plugins/local/t3-pstack-science",
      "removed 1 leftover",
    ]);
  });

  test("an installed node_modules under the skill scripts is not damage", () => {
    const { pluginRoot, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    installCursor(target, ctx);
    const nested = join(dest, "skills/poteto-mode/scripts/node_modules/dep/index.js");
    mkdirSync(join(nested, ".."), { recursive: true });
    writeFileSync(nested, "installed\n");
    writeFileSync(join(dest, "skills/.DS_Store"), "store\n");
    expect(doctorCursor(target, ctx).find((row) => row.name === "installed").ok).toBe(true);
    expect(installCursor(target, ctx)).toEqual([]);
    expect(readFileSync(nested, "utf8")).toBe("installed\n");
  });

  test("every generated leftover is swept under the lock, however fresh", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const local = join(cursorHome, "plugins/local");
    mkdirSync(local, { recursive: true });
    const old = join(local, `.t3-pstack-science.${randomUUID()}.old`);
    const fresh = join(local, `.t3-pstack-science.${randomUUID()}.tmp`);
    mkdirSync(old);
    mkdirSync(fresh);
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(old, past, past);
    expect(installCursor(target, ctxFor(pluginRoot))).toEqual([
      "installed 9.9.9 in plugins/local/t3-pstack-science",
      "removed 2 leftovers",
    ]);
    expect(readdirSync(local)).toEqual(["t3-pstack-science"]);
    expect(doctorCursor(target, ctxFor(pluginRoot)).find((row) => row.name === "leftovers")).toMatchObject({ ok: true });
  });

  test.skipIf(!chmodDenies)("a leftover the sweep cannot remove is reported and does not fail the run", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    const name = `.t3-pstack-science.${randomUUID()}.old`;
    const locked = join(local, name, "node_modules/pkg");
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, "index.js"), "1\n");
    chmodSync(locked, 0o555);
    try {
      const steps = installCursor(target, ctx);
      expect(steps[0]).toBe("installed 9.9.9 in plugins/local/t3-pstack-science");
      expect(steps.slice(1)).toEqual([expect.stringMatching(new RegExp(`^could not remove 1 leftover \\(${name.replaceAll(".", "\\.")}: E[A-Z]+\\)$`))]);
      expect(readCopy(join(local, "t3-pstack-science")).kind).toBe("ours");
      expect(doctorCursor(target, ctx).find((row) => row.name === "leftovers")).toMatchObject({ ok: false, warn: true, detail: name });
      expect(uninstallCursor(target)[0]).toBe("removed 9.9.9 from plugins/local/t3-pstack-science");
    } finally {
      chmodSync(locked, 0o755);
    }
    expect(installCursor(target, ctx)).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science", "removed 1 leftover"]);
  });

  test("a lock refuses install and uninstall, writes nothing, and doctor warns about it", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    installCursor(target, ctx);
    writeFileSync(join(dest, "skills/poteto-mode/SKILL.md"), "tampered\n");
    const lock = join(cursorHome, "plugins/local/.t3-pstack-science.lock");
    mkdirSync(lock);
    const before = fingerprint(join(cursorHome, "plugins"));
    for (const run of [() => installCursor(target, ctx), () => uninstallCursor(target)]) {
      expect(thrown(run)).toMatchObject({ message: `another install or uninstall holds ${lock}`, fix: lockFix(lock) });
    }
    const doctor = doctorCursor(target, ctx);
    expect(doctor.find((row) => row.name === "installed").ok).toBe(false);
    expect(doctor.map((row) => row.name).slice(0, 2), "the lock row comes before the fixes it blocks").toEqual(["installed", "lock"]);
    expect(doctor.find((row) => row.name === "lock")).toEqual({
      name: "lock",
      ok: false,
      warn: true,
      detail: "plugins/local/.t3-pstack-science.lock exists",
      fix: doctorLockFix(lock),
    });
    expect(fingerprint(join(cursorHome, "plugins")), "nothing written while the lock is held").toEqual(before);
    expect(readdirSync(join(cursorHome, "plugins/local")).sort()).toEqual([".t3-pstack-science.lock", "t3-pstack-science"]);
  });

  test("a lock of any age blocks, and no run takes over a lock it did not make", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    const lock = join(local, ".t3-pstack-science.lock");
    mkdirSync(lock, { recursive: true });
    const started = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const owner = `${JSON.stringify({ token: randomUUID(), pid: 4242, started: started.toISOString() })}\n`;
    writeFileSync(join(lock, "owner"), owner);
    utimesSync(lock, started, started);
    for (const run of [() => installCursor(target, ctx), () => uninstallCursor(target)]) {
      expect(thrown(run)).toMatchObject({
        message: `another install or uninstall holds ${lock} (pid 4242, started 2 hours ago)`,
        fix: lockFix(lock),
      });
    }
    expect(doctorCursor(target, ctx).find((row) => row.name === "lock")).toMatchObject({
      warn: true,
      detail: "plugins/local/.t3-pstack-science.lock exists (pid 4242, started 2 hours ago)",
      fix: doctorLockFix(lock),
    });
    expect(readdirSync(local), "nothing installed").toEqual([".t3-pstack-science.lock"]);
    expect(readFileSync(join(lock, "owner"), "utf8"), "the old lock is left as it was").toBe(owner);
  });

  test("a second run while one holds the lock is refused with the holder's pid, and the holder finishes", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    const lock = join(local, ".t3-pstack-science.lock");
    let second;
    const rename = (from, to) => {
      if (from.endsWith(".tmp")) second = thrown(() => installCursor(target, ctx));
      renameSync(from, to);
    };
    expect(installCursor(target, { ...ctx, testHooks: { rename } })).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
    expect(second).toMatchObject({
      message: `another install or uninstall holds ${lock} (pid ${process.pid}, started 0 minutes ago)`,
      fix: lockFix(lock),
    });
    expect(readdirSync(local), "the holder released its lock").toEqual(["t3-pstack-science"]);
    expect(readCopy(dest).kind).toBe("ours");
  });

  test("every run releases its lock, a failed one too", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const lock = join(cursorHome, "plugins/local/.t3-pstack-science.lock");
    expect(installCursor(target, ctx)).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
    expect(existsSync(lock), "released after install").toBe(false);
    expect(uninstallCursor(target)).toEqual(["removed 9.9.9 from plugins/local/t3-pstack-science"]);
    expect(existsSync(lock), "released after uninstall").toBe(false);
    mkdirSync(join(dest, ".cursor-plugin"), { recursive: true });
    writeFileSync(join(dest, ".cursor-plugin/plugin.json"), `${JSON.stringify({ name: "other" })}\n`);
    expect(() => installCursor(target, ctx)).toThrow("manifest name");
    expect(existsSync(lock), "released after a failed install").toBe(false);
  });

  test.skipIf(!chmodDenies)("a run that cannot create its owner file fails with that error and removes the lock it made", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    mkdirSync(local, { recursive: true });
    const umask = process.umask(0o277);
    let err;
    try {
      err = thrown(() => installCursor(target, ctx));
    } finally {
      process.umask(umask);
    }
    expect(err.code).toBe("EACCES");
    expect(err.message).toContain("EACCES");
    expect(err.fix, "no lock is left to remove").toBeUndefined();
    expect(readdirSync(local), "the lock this run made is gone").toEqual([]);
    expect(installCursor(target, ctx)).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
  });

  test("a run whose owner write fails removes its owner file and lock and keeps the error", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    const write = () => {
      throw Object.assign(new Error("EFBIG: file too large, write"), { code: "EFBIG" });
    };
    const err = thrown(() => installCursor(target, { ...ctx, testHooks: { write } }));
    expect(err).toMatchObject({ code: "EFBIG", message: "EFBIG: file too large, write" });
    expect(err.fix, "no lock is left to remove").toBeUndefined();
    expect(readdirSync(local), "the owner file and the lock this run made are gone").toEqual([]);
    expect(installCursor(target, ctx)).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
  });

  test("a run that cannot remove its own lock after a failed owner write names the lock fix", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const lock = join(cursorHome, "plugins/local/.t3-pstack-science.lock");
    const write = () => {
      writeFileSync(join(lock, "stray"), "");
      throw Object.assign(new Error("EFBIG: file too large, write"), { code: "EFBIG" });
    };
    const err = thrown(() => installCursor(target, { ...ctx, testHooks: { write } }));
    expect(err).toMatchObject({ code: "EFBIG", message: "EFBIG: file too large, write", fix: lockFix(lock) });
    expect(readdirSync(lock), "only the stray file is left, so the owner file this run made is gone").toEqual(["stray"]);
  });

  test("a run never removes a lock that another run holds", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const lock = join(cursorHome, "plugins/local/.t3-pstack-science.lock");
    const rename = (from, to) => {
      if (from.endsWith(".tmp")) {
        const names = readdirSync(lock);
        rmSync(lock, { recursive: true });
        mkdirSync(lock);
        for (const name of names) writeFileSync(join(lock, name), "another run\n");
      }
      renameSync(from, to);
    };
    expect(installCursor(target, { ...ctxFor(pluginRoot), testHooks: { rename } })).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
    expect(existsSync(lock), "the other run's lock survives").toBe(true);
  });

  test("a folder that only shares the leftover prefix is never swept or reported", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const local = join(cursorHome, "plugins/local");
    const backup = join(local, ".t3-pstack-science.personal-backup");
    mkdirSync(backup, { recursive: true });
    writeFileSync(join(backup, "user-data"), "mine\n");
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    utimesSync(backup, past, past);
    expect(installCursor(target, ctx)).toEqual(["installed 9.9.9 in plugins/local/t3-pstack-science"]);
    expect(doctorCursor(target, ctx).find((row) => row.name === "leftovers")).toMatchObject({ ok: true });
    expect(uninstallCursor(target)).toEqual(["removed 9.9.9 from plugins/local/t3-pstack-science"]);
    expect(readFileSync(join(backup, "user-data"), "utf8"), "the backup survives install and uninstall").toBe("mine\n");
  });

  test("a foreign destination is refused untouched", () => {
    const { pluginRoot, cursorHome, target } = setup();
    const local = join(cursorHome, "plugins/local");
    const dest = join(local, "t3-pstack-science");
    const elsewhere = join(cursorHome, "keep");
    mkdirSync(local, { recursive: true });
    writeFileSync(elsewhere, "keep\n");
    symlinkSync(elsewhere, dest);
    expect(() => installCursor(target, ctxFor(pluginRoot))).toThrow("a symlink");
    expect(readFileSync(elsewhere, "utf8")).toBe("keep\n");
    expect(lstatSync(dest).isSymbolicLink()).toBe(true);

    rmSync(dest);
    mkdirSync(join(dest, ".cursor-plugin"), { recursive: true });
    writeFileSync(join(dest, ".cursor-plugin/plugin.json"), `${JSON.stringify({ name: "other" })}\n`);
    writeFileSync(join(dest, "marker.txt"), "theirs\n");
    expect(() => installCursor(target, ctxFor(pluginRoot))).toThrow("manifest name");
    expect(() => uninstallCursor(target)).toThrow("manifest name");
    expect(readFileSync(join(dest, "marker.txt"), "utf8")).toBe("theirs\n");
  });

  test("a manifest reached through a symlink does not make a folder ours", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ours = join(cursorHome, "elsewhere/.cursor-plugin");
    mkdirSync(ours, { recursive: true });
    writeFileSync(join(ours, "plugin.json"), `${JSON.stringify({ name: "t3-pstack-science", version: "9.9.9" })}\n`);
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "user-file.txt"), "theirs\n");
    symlinkSync(ours, join(dest, ".cursor-plugin"));
    expect(readCopy(dest).kind, "symlinked .cursor-plugin").toBe("foreign");
    expect(() => installCursor(target, ctxFor(pluginRoot))).toThrow("left it untouched");
    expect(() => uninstallCursor(target)).toThrow("left it untouched");
    expect(readFileSync(join(dest, "user-file.txt"), "utf8")).toBe("theirs\n");
    expect(lstatSync(join(dest, ".cursor-plugin")).isSymbolicLink()).toBe(true);

    rmSync(join(dest, ".cursor-plugin"));
    mkdirSync(join(dest, ".cursor-plugin"));
    symlinkSync(join(ours, "plugin.json"), join(dest, ".cursor-plugin/plugin.json"));
    expect(readCopy(dest).kind, "symlinked plugin.json").toBe("foreign");
    expect(() => uninstallCursor(target)).toThrow("left it untouched");
    expect(readFileSync(join(dest, "user-file.txt"), "utf8")).toBe("theirs\n");
  });

  test("uninstall sweeps leftovers when our copy is already gone", () => {
    const { cursorHome, target } = setup();
    const local = join(cursorHome, "plugins/local");
    mkdirSync(join(local, `.t3-pstack-science.${randomUUID()}.old/skills`), { recursive: true });
    expect(uninstallCursor(target)).toEqual(["nothing to remove", "removed 1 leftover"]);
    expect(readdirSync(local), "the leftover is gone and the lock released").toEqual([]);
    expect(uninstallCursor(target)).toEqual(["nothing to remove"]);
  });

  test("uninstall then reinstall restores the same tree, and a second uninstall does nothing", () => {
    const { pluginRoot, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    installCursor(target, ctx);
    const want = cursorTree(pluginRoot, { dest, sessionRule: true });
    expect(uninstallCursor(target)).toEqual(["removed 9.9.9 from plugins/local/t3-pstack-science"]);
    expect(readCopy(dest)).toEqual({ kind: "absent" });
    expect(uninstallCursor(target)).toEqual(["nothing to remove"]);
    installCursor(target, ctx);
    expect(treeDiff(want, readCopy(dest).tree)).toEqual([]);
  });

  test("session hook off leaves the rule out and doctor warns when the copy disagrees", () => {
    const { pluginRoot, dest, target } = setup();
    const on = ctxFor(pluginRoot, false);
    const off = ctxFor(pluginRoot, true);
    expect(installCursor(target, off)).toEqual([
      "installed 9.9.9 in plugins/local/t3-pstack-science",
      "left out the session rule, since the sheet says session hook: off",
    ]);
    expect(readCopy(dest).tree.has(RULE)).toBe(false);
    const agreed = doctorCursor(target, off);
    expect(agreed.find((row) => row.name === "session rule")).toEqual({
      name: "session rule",
      ok: true,
      detail: "left out, since the sheet says session hook: off",
    });
    const drifted = doctorCursor(target, on).find((row) => row.name === "session rule");
    expect(drifted.ok).toBe(false);
    expect(drifted.warn).toBe(true);
    expect(drifted.fix).toContain("install --cursor");
  });

  test("doctor writes nothing", () => {
    const cursorHome = tmp();
    doctorCursor(homeOf(cursorHome), ctxFor(plugin()));
    expect(readdirSync(cursorHome)).toEqual([]);
  });

  test("doctor gives each failure a fix that works, and no session rule check without our copy", () => {
    const { pluginRoot, cursorHome, dest, target } = setup();
    const ctx = ctxFor(pluginRoot);
    const names = (rows) => rows.map((row) => row.name);
    const absent = doctorCursor(target, ctx);
    expect(names(absent)).not.toContain("session rule");
    expect(absent.find((row) => row.name === "installed")).toMatchObject({ ok: false, detail: "not installed" });

    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, "theirs.txt"), "theirs\n");
    const foreign = doctorCursor(target, ctx);
    expect(names(foreign)).not.toContain("session rule");
    expect(foreign.find((row) => row.name === "installed").fix).toBe(
      `move or rename \`${dest}\`; this installer never changes a folder it did not create`,
    );

    rmSync(dest, { recursive: true });
    installCursor(target, ctx);
    mkdirSync(join(cursorHome, `plugins/local/.t3-pstack-science.${randomUUID()}.tmp`));
    expect(doctorCursor(target, ctx).find((row) => row.name === "leftovers").fix).toBe(
      "rerun `npx -y github:huankoh/t3-pstack-science install --cursor` or `npx -y github:huankoh/t3-pstack-science uninstall --cursor`; either removes them",
    );
  });

  test("a missing plugin cache is not proof that no other plugin is installed", () => {
    const { pluginRoot, target } = setup();
    installCursor(target, ctxFor(pluginRoot));
    expect(doctorCursor(target, ctxFor(pluginRoot)).filter((row) => row.name === "other plugins")).toEqual([
      { name: "other plugins", ok: true, detail: "plugins/cache is absent, which is not proof that no other plugin is installed" },
    ]);
  });

  test("doctor names each other plugin that shares a skill name and does not offer to change it", () => {
    const { pluginRoot, cursorHome, target } = setup();
    installCursor(target, ctxFor(pluginRoot));
    const other = join(cursorHome, "plugins/local/other-plugin/skills/poteto-mode");
    const cached = join(cursorHome, "plugins/cache/cursor-public/9717366/abc");
    const unnamed = join(cursorHome, "plugins/cache/cursor-public/hstack/def");
    mkdirSync(other, { recursive: true });
    mkdirSync(join(cached, "skills/poteto-mode"), { recursive: true });
    mkdirSync(join(cached, ".cursor-plugin"), { recursive: true });
    mkdirSync(join(unnamed, "skills/poteto-mode"), { recursive: true });
    writeFileSync(join(cached, ".cursor-plugin/plugin.json"), `${JSON.stringify({ name: "pstack" })}\n`);
    writeFileSync(join(other, "SKILL.md"), "# theirs\n");
    const rows = doctorCursor(target, ctxFor(pluginRoot)).filter((row) => row.name === "other plugins");
    expect(rows.map(({ detail, fix, ok, warn }) => ({ detail, fix, ok, warn }))).toEqual([
      {
        ok: false,
        warn: true,
        fix: "none needed; this installer never changes other plugins",
        detail: `pstack at ${cached} shares 1 skill name (poteto-mode). The session rule names our skills by path.`,
      },
      {
        ok: false,
        warn: true,
        fix: "none needed; this installer never changes other plugins",
        detail: `hstack at ${unnamed} shares 1 skill name (poteto-mode). The session rule names our skills by path.`,
      },
      {
        ok: false,
        warn: true,
        fix: "none needed; this installer never changes other plugins",
        detail: `other-plugin at ${join(cursorHome, "plugins/local/other-plugin")} shares 1 skill name (poteto-mode). The session rule names our skills by path.`,
      },
    ]);
  });
});
