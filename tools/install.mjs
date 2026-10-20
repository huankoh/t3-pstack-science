#!/usr/bin/env node
// t3-pstack-science's installer. `install`, or `update`, the same command, brings
// every Claude Code and Codex home T3 can run to this package's version of
// t3-pstack-science, trusts the Codex session-start hook, and checks this fork's
// machine sheet. Each step converges, so a second run changes
// nothing. `doctor` checks the same homes and writes nothing itself, though
// the Codex app-server it starts refreshes a Git marketplace, as any T3 Codex
// thread does. Both exit 1 when a check fails.
//
// Each home's t3-pstack-science marketplace must come from huankoh/t3-pstack-science or from
// this run's --source. A home whose marketplace has another source, such as a
// local --source from an earlier run, gets nothing installed and no hook
// trusted, and doctor fails it with that source.
//
//   npx -y github:huankoh/t3-pstack-science <install|update|doctor|uninstall>
//     --source <owner/repo|git URL|dir>   marketplace source, default huankoh/t3-pstack-science
//     --claude-home <dir>, --codex-home <dir>   more homes, repeatable
//     --cursor, --muse   also converge those copies; uninstall removes only the opted-in copies
//     --catalog <file>   an orchestrator_capabilities dump to check the sheet's targets against
//     --json
// Node 20 or later, no dependencies. Cursor and Muse are touched only when opted in.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { doctorClaude, installClaude } from "./install/claude.mjs";
import { doctorCodex, installCodex } from "./install/codex.mjs";
import { CURSOR_INSTALL_HINT, CURSOR_UNINSTALL_HINT, doctorCursor, installCursor, uninstallCursor } from "./install/cursor.mjs";
import { check, hasCli, HOME_REPO, INSTALL_HINT, MARKETPLACE, parseSource, PLUGIN_ID, readJson } from "./install/common.mjs";
import { MUSE_INSTALL_HINT, MUSE_UNINSTALL_HINT, doctorMuse, installMuse, uninstallMuse } from "./install/muse.mjs";
import { cursorHome, discoverHomes, museHome } from "./install/homes.mjs";
import { doctorSheet, sessionHookOff, sheetPath } from "./install/sheet.mjs";
import { FROZEN_HOOKS } from "./plugin.mjs";

const HARNESSES = {
  claude: { name: "Claude Code", install: installClaude, doctor: doctorClaude, fix: INSTALL_HINT },
  codex: { name: "Codex", install: installCodex, doctor: doctorCodex, fix: INSTALL_HINT },
  muse: { name: "Muse Code", install: installMuse, doctor: doctorMuse, fix: MUSE_INSTALL_HINT },
  cursor: { name: "Cursor", install: installCursor, doctor: doctorCursor, fix: CURSOR_INSTALL_HINT },
};

const USAGE =
  "usage: t3-pstack-science <install|update|doctor|uninstall> [--source <owner/repo|git URL|dir>] " +
  "[--claude-home <dir>]... [--codex-home <dir>]... [--cursor] [--muse] [--catalog <file>] [--json]";

