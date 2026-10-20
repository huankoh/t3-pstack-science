import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { check, readJson, runCli, writeAtomic } from "./common.mjs";
import { APPROVED, NAME, agentNames, capabilities, parseActivation, parseHookResult, parseInfo, parseRecord, parseRecords, sessionFixture, unsupported } from "./muse-output.mjs";

const STATE = "t3-pstack-science-installer.json";
export const MUSE_INSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science install --muse`";
export const MUSE_UNINSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science uninstall --muse`";
const DUPLICATE_FIX = "list records with `muse plugins list --json`, then run `muse plugins remove t3-pstack-science` for each stale one";
const cli = (target, args) => runCli(target.bin, args);
function json(target, args) {
  const text = cli(target, [...args, "--json"]);
  try { return JSON.parse(text); } catch { throw unsupported(args.join(" ")); }
}
const records = (target) => parseRecords(json(target, ["plugins", "list"]));
const inspect = (target) => parseInfo(json(target, ["plugins", "inspect", NAME]));
const git = (target) => parseActivation(json(target, ["skills", "inspect", "git", "--source", "built-in"]));
const statePath = (target) => join(target.dir, STATE);
const state = (target) => existsSync(statePath(target)) ? readJson(statePath(target)) : {};
const save = (target, value) => {
  mkdirSync(target.dir, { recursive: true });
  const text = `${JSON.stringify(value)}\n`;
  if (!existsSync(statePath(target)) || readFileSync(statePath(target), "utf8") !== text) writeAtomic(statePath(target), text);
};
const clear = (target) => rmSync(statePath(target), { force: true });
const canonical = (path) => existsSync(path) ? realpathSync(path) : resolve(path);

function treeDigest(root) {
  const hash = createHash("sha256");
  function walk(relative) {
    const path = join(root, relative);
    const st = lstatSync(path);
    if (st.isDirectory()) {
      for (const name of readdirSync(path).sort()) {
        if ([".git", "node_modules", ".DS_Store"].includes(name)) continue;
        walk(relative ? `${relative}/${name}` : name);
      }
    } else if (st.isSymbolicLink()) {
      hash.update(JSON.stringify([relative, "symlink", readlinkSync(path)]));
    } else if (st.isFile()) {
      hash.update(JSON.stringify([relative, Boolean(st.mode & 0o111), st.size]));
      hash.update(readFileSync(path));
    } else throw new Error(`${path} is not a regular file, symlink, or directory`);
  }
  walk("");
  return hash.digest("hex");
}

function samePackage(record, ctx) {
  return record.version === ctx.version && existsSync(record.cache_path)
    && treeDigest(ctx.pluginRoot) === treeDigest(record.cache_path);
}

function identity(record) {
  return { id: record.id, version: record.version, packageSha256: record.package_sha256,
    cachePath: record.cache_path, source: { ...record.source }, trust: record.trust, scope: "user" };
}

function matchesReceipt(record, receipt) {
  const expected = receipt.plugin;
  const actual = identity(record);
  return expected && Object.entries(actual).every(([key, value]) => key === "source"
    ? expected.source?.provenance === value.provenance && expected.source?.path === value.path
    : expected[key] === value);
}

function requireUserScope(target, record) {
  // Muse 1.4 exposes no scope in CLI records; confirm its user registry and cache.
  const registryPath = join(target.pluginsDir, "installed.json");
  const registry = existsSync(registryPath) ? readJson(registryPath) : null;
  const user = registry?.plugins?.[NAME];
  const cache = relative(canonical(join(target.pluginsDir, "cache")), canonical(record.cache_path));
  if ((record.scope !== undefined && record.scope !== "user") || record.trust !== "user-local"
    || cache === ".." || cache.startsWith(`..${sep}`) || isAbsolute(cache)
    || !user || user.id !== NAME || user.version !== record.version || user.package_sha256 !== record.package_sha256
    || user.trust !== record.trust || user.source?.provenance !== record.source.provenance || user.source?.path !== record.source.path) {
    throw new Error("Muse t3-pstack-science record must be installed at user scope with user-local trust");
  }
}

function requireManaged(target, record, receipt, ctx) {
  requireUserScope(target, record);
  const explicit = ctx?.explicitSource && record.source.provenance === "foreign-import"
    && canonical(record.source.path) === canonical(ctx.pluginRoot);
  if (!matchesReceipt(record, receipt) && !explicit) {
    throw Object.assign(new Error(`Muse t3-pstack-science record is not managed by this installer (${record.source.provenance}: ${record.source.path})`), {
      fix: "if you trust this source, install with an explicit --source naming it; otherwise remove the record with `muse plugins remove t3-pstack-science`",
    });
  }
}

function singleRecord(found) {
  if (found.length > 1) throw Object.assign(new Error("multiple t3-pstack-science records"), { fix: DUPLICATE_FIX });
  return found[0];
}

