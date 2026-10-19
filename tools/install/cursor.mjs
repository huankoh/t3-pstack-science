// The SDK loads every non-dot directory in plugins/local and rejects a symlink
// that leaves the folder, so the copy is a real directory and its staging and
// lock names start with a dot.
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, posix, sep } from "node:path";

import { check, PLUGIN_ID } from "./common.mjs";

const PLUGIN_NAME = PLUGIN_ID.split("@")[0];
const LOCAL_DIR = "plugins/local";
const DEST_NAME = PLUGIN_NAME;
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const LEFTOVER = new RegExp(`^\\.${PLUGIN_NAME}\\.${UUID}\\.(?:tmp|old)$`);
const RULE_PATH = ".cursor-plugin/rules/session-start.mdc";
const MANIFEST_PATH = ".cursor-plugin/plugin.json";
const COPY_ROOTS = ["skills", "agents", "models.json", ".cursor-plugin"];
const SKIP = new Set(["node_modules", ".DS_Store"]);
const LOCK_NAME = `.${PLUGIN_NAME}.lock`;
const LOCK_OWNER = "owner";
export const CURSOR_INSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science install --cursor`";
export const CURSOR_UNINSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science uninstall --cursor`";
const LEFTOVERS_FIX =
  "rerun `npx -y github:huankoh/t3-pstack-science install --cursor` or `npx -y github:huankoh/t3-pstack-science uninstall --cursor`; either removes them";
const OTHER_FIX = "none needed; this installer never changes other plugins";

const modeOf = (st) => ((st.mode & 0o111) !== 0 ? 0o755 : 0o644);
const sameFile = (left, right) =>
  Boolean(
    left && right && left.mode === right.mode && Buffer.isBuffer(left.bytes) && Buffer.isBuffer(right.bytes) && left.bytes.equals(right.bytes),
  );

function wantVersion(tree) {
  const file = tree.get(MANIFEST_PATH);
  if (!file) throw new Error(`${MANIFEST_PATH} is missing from the Cursor copy`);
  return JSON.parse(file.bytes.toString("utf8")).version;
}

function walk(abs, rel, visit) {
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) return visit.symlink(rel);
  if (st.isDirectory()) {
    for (const name of readdirSync(abs).sort()) {
      if (SKIP.has(name)) continue;
      walk(join(abs, name), rel ? `${rel}/${name}` : name, visit);
    }
    return;
  }
  if (!st.isFile()) return visit.other(rel);
  visit.file(rel, st, abs);
}

export function cursorTree(pluginRoot, { dest, sessionRule }) {
  if (!isAbsolute(dest)) throw new Error("dest must be an absolute path");
  const tree = new Map();
  const visit = {
    symlink(rel) {
      throw new Error(`${rel} is a symlink; the Cursor SDK only loads a real directory`);
    },
    other(rel) {
      throw new Error(`${rel} is not a regular file`);
    },
    file(rel, st, abs) {
      if (rel === RULE_PATH && !sessionRule) return;
      let bytes = readFileSync(abs);
      if (rel === RULE_PATH) bytes = Buffer.from(bytes.toString("utf8").split("${CURSOR_PLUGIN_ROOT}").join(dest.split(sep).join(posix.sep)));
      tree.set(rel, { bytes, mode: modeOf(st) });
    },
  };
  for (const root of COPY_ROOTS) {
    const abs = join(pluginRoot, root);
    if (!lstatSync(abs, { throwIfNoEntry: false })) throw new Error(`${root} is missing from the plugin`);
    walk(abs, root, visit);
  }
  if (sessionRule && !tree.has(RULE_PATH)) throw new Error(`${RULE_PATH} is missing from the plugin`);
  return tree;
}

function installedTree(dest) {
  const tree = new Map();
  const visit = {
    symlink(rel) {
      tree.set(rel, { bytes: null, mode: 0 });
    },
    other(rel) {
      tree.set(rel, { bytes: null, mode: 0 });
    },
    file(rel, st, abs) {
      tree.set(rel, { bytes: readFileSync(abs), mode: modeOf(st) });
    },
  };
  walk(dest, "", visit);
  return tree;
}

export function treeDiff(want, have) {
  const differ = [];
  for (const path of [...new Set([...want.keys(), ...have.keys()])].sort()) {
    if (!sameFile(want.get(path), have.get(path))) differ.push(path);
  }
  return differ;
}