// What to converge on comes from the plugin this run installs: the local
// source, or else this package, which is the marketplace's own repo. `skills`
// maps each skill to its SKILL.md, and `codexHook` is the hooks file the
// Codex manifest names, with its pinned digest.
function pluginFacts(root, { cursor = false } = {}) {
  const pluginName = PLUGIN_ID.split("@")[0];
  for (const file of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"]) {
    const path = join(root, file);
    const manifest = readJson(path);
    const name = manifest?.name;
    if (name !== MARKETPLACE) throw new Error(`${path}: found marketplace name ${JSON.stringify(name) ?? "missing"}, expected "${MARKETPLACE}"`);
    const names = manifest.plugins?.map((plugin) => plugin.name);
    if (!names?.includes(pluginName)) throw new Error(`${path}: found plugin names ${JSON.stringify(names) ?? "missing"}, expected "${pluginName}"`);
  }
  const plugin = join(root, "plugins/pstack");
  for (const file of [".claude-plugin/plugin.json", ".codex-plugin/plugin.json", ...(cursor ? [".cursor-plugin/plugin.json"] : [])]) {
    const path = join(plugin, file);
    const name = readJson(path)?.name;
    if (name !== pluginName) throw new Error(`${path}: found plugin name ${JSON.stringify(name) ?? "missing"}, expected "${pluginName}"`);
  }
  const modelsPath = join(plugin, "models.json");
  const models = readJson(modelsPath);
  if (!models?.domains) throw new Error(`${modelsPath}: source "${MARKETPLACE}" is missing "domains"`);
  const hooks = readJson(join(plugin, ".codex-plugin/plugin.json")).hooks.replace(/^\.\//, "");
  const skills = readdirSync(join(plugin, "skills"), { withFileTypes: true }).filter((entry) => entry.isDirectory());
  return {
    version: readJson(join(plugin, ".claude-plugin/plugin.json")).version,
    skills: new Map(skills.map(({ name }) => [name, readFileSync(join(plugin, "skills", name, "SKILL.md"), "utf8")])),
    codexHook: { path: hooks, sha256: readJson(join(root, FROZEN_HOOKS))[`plugins/pstack/${hooks}`].sha256 },
    models,
    pluginRoot: plugin,
  };
}

async function run(argv, env, home) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      source: { type: "string" },
      "claude-home": { type: "string", multiple: true, default: [] },
      "codex-home": { type: "string", multiple: true, default: [] },
      catalog: { type: "string" },
      muse: { type: "boolean", default: false },
      cursor: { type: "boolean", default: false },
      json: { type: "boolean", default: false },
    },
  });
  const [command] = positionals;
  if (positionals.length !== 1 || !["install", "update", "doctor", "uninstall"].includes(command)) return { usage: true };
  if (command === "uninstall") return values.cursor || values.muse ? { report: uninstallCopies(env, home, values), json: values.json } : { usage: true };

  const source = parseSource(values.source ?? HOME_REPO, home);
  const homeRepo = parseSource(HOME_REPO, home);
  if ((values.cursor || values.muse) && !copiesLocalPackage(source, homeRepo)) {
    throw new Error(`${[values.cursor && "--cursor", values.muse && "--muse"].filter(Boolean).join(" ")} only installs from ${HOME_REPO} or a local --source, not ${source.arg}`);
  }
  const facts = pluginFacts(source.local ?? fileURLToPath(new URL("..", import.meta.url)), { cursor: values.cursor });
  const trusted = new Set([homeRepo.key, source.key]);
  const context = {
    source,
    explicitSource: values.source !== undefined,
    trusted,
    version: facts.version,
    skills: facts.skills,
    codexHook: facts.codexHook,
    pluginRoot: facts.pluginRoot,
    sessionHookOff: sessionHookOff(sheetPath(env, home)),
  };
  const discovered = discoverHomes({
    env,
    home,
    claudeHomes: values["claude-home"],
    codexHomes: values["codex-home"],
  });
  const { settings } = discovered;
  const homes = [...discovered.homes, ...(values.cursor ? [cursorHome({ env, home })] : []), ...(values.muse ? [museHome({ env, home })] : [])];
  const catalog = values.catalog ? readJson(values.catalog) : null;

  const report = { command, version: facts.version, source: source.arg, settings, homes: [] };
  for (const target of homes) {
    const harness = HARNESSES[target.harness];
    const row = { harness: target.harness, dir: target.dir, from: target.from, steps: [], checks: [] };
    report.homes.push(row);
    if (target.bin !== null && !hasCli(target.bin)) {
      row.checks.push(check("CLI", false, `${target.bin} not found, so this home was skipped`, `install ${harness.name} if T3 runs it`, target.harness !== "muse"));
      continue;
    }
    if (command === "doctor" && target.harness !== "muse" && !existsSync(target.dir)) {
      row.checks.push(check("installed", false, "the home does not exist", harness.fix));
      continue;
    }
    try {
      if (command !== "doctor") row.steps = await harness.install(target, context);
      row.checks.push(...(await harness.doctor(target, context)));
    } catch (err) {
      row.checks.push(check(command === "doctor" ? "doctor" : "install", false, err.message, err.fix ?? harness.fix));
    }
  }
  const sheet = sheetPath(env, home);
  report.sheet = { path: sheet, steps: [], checks: [] };
  report.sheet.checks.push(...doctorSheet(sheet, { catalog, models: facts.models }));
  const all = [...report.homes.flatMap((row) => row.checks), ...report.sheet.checks];
  report.failed = all.filter((c) => !c.ok && !c.warn).length;
  report.warnings = all.filter((c) => !c.ok && c.warn).length;
  return { report, json: values.json };
}

