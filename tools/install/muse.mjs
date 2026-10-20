import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { check, PLUGIN_ID, readJson, runCli, writeAtomic } from "./common.mjs";

const NAME = PLUGIN_ID.split("@")[0];
const AGENTS = ["comment-sicko", "poteto-agent", "thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-review-subagent"];
const TRUSTED = "trusted_enabled";
const STATE = "t3-pstack-science-installer.json";
export const MUSE_INSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science install --muse`";
export const MUSE_UNINSTALL_HINT = "rerun `npx -y github:huankoh/t3-pstack-science uninstall --muse`";
const cli = (target, args) => runCli(target.bin, args);
const json = (target, args) => JSON.parse(cli(target, [...args, "--json"]));
const records = (target) => json(target, ["plugins", "list"]).plugins.filter(({ record }) => record.id === NAME);
const inspect = (target) => json(target, ["plugins", "inspect", NAME]);
const git = (target) => json(target, ["skills", "inspect", "git", "--source", "built-in"]).skill.activation;
const statePath = (target) => join(target.dir, STATE);
const state = (target) => existsSync(statePath(target)) ? readJson(statePath(target)) : {};

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
    } else if (st.isFile()) {
      hash.update(JSON.stringify([relative, Boolean(st.mode & 0o111), st.size]));
      hash.update(readFileSync(path));
    } else throw new Error(`${path} is not a regular file or directory`);
  }
  walk("");
  return hash.digest("hex");
}

function samePackage(record, ctx) {
  if (record.version !== ctx.version || !record.cache_path || !existsSync(record.cache_path)) return false;
  return treeDigest(ctx.pluginRoot) === treeDigest(record.cache_path);
}

function capabilities(info) {
  if (info.plugin?.id !== NAME || info.record?.id !== NAME) throw new Error("Muse inspect did not return t3-pstack-science");
  const hooks = info.plugin.capabilities.hooks.filter((hook) => hook.event === "SessionStart");
  if (hooks.length !== 1) throw new Error(`expected one Muse session-start hook, found ${hooks.length}`);
  const runtime = info.runtime_capabilities;
  const hookId = hooks[0].id;
  const stable = `plugin:${NAME}:hook:${hookId}`;
  const hook = runtime.find(({ candidate: c }) => c.plugin_id === NAME && c.kind === "hook" && c.capability_id === hookId && c.stable_id === stable);
  const agents = AGENTS.map((name) => {
    const scoped = `${NAME}/${name}`;
    const entry = runtime.find(({ candidate: c }) => c.plugin_id === NAME && c.scoped_definition_id === scoped);
    return { id: `${NAME}:agent_definition:${scoped}`, status: entry?.status };
  });
  return { hook: { id: stable, status: hook?.status }, agents };
}

export function installMuse(target, ctx) {
  const steps = [];
  const found = records(target);
  const record = found[0]?.record;
  if (found.length > 1) throw new Error("multiple Muse t3-pstack-science records; remove the duplicate before installing");
  if (!record || !samePackage(record, ctx)) {
    json(target, ["plugins", "install", ctx.pluginRoot, "--scope", "user"]);
    steps.push(!record ? `installed Muse ${ctx.version}` : record.version === ctx.version ? `refreshed Muse ${ctx.version}` : `updated Muse ${record.version} to ${ctx.version}`);
  }
  let info = inspect(target);
  if (!samePackage(info.record, ctx)) throw new Error("Muse cached package differs from this release; no capabilities were approved");
  if (!info.record.enabled) {
    json(target, ["plugins", "enable", NAME]);
    steps.push(`enabled Muse ${NAME}`);
    info = inspect(target);
  }
  const caps = capabilities(info);
  for (const cap of [caps.hook, ...caps.agents]) {
    if (!cap.status) throw new Error(`Muse did not report capability ${cap.id}`);
    if (cap.status === TRUSTED) continue;
    json(target, ["plugins", "approve", cap.id]);
    steps.push(`approved ${cap.id}`);
  }
  if (git(target) !== "off") {
    // Record ownership first so an interrupted disable can be retried or undone.
    mkdirSync(target.dir, { recursive: true });
    writeAtomic(statePath(target), `${JSON.stringify({ disabledBuiltinGit: true })}\n`);
    cli(target, ["skills", "disable", "git", "--scope", "built-in"]);
    steps.push("disabled Muse's built-in git skill");
  }
  return steps;
}

function hookTest(target, ctx, hook) {
  const dir = mkdtempSync(join(tmpdir(), "t3-pstack-science-muse-hook-"));
  try {
    cli(target, ["schema", "generate-json-schema", "--out", join(dir, "schema")]);
    const schema = readJson(join(dir, "schema/msp.schema.json"));
    const event = schema.$defs.HookEventName.enum.find((name) => name === "sessionStart");
    if (!event) throw new Error("Muse schema has no sessionStart hook event");
    const name = event[0].toUpperCase() + event.slice(1);
    const fixture = join(dir, "session-start.json");
    // Hook test uses the Claude event spelling and a separate matcher input.
    writeFileSync(fixture, JSON.stringify({ event: name, matcher_input: "startup", cwd: dir, stdin: {
      hook_event_name: name, source: "startup", session_id: "t3-pstack-science-doctor", cwd: dir,
    } }));
    const result = json(target, ["plugins", "hook", "test", hook.id, "--fixture", fixture]);
    const terminals = result.terminals;
    const ran = terminals.length > 0 && terminals.every((t) => t.status === "completed" && t.exit_code === 0);
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
  if (found.length !== 1) return [...checks, check("installed", false, found.length ? "multiple t3-pstack-science records" : "not installed", MUSE_INSTALL_HINT)];
  const info = inspect(target);
  const installed = info.valid && info.active && info.record.enabled && samePackage(info.record, ctx);
  checks.push(check("installed", Boolean(installed), installed ? `${ctx.version}, enabled and active` : `${info.record.version}, wanted ${ctx.version}, enabled=${info.record.enabled}, active=${info.active}; package must match`, MUSE_INSTALL_HINT));
  const caps = capabilities(info);
  checks.push(check("session hook approved", caps.hook.status === TRUSTED, `${caps.hook.id}: ${caps.hook.status ?? "missing"}`, MUSE_INSTALL_HINT));
  const agentsOk = caps.agents.every((cap) => cap.status === TRUSTED);
  checks.push(check("agents approved", agentsOk, caps.agents.map((cap) => `${cap.id}: ${cap.status ?? "missing"}`).join(", "), MUSE_INSTALL_HINT));
  const gitOff = git(target) === "off";
  checks.push(check("built-in git", gitOff, gitOff ? "disabled" : "enabled", MUSE_INSTALL_HINT));
  try {
    checks.push(hookTest(target, ctx, caps.hook));
  } catch (err) {
    checks.push(check("session context", false, err.message, MUSE_INSTALL_HINT));
  }
  return checks;
}

export function uninstallMuse(target) {
  const steps = [];
  if (records(target).length) {
    json(target, ["plugins", "remove", NAME]);
    steps.push(`removed Muse ${NAME}`);
  }
  if (state(target).disabledBuiltinGit === true) {
    if (git(target) !== "on") {
      cli(target, ["skills", "enable", "git", "--scope", "built-in"]);
      steps.push("re-enabled Muse's built-in git skill");
    }
    rmSync(statePath(target));
  }
  return steps.length ? steps : ["nothing to remove"];
}