export function readCopy(dest) {
  const st = lstatSync(dest, { throwIfNoEntry: false });
  if (!st) return { kind: "absent" };
  if (st.isSymbolicLink()) return { kind: "foreign", why: "a symlink" };
  if (!st.isDirectory()) return { kind: "foreign", why: "not a directory" };
  const manifestDir = lstatSync(join(dest, dirname(MANIFEST_PATH)), { throwIfNoEntry: false });
  if (!manifestDir) return { kind: "foreign", why: "no manifest" };
  if (!manifestDir.isDirectory()) return { kind: "foreign", why: `${dirname(MANIFEST_PATH)} is not a directory` };
  const manifestPath = join(dest, MANIFEST_PATH);
  const manifestStat = lstatSync(manifestPath, { throwIfNoEntry: false });
  if (!manifestStat) return { kind: "foreign", why: "no manifest" };
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile()) return { kind: "foreign", why: "manifest is not a file" };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    if (err instanceof SyntaxError) return { kind: "foreign", why: "manifest is not JSON" };
    throw err;
  }
  if (manifest?.name !== PLUGIN_NAME) return { kind: "foreign", why: `manifest name ${JSON.stringify(manifest?.name ?? null)}` };
  return { kind: "ours", version: manifest.version ?? null, tree: installedTree(dest) };
}

function writeTree(root, tree) {
  mkdirSync(root, { recursive: true });
  for (const [rel, file] of tree) {
    const path = join(root, ...rel.split("/"));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.bytes, { mode: file.mode });
    chmodSync(path, file.mode);
  }
}

const lockFix = (lock, rerun = "rerun") => `if no t3-pstack-science install or uninstall is running, remove \`${lock}\` and ${rerun}`;
const ago = (ms) => (ms < 3600000 ? count(Math.floor(ms / 60000), "minute") : count(Math.floor(ms / 3600000), "hour"));

function lockOwner(lock) {
  try {
    const { pid, started } = JSON.parse(readFileSync(join(lock, LOCK_OWNER), "utf8"));
    return ` (pid ${pid}, started ${ago(Date.now() - Date.parse(started))} ago)`;
  } catch {
    return "";
  }
}

const busy = (lock) => Object.assign(new Error(`another install or uninstall holds ${lock}${lockOwner(lock)}`), { fix: lockFix(lock) });
const lostClaim = (err) => err.code === "EEXIST" || err.code === "ENOENT";