function copiesLocalPackage(source, homeRepo) {
  return source.local || source.key === homeRepo.key;
}

function uninstallCopies(env, home, values) {
  const homes = [];
  const targets = [
    ...(values.cursor ? [{ target: cursorHome({ env, home }), uninstall: uninstallCursor, fix: CURSOR_UNINSTALL_HINT }] : []),
    ...(values.muse ? [{ target: museHome({ env, home }), uninstall: uninstallMuse, fix: MUSE_UNINSTALL_HINT }] : []),
  ];
  for (const { target, uninstall, fix } of targets) {
    const row = { harness: target.harness, dir: target.dir, from: target.from, steps: [], checks: [] };
    homes.push(row);
    try {
      if (target.bin !== null && !hasCli(target.bin)) throw new Error(`${target.bin} not found`);
      row.steps = uninstall(target);
    } catch (err) {
      row.checks.push(check("uninstall", false, err.message, err.fix ?? fix));
    }
  }
  return { command: "uninstall", homes, failed: homes.flatMap((row) => row.checks).length };
}

function section(lines, title, steps, checks) {
  lines.push("", title);
  for (const step of steps) lines.push(`  - ${step}`);
  for (const c of checks) {
    lines.push(`  ${c.ok ? "ok  " : c.warn ? "warn" : "FAIL"}  ${c.name}: ${c.detail}`);
    if (!c.ok) lines.push(`        fix: ${c.fix}`);
  }
}

const homeTitle = (row) => `${HARNESSES[row.harness].name}  ${row.dir}  (${row.from.join(", ")})`;

function renderUninstall({ homes }, home) {
  const lines = [`t3-pstack-science uninstall ${homes.map((row) => `--${row.harness}`).join(" ")}`];
  for (const row of homes) section(lines, homeTitle(row), row.steps, row.checks);
  return lines.join("\n").replaceAll(home, "~");
}

function render({ command, version, source, settings, homes, sheet, failed, warnings }, home) {
  const lines = [`t3-pstack-science ${version} from ${source}`];
  lines.push(`T3 settings: ${settings.path}${settings.error ? ` (${settings.error})` : `, ${settings.instances} Claude Code, Codex, or Muse instances`}`);
  for (const row of homes) section(lines, homeTitle(row), row.steps, row.checks);
  section(lines, `Model sheet  ${sheet.path}`, sheet.steps, sheet.checks);
  const changed = [...homes.flatMap((row) => row.steps), ...sheet.steps].length;
  const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  lines.push(
    "",
    `${command === "doctor" ? "" : changed ? `${count(changed, "change")}. ` : "Nothing to change. "}` +
      (failed ? `${count(failed, "check")} failed` : "Every check passes") +
      (warnings ? `, ${count(warnings, "warning")}.` : "."),
  );
  return lines.join("\n").replaceAll(home, "~");
}

const home = homedir();
try {
  const { usage, report, json } = await run(process.argv.slice(2), process.env, home);
  if (usage) {
    console.error(USAGE);
    process.exitCode = 2;
  } else {
    console.log(json ? JSON.stringify(report, null, 2) : (report.command === "uninstall" ? renderUninstall : render)(report, home));
    process.exitCode = report.failed ? 1 : 0;
  }
} catch (err) {
  console.error(`t3-pstack-science: ${err.message}`);
  process.exitCode = 2;
}