export function installMuse(target, ctx) {
  const steps = [];
  const activation = git(target);
  const record = singleRecord(records(target));
  let receipt = state(target);
  const names = agentNames(ctx.pluginRoot);
  if (record) {
    requireManaged(target, record, receipt, ctx);
    capabilities(inspect(target), names);
    if (!matchesReceipt(record, receipt)) receipt = {};
  } else {
    clear(target);
    receipt = {};
  }
  if (!record || !samePackage(record, ctx)) {
    const result = json(target, ["plugins", "install", ctx.pluginRoot, "--scope", "user"]);
    parseRecord(result?.installed);
    steps.push(!record ? `installed Muse ${ctx.version}` : record.version === ctx.version ? `refreshed Muse ${ctx.version}` : `updated Muse ${record.version} to ${ctx.version}`);
  }
  let info = inspect(target);
  requireUserScope(target, info.record);
  if (!samePackage(info.record, ctx)) throw new Error("Muse cached package differs from this release; no capabilities were approved");
  receipt = { plugin: { ...identity(info.record), contentDigest: treeDigest(info.record.cache_path) }, disabledBuiltinGit: receipt.disabledBuiltinGit === true };
  save(target, receipt);
  if (!info.record.enabled) {
    json(target, ["plugins", "enable", NAME]);
    steps.push(`enabled Muse ${NAME}`);
    info = inspect(target);
  }
  const caps = capabilities(info, names);
  if ([caps.hook, ...caps.agents].some((cap) => cap.status === "missing")) throw unsupported("missing runtime capability");
  for (const cap of [caps.hook, ...caps.agents]) {
    if (APPROVED.has(cap.status)) continue;
    json(target, ["plugins", "approve", cap.id]);
    steps.push(`approved ${cap.id}`);
  }
  if (activation === "on") {
    cli(target, ["skills", "disable", "git", "--scope", "built-in"]);
    receipt.disabledBuiltinGit = true;
    save(target, receipt);
    steps.push("disabled Muse's built-in git skill");
  }
  return steps;
}

function hookTest(target, ctx, hook) {
  const dir = mkdtempSync(join(tmpdir(), "t3-pstack-science-muse-hook-"));
  try {
    cli(target, ["schema", "generate-json-schema", "--out", join(dir, "schema")]);
    let schema;
    try { schema = readJson(join(dir, "schema/msp.schema.json")); } catch { throw unsupported("schema msp.schema.json"); }
    const fixture = join(dir, "session-start.json");
    writeFileSync(fixture, JSON.stringify(sessionFixture(schema, hook, dir)));
    const result = parseHookResult(json(target, ["plugins", "hook", "test", hook.id, "--fixture", fixture]));
    const ran = result.terminals.length > 0 && result.terminals.every((t) => t.status === "completed" && t.exit_code === 0);
    const contexts = result.decision.additional_contexts;
    const context = readFileSync(join(ctx.pluginRoot, "hooks/session-start-context.md"), "utf8").trimEnd();
    const carriesContext = contexts.some((text) => text.trimEnd() === context);
    const ok = ran && (ctx.sessionHookOff ? contexts.length === 0 : carriesContext);
    return check("session context", ok, ok
      ? ctx.sessionHookOff ? "hook test passed; context disabled by session hook: off" : "hook test passed; additional_contexts carries the shared session context"
      : "hook test did not deliver the expected session context", MUSE_INSTALL_HINT);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function doctorMuse(target, ctx) {
  const checks = [check("CLI", true, `${target.bin}: ${cli(target, ["--version"]).trim()}`)];
  const found = records(target);
  if (found.length !== 1) return [...checks, check("installed", false, found.length ? "multiple t3-pstack-science records" : "not installed", found.length ? DUPLICATE_FIX : MUSE_INSTALL_HINT),
    check("session context", false, "skipped: no unique installed package to validate", found.length ? DUPLICATE_FIX : MUSE_INSTALL_HINT)];
  const info = inspect(target);
  requireUserScope(target, info.record);
  const installed = info.valid && info.active && info.record.enabled && samePackage(info.record, ctx);
  checks.push(check("installed", Boolean(installed), installed ? `${ctx.version}, enabled and active` : `${info.record.version}, wanted ${ctx.version}, enabled=${info.record.enabled}, active=${info.active}; package must match`, MUSE_INSTALL_HINT));
  const caps = capabilities(info, agentNames(ctx.pluginRoot));
  const hookApproved = APPROVED.has(caps.hook.status);
  checks.push(check("session hook approved", hookApproved, `${caps.hook.id}: ${caps.hook.status}`, MUSE_INSTALL_HINT));
  checks.push(check("agents approved", caps.agents.every((cap) => APPROVED.has(cap.status)), caps.agents.map((cap) => `${cap.id}: ${cap.status}`).join(", "), MUSE_INSTALL_HINT));
  const gitOff = git(target) === "off";
  checks.push(check("built-in git", gitOff, gitOff ? "disabled" : "enabled", MUSE_INSTALL_HINT));
  if (!installed || !hookApproved) {
    checks.push(check("session context", false, `skipped: ${[!installed && "installed package identity or active state failed validation", !hookApproved && "session hook is not approved"].filter(Boolean).join("; ")}`, MUSE_INSTALL_HINT));
  } else {
    try {
      checks.push(hookTest(target, ctx, caps.hook));
    } catch (err) {
      checks.push(check("session context", false, err.message, err.fix ?? MUSE_INSTALL_HINT));
    }
  }
  return checks;
}

export function uninstallMuse(target) {
  const steps = [];
  const activation = git(target);
  const record = singleRecord(records(target));
  const receipt = state(target);
  if (record) requireManaged(target, record, receipt);
  if (!record && receipt.uninstallPending !== true) {
    clear(target);
    return ["nothing to remove"];
  }
  if (record) {
    if (receipt.disabledBuiltinGit === true) {
      receipt.uninstallPending = true;
      save(target, receipt);
    }
    json(target, ["plugins", "remove", NAME]);
    steps.push(`removed Muse ${NAME}`);
  }
  if (receipt.disabledBuiltinGit === true && (record || receipt.uninstallPending === true) && activation === "off") {
    cli(target, ["skills", "enable", "git", "--scope", "built-in"]);
    steps.push("re-enabled Muse's built-in git skill");
  }
  clear(target);
  return steps.length ? steps : ["nothing to remove"];
}