function claim(lock, owner, write) {
  try {
    mkdirSync(lock);
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
  const path = join(lock, LOCK_OWNER);
  let created = false;
  try {
    const fd = openSync(path, "wx");
    created = true;
    try {
      write(fd, owner);
    } finally {
      closeSync(fd);
    }
    return true;
  } catch (err) {
    if (!created && lostClaim(err)) return false;
    try {
      if (created) unlinkSync(path);
      rmdirSync(lock);
    } catch {
      err.fix = lockFix(lock);
    }
    throw err;
  }
}

function release(lock, owner) {
  try {
    if (readFileSync(join(lock, LOCK_OWNER), "utf8") !== owner) return;
  } catch {
    return;
  }
  rmSync(lock, { recursive: true, force: true });
}

function withLock(local, run, write = writeFileSync) {
  const lock = join(local, LOCK_NAME);
  const owner = `${JSON.stringify({ token: randomUUID(), pid: process.pid, started: new Date().toISOString() })}\n`;
  if (!claim(lock, owner, write)) throw busy(lock);
  try {
    return run();
  } finally {
    release(lock, owner);
  }
}

function sweepUnderLock(local) {
  let names;
  try {
    names = leftoverNames(local);
  } catch (err) {
    return [`could not list leftovers: ${err.message}`];
  }
  let removed = 0;
  const failed = [];
  for (const name of names) {
    try {
      rmSync(join(local, name), { recursive: true, force: true });
      removed += 1;
    } catch (err) {
      failed.push(`${name}: ${err.code ?? err.message}`);
    }
  }
  const steps = [];
  if (removed) steps.push(`removed ${count(removed, "leftover")}`);
  if (failed.length) steps.push(`could not remove ${count(failed.length, "leftover")} (${failed.join(", ")})`);
  return steps;
}

function discardOrLeaveForSweep(path) {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
}

const foreignFix = (dest) => `move or rename \`${dest}\`; this installer never changes a folder it did not create`;
const notOurs = (have, dest) =>
  Object.assign(new Error(`${LOCAL_DIR}/${DEST_NAME} is not ours (${have.why}); left it untouched`), { fix: foreignFix(dest) });
const staging = (local, kind) => join(local, `.${PLUGIN_NAME}.${randomUUID()}.${kind}`);
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function publish(local, dest, have, want, rename) {
  const tmp = staging(local, "tmp");
  const old = staging(local, "old");
  let moved = false;
  try {
    writeTree(tmp, want);
    if (have.kind === "ours") {
      rename(dest, old);
      moved = true;
    }
    rename(tmp, dest);
  } catch (err) {
    try {
      if (moved && !lstatSync(dest, { throwIfNoEntry: false })) rename(old, dest);
    } catch (restoreErr) {
      err.cause = restoreErr;
    }
    discardOrLeaveForSweep(tmp);
    throw err;
  }
  if (moved) discardOrLeaveForSweep(old);
}

function installSteps(have, want, differ, sessionRule) {
  const version = wantVersion(want);
  const steps = [];
  if (have.kind === "absent") steps.push(`installed ${version} in ${LOCAL_DIR}/${DEST_NAME}`);
  else if (have.version !== version) steps.push(`updated ${have.version} to ${version}`);
  else steps.push(`rewrote ${count(differ.length, "file")} that differed from ${version}`);
  if (!sessionRule) steps.push("left out the session rule, since the sheet says session hook: off");
  return steps;
}

export function installCursor(target, ctx) {
  const local = join(target.dir, LOCAL_DIR);
  const dest = join(local, DEST_NAME);
  const { rename = renameSync, write = writeFileSync } = ctx.testHooks ?? {};
  mkdirSync(local, { recursive: true });
  return withLock(local, () => {
    const have = readCopy(dest);
    if (have.kind === "foreign") throw notOurs(have, dest);
    const sessionRule = !ctx.sessionHookOff;
    const want = cursorTree(ctx.pluginRoot, { dest, sessionRule });
    const differ = treeDiff(want, have.kind === "ours" ? have.tree : new Map());
    const steps = [];
    if (differ.length) {
      publish(local, dest, have, want, rename);
      steps.push(...installSteps(have, want, differ, sessionRule));
    }
    return [...steps, ...sweepUnderLock(local)];
  }, write);
}

function skillNames(tree) {
  return new Set([...tree.keys()].filter((path) => path.startsWith("skills/")).map((path) => path.split("/")[1]));
}

function directoryNames(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

function pluginSkills(root) {
  const skills = join(root, "skills");
  const st = lstatSync(skills, { throwIfNoEntry: false });
  if (!st?.isDirectory() || st.isSymbolicLink()) return [];
  return readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !SKIP.has(entry.name))
    .map((entry) => entry.name);
}

function manifestName(root) {
  try {
    const name = JSON.parse(readFileSync(join(root, MANIFEST_PATH), "utf8"))?.name;
    return typeof name === "string" && name ? name : null;
  } catch {
    return null;
  }
}

// The SDK writes marketplace plugins at plugins/cache/<publisher>/<name>/<rev>.
function cachePlugins(cache) {
  const found = [];
  for (const publisher of directoryNames(cache) ?? []) {
    if (!publisher.isDirectory() || publisher.isSymbolicLink()) continue;
    for (const name of directoryNames(join(cache, publisher.name)) ?? []) {
      if (!name.isDirectory() || name.isSymbolicLink()) continue;
      for (const rev of directoryNames(join(cache, publisher.name, name.name)) ?? []) {
        if (!rev.isDirectory() || rev.isSymbolicLink()) continue;
        const where = join(cache, publisher.name, name.name, rev.name);
        found.push({ name: manifestName(where) ?? name.name, where });
      }
    }
  }
  return found;
}

function otherPluginChecks(cursorHome, ours) {
  const checks = [];
  const cache = join(cursorHome, "plugins/cache");
  const cacheEntries = directoryNames(cache);
  if (!cacheEntries) {
    checks.push(check("other plugins", true, "plugins/cache is absent, which is not proof that no other plugin is installed"));
  }
  const plugins = cacheEntries ? cachePlugins(cache) : [];
  const local = directoryNames(join(cursorHome, LOCAL_DIR)) ?? [];
  for (const entry of local) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".") || entry.name === DEST_NAME) continue;
    plugins.push({ name: entry.name, where: join(cursorHome, LOCAL_DIR, entry.name) });
  }
  let overlaps = 0;
  for (const plugin of plugins) {
    const shared = pluginSkills(plugin.where).filter((name) => ours.has(name)).sort();
    if (!shared.length) continue;
    overlaps += 1;
    checks.push(
      check(
        "other plugins",
        false,
        `${plugin.name} at ${plugin.where} shares ${count(shared.length, "skill name")} (${shared.slice(0, 5).join(", ")}). The session rule names our skills by path.`,
        OTHER_FIX,
        true,
      ),
    );
  }
  if (cacheEntries && overlaps === 0) checks.push(check("other plugins", true, "no other plugin shares a skill name"));
  return checks;
}

function leftoverNames(local) {
  return (directoryNames(local) ?? []).map((entry) => entry.name).filter((name) => LEFTOVER.test(name));
}

export function doctorCursor(target, ctx) {
  const local = join(target.dir, LOCAL_DIR);
  const dest = join(local, DEST_NAME);
  const have = readCopy(dest);
  const sessionRule = !ctx.sessionHookOff;
  const want = cursorTree(ctx.pluginRoot, { dest, sessionRule });
  const differ = have.kind === "ours" ? treeDiff(want, have.tree) : [];
  const version = wantVersion(want);
  let installed;
  if (have.kind === "absent") installed = check("installed", false, "not installed", CURSOR_INSTALL_HINT);
  else if (have.kind === "foreign") installed = check("installed", false, have.why, foreignFix(dest));
  else if (have.version !== version) installed = check("installed", false, `${have.version}, wanted ${version}`, CURSOR_INSTALL_HINT);
  else if (differ.length) {
    const noun = differ.length === 1 ? "file differs" : "files differ";
    installed = check("installed", false, `${differ.length} ${noun} (first 5: ${differ.slice(0, 5).join(", ")})`, CURSOR_INSTALL_HINT);
  } else installed = check("installed", true, `${have.version} at ${dest}`);

  const leftovers = leftoverNames(local);
  const leftover = leftovers.length
    ? check("leftovers", false, leftovers.join(", "), LEFTOVERS_FIX, true)
    : check("leftovers", true, "none");
  const lock = join(local, LOCK_NAME);
  const lockChecks = lstatSync(lock, { throwIfNoEntry: false })
    ? [check("lock", false, `${LOCAL_DIR}/${LOCK_NAME} exists${lockOwner(lock)}`, lockFix(lock, CURSOR_INSTALL_HINT), true)]
    : [];
  const ruleChecks = [];
  if (have.kind === "ours") {
    const haveRule = have.tree.has(RULE_PATH);
    ruleChecks.push(
      haveRule === sessionRule
        ? check("session rule", true, sessionRule ? "installed" : "left out, since the sheet says session hook: off")
        : check(
            "session rule",
            false,
            haveRule ? "present, but the sheet says session hook: off" : "absent, and the sheet does not say session hook: off",
            CURSOR_INSTALL_HINT,
            true,
          ),
    );
  }
  return [installed, ...lockChecks, ...ruleChecks, ...otherPluginChecks(target.dir, skillNames(want)), leftover];
}

export function uninstallCursor(target) {
  const local = join(target.dir, LOCAL_DIR);
  const dest = join(local, DEST_NAME);
  if (!lstatSync(local, { throwIfNoEntry: false })) return ["nothing to remove"];
  return withLock(local, () => {
    const have = readCopy(dest);
    if (have.kind === "absent") return ["nothing to remove", ...sweepUnderLock(local)];
    if (have.kind === "foreign") throw notOurs(have, dest);
    const old = staging(local, "old");
    renameSync(dest, old);
    discardOrLeaveForSweep(old);
    return [`removed ${have.version} from ${LOCAL_DIR}/${DEST_NAME}`, ...sweepUnderLock(local)];
  });
}
