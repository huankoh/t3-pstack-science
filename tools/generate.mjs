#!/usr/bin/env bun
// Stamps facts that live in one source file into every file that carries a
// copy, and validates cross-file contracts. Idempotent; run it after editing
// a source of truth. CI contract: `bun tools/generate.mjs --check` writes
// nothing and fails when a committed copy is stale, so it cannot ship.
//
// Sources of truth:
//   VERSION  -> the "version" field in the Claude Code and Codex manifests,
//               the Claude Code marketplace entry, and package.json
//   CHANGES.md must carry a heading for the current VERSION (release completeness)
//   plugins/pstack/models.json (the T3 model policy: tier defaults, roles, and muse mode)
//     -> each model-consuming skill's "## Models" section, interrogate's
//        reviewer table, and setup-pstack's sheet block (tools/derive-t3.mjs)
//   plugins/pstack/agents/*.md -> the "agents" list in
//     plugins/pstack/.claude-plugin/plugin.json (a list replaces the default
//     agents/ directory, so it names every agent)
//   the planned Claude manifest and hooks/session-start-context.md
//     -> plugins/pstack/.cursor-plugin/ (identity, skills, an empty agents
//        list, and the always-apply session rule)
//   LICENSE, LICENSE-cursor-team-kit, LICENSE-thermos, NOTICE-skills.md
//     -> copies under poteto-mode/references/licenses/, so the notices ship
//        inside the installed plugin
//
// Also validated: skill frontmatter, the skills tree's links,
// the plugin layout, agent frontmatter, the Codex marketplace, and both hooks
// files against their pins in tools/frozen-hooks.json.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Type } from "typebox";
import { Value } from "typebox/value";

import { DOMAINS, GENERAL, MUSE, SCIENCE, panelFamilies, parseEntry, speedProblems } from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { applyRegions, parseFrontmatter, ROUTED_SKILL, t3Regions } from "./derive-t3.mjs";
import { FROZEN_HOOKS, hookDigest, PLUGIN, SKILLS } from "./plugin.mjs";
import { pathIsInside, validateSkillsTree, walk } from "./validate-skills.mjs";

export { parseFrontmatter };

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

const CODEX_MANIFEST = `${PLUGIN}/.codex-plugin/plugin.json`;
const VERSIONED_MANIFESTS = [
  ".claude-plugin/marketplace.json",
  `${PLUGIN}/.claude-plugin/plugin.json`,
  CODEX_MANIFEST,
  "package.json",
];

const LICENSES = `${SKILLS}/poteto-mode/references/licenses`;
export const PORTABLE_ASSETS = [
  { source: "LICENSE", target: "LICENSE" },
  { source: "LICENSE-cursor-team-kit", target: "LICENSE-cursor-team-kit" },
  { source: "LICENSE-thermos", target: "LICENSE-thermos" },
  { source: "NOTICE-skills.md", target: "NOTICE.md" },
];

// The generator removes every entry of these directories that no planned path
// runs through, so no hand-written file may live in one.
const CURSOR_PLUGIN = `${PLUGIN}/.cursor-plugin`;
export const OWNED_DIRS = [LICENSES, CURSOR_PLUGIN];

// A release version, with an optional pre-release suffix such as -rc.1.
const VERSION_RE = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;
const VERSION_LINE = new RegExp(`^${VERSION_RE.source}$`);

// Replace the manifest's single "version" value, preserving all formatting.
// Exactly one "version" field per manifest is a precondition: a second one
// would make the blind replace ambiguous.
export function stampVersion(text, version, file) {
  const fields = text.match(/"version"\s*:\s*"[^"]*"/g) ?? [];
  if (fields.length !== 1) {
    throw new Error(`${file}: expected exactly 1 "version" field, found ${fields.length}`);
  }
  return text.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
}

// The lines outside fenced code blocks. A fence opens at three or more
// backticks or tildes indented at most three spaces, and closes at the next
// line that holds nothing but at least as many of the same character.
function outsideFences(lines) {
  let fence = null;
  return lines.filter((line) => {
    const [, mark, after] = line.match(/^ {0,3}(`{3,}|~{3,})(.*)/) ?? [];
    if (fence) {
      if (mark?.startsWith(fence) && !after.trim()) fence = null;
      return false;
    }
    if (mark) fence = mark;
    return !mark;
  });
}

// Plugin auto-update installs by version number, so a CHANGES entry whose
// VERSION bump was forgotten ships nothing.
export function assertChangesHeading(changelog, version) {
  const lines = outsideFences(changelog.split("\n"));
  const current = lines.find((line) => line.startsWith(`## ${version} `));
  if (!current) throw new Error(`CHANGES.md has no "## ${version} - <title>" heading`);
  // An entry is a heading whose first word carries a version, at any level or
  // decoration: "# 1.2.3", "## v1.2.3", "## [1.2.3]". A heading without one is
  // not read as an entry.
  const leadsWithVersion = (line) => /(?:^|\D)\d+\.\d+\.\d/.test(line.match(/^#+\s*(\S*)/)?.[1] ?? "");
  const newest = lines.find(leadsWithVersion);
  if (newest !== current) throw new Error(`CHANGES.md's newest release heading is "${newest}", but VERSION is ${version}`);
  const headings = lines.filter((line) => /^## \d+\.\d+\.\d+/.test(line));
  const wellFormed = new RegExp(`^## ${VERSION_RE.source} - \\S`);
  const malformed = headings.filter((line) => !wellFormed.test(line));
  if (malformed.length) {
    throw new Error(`CHANGES.md release headings read "## <version> - <title>":\n${malformed.join("\n")}`);
  }
  const versions = headings.map((line) => line.split(" ")[1]);
  const repeated = headings.filter((_, i) => versions.indexOf(versions[i]) !== versions.lastIndexOf(versions[i]));
  if (repeated.length) throw new Error(`CHANGES.md heads two entries with one version:\n${repeated.join("\n")}`);
}

// Validate the shared subset of the Agent Skills contract: every skill needs a
// portable name and description. The routed skill must stay model-invocable,
// because the session-start hook invokes it by name.
export function agentSkills(skillsDir) {
  const skills = [];
  for (const entry of readdirSync(skillsDir).sort()) {
    const file = join(skillsDir, entry, "SKILL.md");
    if (!statSync(join(skillsDir, entry)).isDirectory() || !existsSync(file)) continue;
    const front = parseFrontmatter(readFileSync(file, "utf8")).data ?? {};
    const path = `skills/${entry}/SKILL.md`;
    const name = front.name;
    if (name !== entry) throw new Error(`${path}: frontmatter name "${name}" != directory "${entry}"`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      throw new Error(`${path}: frontmatter name "${name}" is not a portable Agent Skills name`);
    }
    const description = front.description;
    if (typeof description !== "string" || !description) {
      throw new Error(`${path}: skill has no description frontmatter`);
    }
    if (description.length > 1024) {
      throw new Error(`${path}: description exceeds the portable Agent Skills limit of 1024 characters`);
    }
    if (name === ROUTED_SKILL && front["disable-model-invocation"] === true) {
      throw new Error(`${path}: disable-model-invocation: true stops the session-start hook from invoking ${ROUTED_SKILL}`);
    }
    skills.push({ name, description });
  }
  return skills;
}

// A worktree removed by force or by hand, or cleaned with git clean -x, loses
// its untracked or ignored files (cursor/plugins#449), and git worktree prune
// drops every prunable worktree's HEAD reflog at once, so no playbook may
// prescribe any of them.
const UNSAFE_REMOVAL =
  /\bworktree\s+remove\b[^`\n]*\s(?:--force|-f+)\b|\bworktree\s+prune\b|(?<!\bgit\s|\bgit\s+-C\s+[^\s`;&|]+\s)\brm\b[^`\n]*\s(?:-[a-zA-Z]*[rR]|--recursive)|\bclean\b[^`\n]*\s-[a-zA-Z]*[xX]/;

// Layout invariants that live outside any one skill.
export function validatePluginLayout(pluginRoot) {
  if (!existsSync(join(pluginRoot, "skills", ROUTED_SKILL, "SKILL.md"))) {
    throw new Error(`${PLUGIN}/skills has no ${ROUTED_SKILL} skill, which the session-start hook invokes`);
  }
  // Claude Code lists a plugin's commands and its user-invocable skills in the
  // slash menu, so a command beside a same-named skill shows twice.
  if (existsSync(join(pluginRoot, "commands"))) {
    throw new Error(`${PLUGIN}/commands/ exists; every slash command is a skill`);
  }
  // Codex reads a plugin with this Agent Plugins manifest as an Agent Plugin
  // and truncates each injected SKILL.md to 8,000 bytes.
  if (existsSync(join(pluginRoot, "plugin.json"))) {
    throw new Error(`${PLUGIN}/plugin.json exists; Codex would truncate every injected SKILL.md to 8,000 bytes`);
  }
  // tools/sync.mjs writes an unresolved three-way merge with git's markers and
  // still advances the pin, so this check is what keeps it out of a release.
  const markers = [];
  const unsafe = [];
  for (const file of walk(pluginRoot)) {
    if (!lstatSync(file).isFile()) continue;
    const raw = readFileSync(file);
    if (raw.includes(0)) continue;
    const rel = relative(pluginRoot, file);
    const playbook = /(^|[\\/])playbooks[\\/][^\\/]+\.md$/.test(rel);
    raw.toString("utf8").split("\n").forEach((line, i) => {
      if (/^(<{7}|\|{7}|={7}|>{7})( |$)/.test(line)) markers.push(`${rel}:${i + 1}: ${line}`);
      if (playbook && UNSAFE_REMOVAL.test(line)) unsafe.push(`${rel}:${i + 1}: ${line}`);
    });
  }
  if (markers.length) {
    throw new Error(`unresolved sync conflict markers; resolve each hunk by hand:\n${markers.join("\n")}`);
  }
  if (unsafe.length) {
    throw new Error(
      `a playbook force-removes a worktree, deletes one by hand, cleans ignored files, or prunes worktrees in bulk; prune with a plain git worktree remove and stop when it refuses:\n${unsafe.join("\n")}`,
    );
  }
}

const RESERVED_KEYS = ["session hook", "default effort"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const failModels = (message) => {
  throw new Error(`models.json: ${message}`);
};

function parseDomains(raw) {
  const domainNames = isObject(raw) && isObject(raw.domains) ? Object.keys(raw.domains) : [];
  if (domainNames.length !== DOMAINS.length || domainNames.some((domain, i) => domain !== DOMAINS[i])) {
    failModels('"domains" must hold "general" then "science"');
  }
  for (const domain of DOMAINS) {
    const policy = raw.domains[domain];
    if (!isObject(policy)) failModels(`domain "${domain}" must be an object`);
    for (const field of Object.keys(policy)) {
      if (!["tiers", "covers", "termReaders"].includes(field)) failModels(`domain "${domain}" has unknown field "${field}"`);
      if (domain === GENERAL && field !== "tiers") {
        failModels(`domain "${domain}" takes no ${field}; unprefixed v2 sheet lines set it, and they had no term rule`);
      }
    }
    if (domain === SCIENCE) {
      if (typeof policy.covers !== "string" || !policy.covers.trim()) {
        failModels(`domain "${domain}" needs "covers", the task class the gate routes to it`);
      }
      const readers = policy.termReaders;
      if (
        !Array.isArray(readers) || !readers.length || new Set(readers).size !== readers.length ||
        readers.some((f) => typeof f !== "string" || !/^[a-z]+$/.test(f))
      ) {
        failModels(`domain "${domain}" needs "termReaders", the families that may read its terms`);
      }
    }
    if (!isObject(policy.tiers) || !Object.keys(policy.tiers).length) failModels(`domain "${domain}" needs a non-empty "tiers" object`);
  }
  return raw.domains;
}

function parseTier(value, where) {
  if (value === null) return;
  if (typeof value !== "string" && !Array.isArray(value)) failModels(`${where} must be one entry, a list, or null`);
  const list = [value].flat();
  if (new Set(list).size !== list.length) failModels(`${where} lists an entry twice`);
  const parsed = list.map((entry) => {
    if (typeof entry !== "string" || entry !== entry.trim().split(/\s+/).join(" ")) {
      failModels(`${where}: ${JSON.stringify(entry)} is not one entry written with single spaces`);
    }
    let target;
    try {
      target = parseEntry(entry);
    } catch (err) {
      failModels(`${where}: ${err.message}`);
    }
    if (!target) failModels(`${where} must name a target, not inherit the parent`);
    const speed = speedProblems(target);
    if (speed.length) failModels(`${where}: ${speed[0]}`);
    return target;
  });
  if (Array.isArray(value) && panelFamilies(parsed).size < 2) failModels(`${where}: the panel needs at least two model families`);
}

function parseTiers(domains) {
  const tierNames = Object.keys(domains[GENERAL].tiers);
  for (const domain of DOMAINS) {
    const { tiers } = domains[domain];
    for (const tier of tierNames) {
      if (!Object.hasOwn(tiers, tier)) failModels(`domain "${domain}" has no tier "${tier}"; write null if it has no such seat`);
    }
    for (const tier of Object.keys(tiers)) {
      if (!tierNames.includes(tier)) failModels(`domain "${domain}" names tier "${tier}", which "${GENERAL}" does not`);
    }
  }
  for (const tier of tierNames) {
    const present = DOMAINS.filter((domain) => domains[domain].tiers[tier] !== null);
    if (!present.length) failModels(`tier "${tier}" has no seat in any domain`);
    const list = present.find((domain) => Array.isArray(domains[domain].tiers[tier]));
    const single = present.find((domain) => typeof domains[domain].tiers[tier] === "string");
    if (list && single) failModels(`tier "${tier}" is a list in "${list}" but one entry in "${single}"`);
  }
  for (const domain of DOMAINS) {
    for (const [tier, value] of Object.entries(domains[domain].tiers)) {
      parseTier(value, `domain "${domain}" tier "${tier}"`);
    }
  }
  return tierNames;
}

function parseMuse(raw, tierNames, domains) {
  const muse = raw.muse;
  if (!isObject(muse)) failModels('"muse" must be an object');
  for (const field of Object.keys(muse)) {
    if (!["on", "off", "tiers"].includes(field)) failModels(`"muse" has unknown field "${field}"`);
  }
  for (const key of ["on", "off"]) {
    const list = muse[key];
    if (
      !Array.isArray(list) || !list.length || new Set(list).size !== list.length ||
      list.some((phrase) => typeof phrase !== "string" || !phrase.trim() || phrase !== phrase.toLowerCase())
    ) {
      failModels(`"muse" "${key}" must be a non-empty list of distinct non-empty lowercase phrases`);
    }
  }
  const overlap = muse.on.filter((phrase) => muse.off.includes(phrase));
  if (overlap.length) failModels(`"muse" lists ${overlap.map((phrase) => JSON.stringify(phrase)).join(", ")} in both "on" and "off"`);
  const { tiers } = muse;
  if (!isObject(tiers)) failModels('"muse" needs a "tiers" object');
  for (const tier of tierNames) {
    if (!Object.hasOwn(tiers, tier)) failModels(`"muse" has no tier "${tier}"`);
  }
  for (const tier of Object.keys(tiers)) {
    if (!tierNames.includes(tier)) failModels(`"muse" names tier "${tier}", which no domain defines`);
  }
  for (const tier of tierNames) {
    const value = tiers[tier];
    if (typeof value !== "string" && !Array.isArray(value)) failModels(`muse tier "${tier}" must be one entry or a list`);
    const standard = DOMAINS.map((domain) => domains[domain].tiers[tier]).find((seat) => seat !== null);
    if (Array.isArray(standard) !== Array.isArray(value)) {
      failModels(Array.isArray(standard)
        ? `muse tier "${tier}" must be a list, like the standard "${tier}" panel`
        : `muse tier "${tier}" must be one entry, like the standard "${tier}" seat`);
    }
    parseTier(value, `muse tier "${tier}"`);
  }
}

function parseRoles(roles, tierNames, skillExists) {
  if (!Array.isArray(roles)) failModels('"roles" must be a list');
  const labels = new Set();
  for (const role of roles) {
    for (const label of [role.role, role.alias].filter(Boolean)) {
      if (labels.has(label)) failModels(`role "${label}" appears twice`);
      labels.add(label);
      if (RESERVED_KEYS.includes(label)) failModels(`role "${label}" is a reserved sheet key`);
      if (label.startsWith(`${SCIENCE} `)) {
        failModels(`role "${label}" starts with the domain name "${SCIENCE}", so its sheet line would be ambiguous`);
      }
      if (label.startsWith(`${MUSE} `)) {
        failModels(`role "${label}" starts with "${MUSE} ", so its sheet line would be ambiguous`);
      }
    }
    if (!tierNames.includes(role.tier)) failModels(`role "${role.role}" names tier "${role.tier}", which no domain defines`);
    if (!skillExists(role.skill)) failModels(`role "${role.role}" names skill "${role.skill}", which has no SKILL.md`);
  }
}

export function parseModels(raw, skillExists) {
  const domains = parseDomains(raw);
  const tierNames = parseTiers(domains);
  parseMuse(raw, tierNames, domains);
  parseRoles(raw.roles, tierNames, skillExists);
  return raw;
}

export function loadModels(root = repo) {
  const skillsDir = join(root, SKILLS);
  return parseModels(JSON.parse(readFileSync(join(root, PLUGIN, "models.json"), "utf8")), (skill) =>
    existsSync(join(skillsDir, skill, "SKILL.md")),
  );
}

// Every agent file the plugin ships, as plugin.json's "agents" list names them.
export function pluginAgentPaths(pluginRoot) {
  const dir = join(pluginRoot, "agents");
  return existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => `./agents/${f}`)
    : [];
}

// Claude Code's loader tolerates frontmatter that strict YAML rejects, so an
// agent file can load locally and still be unreadable to another parser.
export function validateAgentFrontmatter(pluginRoot) {
  const failures = pluginAgentPaths(pluginRoot).flatMap((path) => {
    try {
      const { data } = parseFrontmatter(readFileSync(join(pluginRoot, path), "utf8"));
      if (!data?.name || !data?.description) return [`${path}: frontmatter needs a name and a description`];
      const file = basename(path, ".md");
      return data.name === file ? [] : [`${path}: frontmatter name "${data.name}" != file name "${file}"`];
    } catch (err) {
      return [`${path}: ${err.message}`];
    }
  });
  if (failures.length) throw new Error(`agent frontmatter is not readable YAML:\n${failures.join("\n")}`);
}

export function stampAgentPaths(manifestText, paths) {
  return JSON.stringify({ ...JSON.parse(manifestText), agents: paths }, null, 2) + "\n";
}

const CURSOR_COMPONENT_KEYS = ["skills", "agents", "rules", "hooks", "commands", "mcpServers"];

// An empty agents list is what stops the SDK registering our agent files as
// subagent types.
export function cursorManifest(claude) {
  const identity = Object.entries(claude).filter(([key]) => !CURSOR_COMPONENT_KEYS.includes(key));
  return { ...Object.fromEntries(identity), skills: "./skills/", agents: [], rules: "./.cursor-plugin/rules/" };
}

const CURSOR_RULE_GATE =
  "Follow this rule only when a `<runtime_info>` block says the session runs in T3 Code, and ignore it in any other Cursor session. " +
  "Cursor does not prefix plugin skill names, and another plugin may ship skills or agents with the same names (such as `setup-pstack`, `poteto-mode`, `poteto-agent`). " +
  "Each skill below is named by its `SKILL.md` path under `${CURSOR_PLUGIN_ROOT}`: open that file and follow it, never a bare name. " +
  "In this rule, `poteto-mode` always means `${CURSOR_PLUGIN_ROOT}/skills/poteto-mode/SKILL.md`. " +
  "A persona is a `delegate_task` brief that names `${CURSOR_PLUGIN_ROOT}/agents/<name>.md`, not a Cursor subagent type.";

export function cursorRule(context, pluginName) {
  const pattern = new RegExp(`\`${pluginName}:([a-z0-9-]+)\``, "g");
  const body = context.replace(pattern, "`${CURSOR_PLUGIN_ROOT}/skills/$1/SKILL.md`");
  if (body === context) throw new Error(`session-start context has no \`${pluginName}:<skill>\` token`);
  if (body.includes(`${pluginName}:`)) throw new Error(`session-start context still names \`${pluginName}:\``);
  return `---\ndescription: ${pluginName} session start for T3 Code\nalwaysApply: true\n---\n\n${CURSOR_RULE_GATE}\n\n${body}`;
}

export function validateCodexMarketplace(text, { expectedName, pathExists }) {
  const manifest = JSON.parse(text);
  const plugins = manifest.plugins ?? [];
  if (plugins.length !== 1) {
    throw new Error(`.agents/plugins/marketplace.json: expected 1 plugin entry, found ${plugins.length}`);
  }
  const [plugin] = plugins;
  if (plugin.name !== expectedName) {
    throw new Error(
      `.agents/plugins/marketplace.json: plugin name "${plugin.name}" != Codex manifest name "${expectedName}"`,
    );
  }
  const path = plugin.source?.path;
  if (!path || !pathExists(path)) {
    throw new Error(`.agents/plugins/marketplace.json: source.path "${path}" does not resolve to a directory`);
  }
}

// The hook handler shapes Claude Code documents, one schema per `type`
// (https://code.claude.com/docs/en/hooks, "Hook handler fields"), plus Codex's
// commandWindows on a command hook. A key no type lists is a fault, so a
// misspelt override cannot be dropped without notice.
const HOOK_FIELDS = {
  if: Type.Optional(Type.String()),
  timeout: Type.Optional(Type.Number()),
  statusMessage: Type.Optional(Type.String()),
  once: Type.Optional(Type.Boolean()),
};
const hookType = (type, fields) =>
  Type.Object({ type: Type.Literal(type), ...fields, ...HOOK_FIELDS }, { additionalProperties: false });
const HOOK_TYPES = {
  command: hookType("command", {
    command: Type.String(),
    commandWindows: Type.Optional(Type.String()),
    args: Type.Optional(Type.Array(Type.String())),
    async: Type.Optional(Type.Boolean()),
    asyncRewake: Type.Optional(Type.Boolean()),
    shell: Type.Optional(Type.Union([Type.Literal("bash"), Type.Literal("powershell")])),
  }),
  http: hookType("http", {
    url: Type.String(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
    allowedEnvVars: Type.Optional(Type.Array(Type.String())),
  }),
  mcp_tool: hookType("mcp_tool", {
    server: Type.String(),
    tool: Type.String(),
    input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  }),
  prompt: hookType("prompt", { prompt: Type.String(), model: Type.Optional(Type.String()) }),
  agent: hookType("agent", { prompt: Type.String(), model: Type.Optional(Type.String()) }),
};
const MATCHER_GROUP = Type.Object(
  { matcher: Type.Optional(Type.String()), hooks: Type.Array(Type.Object({ type: Type.String() })) },
  { additionalProperties: false },
);
const HOOKS_FILE = Type.Object({ hooks: Type.Record(Type.String(), Type.Array(MATCHER_GROUP)) });

// typebox reports an unknown key twice, as a false schema at the key and as
// additionalProperties on its object; the second names every such key.
function shapeFaults(schema, value, subject) {
  return [...Value.Errors(schema, value)]
    .filter((error) => error.keyword !== "boolean")
    .map((error) =>
      error.keyword === "additionalProperties"
        ? `unknown key ${error.params.additionalProperties.join(", ")}`
        : `${error.instancePath.slice(1).replaceAll("/", ".") || subject} ${error.message}`,
    );
}

// A hooks file must have the documented shape, every ${<root>}/<path> a
// command hook names must exist in the plugin, and one the command executes
// directly must be executable, or the SessionStart hook fails silently for
// every user. The root is the variable the runtime exports with the plugin's
// directory.
export function validateHooks(hooksJson, { statOf, file = "hooks/hooks.json", root = "CLAUDE_PLUGIN_ROOT" }) {
  const raw = JSON.parse(hooksJson);
  const faults = shapeFaults(HOOKS_FILE, raw, "file");
  if (faults.length) throw new Error(`${file}:\n  ${faults.join("\n  ")}`);
  for (const [event, groups] of Object.entries(raw.hooks)) {
    for (const hook of groups.flatMap((group) => group.hooks)) {
      const schema = Object.hasOwn(HOOK_TYPES, hook.type) ? HOOK_TYPES[hook.type] : undefined;
      if (!schema) {
        faults.push(`${event}: hook type "${hook.type}" is not one of ${Object.keys(HOOK_TYPES).join(", ")}`);
        continue;
      }
      const shape = shapeFaults(schema, hook, "hook");
      if (shape.length) {
        faults.push(...shape.map((fault) => `${event}: ${fault}`));
        continue;
      }
      if (hook.type !== "command") continue;
      for (const command of [hook.command, hook.commandWindows].filter((value) => value !== undefined)) {
        const refs = [...command.matchAll(new RegExp(`\\$\\{${root}\\}/([^"\\s]+)`, "g"))].map((m) => m[1]);
        if (!refs.length) {
          faults.push(`${event}: command does not reference \${${root}}: ${command}`);
          continue;
        }
        const executed = command.replace(/^"/, "").startsWith(`\${${root}}/`);
        refs.forEach((rel, i) => {
          const st = statOf(rel);
          if (!st) faults.push(`${event}: ${rel} does not exist in the plugin`);
          else if (i === 0 && executed && !(st.mode & 0o111)) faults.push(`${event}: ${rel} is not executable`);
        });
      }
    }
  }
  if (faults.length) throw new Error(`${file}:\n  ${faults.join("\n  ")}`);
}

// Codex trusts a plugin hook by a hash of its entry, and a Git marketplace
// delivers a new entry at the next app-server start, so a changed hooks file
// silently stops the hook in every home until the installer trusts it again.
// Each hooks file is pinned with the release that last changed it, and that
// release's CHANGES entry must tell users to rerun the installer. `shipped`
// holds VERSION and the hooks files as origin/main has them, since main is
// what the marketplaces deliver: a file that differs from main's changes in
// this release, so its pin must name this release, and VERSION must be newer
// than main's.
export function frozenHookFaults({ pins, files, version, changelog, shipped }) {
  const faults = Object.keys(files)
    .filter((path) => !Object.hasOwn(pins, path))
    .map((path) => `${path} has no pin in ${FROZEN_HOOKS}`);
  const entry = changelog.split(/^## /m).find((section) => section.startsWith(`${version} `)) ?? "";
  for (const [path, pin] of Object.entries(pins)) {
    if (!Object.hasOwn(files, path)) {
      faults.push(`${FROZEN_HOOKS} pins ${path}, which no manifest names`);
      continue;
    }
    const digest = hookDigest(files[path]);
    const changed = shipped.files[path] === undefined || hookDigest(shipped.files[path]) !== digest;
    if (digest !== pin.sha256) {
      faults.push(
        `${path} changed, which stops its hook in every Codex home until the installer reruns. ` +
          `Pin "sha256": "${digest}" and "changedIn": "${version}" in ${FROZEN_HOOKS}, ` +
          `and tell users to rerun the installer in CHANGES.md's ${version} entry.`,
      );
    } else if (changed && Bun.semver.order(version, shipped.version) <= 0) {
      faults.push(`${path} differs from origin/main, which ships ${shipped.version}, so this change needs a VERSION newer than that, not ${version}`);
    } else if (changed && pin.changedIn !== version) {
      faults.push(`${path} differs from origin/main, so its pin's "changedIn" must be ${version}, not ${pin.changedIn}`);
    } else if (pin.changedIn === version && !/rerun the installer/i.test(entry)) {
      faults.push(`${path} changes in ${version}, but CHANGES.md's ${version} entry does not tell users to rerun the installer`);
    }
  }
  return faults;
}

// VERSION and `paths` as origin/main has them now, with undefined for a path
// main lacks. It fetches main first, so a branch cut before main's latest
// release is compared with that release and not with the merge-base.
function shippedOnMain(root, paths) {
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const main = "refs/remotes/origin/main";
  try {
    git("fetch", "--quiet", "--no-tags", "origin", `+refs/heads/main:${main}`);
  } catch (err) {
    throw new Error(`${FROZEN_HOOKS}: cannot fetch origin/main to compare the hooks files with: ${(err.stderr || err.message).trim()}`);
  }
  const listed = new Set(git("ls-tree", "-r", "--name-only", main, "--", "VERSION", ...paths).split("\n"));
  const show = (path) => (listed.has(path) ? git("show", `${main}:${path}`) : undefined);
  return { version: show("VERSION")?.trim(), files: Object.fromEntries(paths.map((path) => [path, show(path)])) };
}

// Every file the generator writes, as exact text by repo-relative path,
// computed from the sources under `root` without writing. Any other entry in
// an owned directory is an orphan. Throws when a source cannot be planned.
// Without `models`, plan loads the model policy from `root` itself.
export function plan(root, models) {
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  const version = read("VERSION").trim();
  if (!VERSION_LINE.test(version)) throw new Error(`VERSION must be MAJOR.MINOR.PATCH[-PRERELEASE], got "${version}"`);
  assertChangesHeading(read("CHANGES.md"), version);
  models ??= loadModels(root);

  // A stamp edits the text planned so far for its path, so producers on one
  // path compose. A put writes a whole file.
  const files = {};
  const stamp = (rel, edit) => {
    files[rel] = edit(files[rel] ?? read(rel));
  };
  for (const file of VERSIONED_MANIFESTS) stamp(file, (text) => stampVersion(text, version, file));
  for (const file of new Set(t3Regions(models).map((r) => r.file))) {
    stamp(file, (text) => applyRegions(file, text, models, { strict: true }));
  }
  stamp(`${PLUGIN}/.claude-plugin/plugin.json`, (text) => stampAgentPaths(text, pluginAgentPaths(join(root, PLUGIN))));
  const claude = JSON.parse(files[`${PLUGIN}/.claude-plugin/plugin.json`]);
  files[`${CURSOR_PLUGIN}/plugin.json`] = `${JSON.stringify(cursorManifest(claude), null, 2)}\n`;
  files[`${CURSOR_PLUGIN}/rules/session-start.mdc`] = cursorRule(files[`${PLUGIN}/hooks/session-start-context.md`] ?? read(`${PLUGIN}/hooks/session-start-context.md`), claude.name);
  const realRoot = realpathSync(root);
  for (const { source, target } of PORTABLE_ASSETS) {
    if (!pathIsInside(realRoot, realpathSync(join(root, source)))) {
      throw new Error(`${source} resolves outside the repository through a symlink`);
    }
    files[`${LICENSES}/${target}`] = read(source);
  }
  return { files, ownedDirs: OWNED_DIRS };
}

function lstatNoSymlinks(root, path) {
  let at = root;
  let st = null;
  for (const part of path.split("/")) {
    at = join(at, part);
    st = lstatSync(at, { throwIfNoEntry: false });
    if (!st) return null;
    if (st.isSymbolicLink()) throw new Error(`${relative(root, at)} is a symlink; the generator never writes through one`);
  }
  return st;
}

export function changes(root, intended) {
  const pending = [];
  for (const [path, text] of Object.entries(intended.files)) {
    const st = lstatNoSymlinks(root, path);
    if (st && !st.isFile()) throw new Error(`${path} is not a regular file; the generator never overwrites one`);
    if (!st || readFileSync(join(root, path), "utf8") !== text) pending.push({ kind: "write", path });
  }
  const planned = Object.keys(intended.files);
  for (const dir of intended.ownedDirs) {
    if (!lstatNoSymlinks(root, dir)) continue;
    pending.push(...orphansUnder(root, dir, planned));
  }
  return pending;
}

function orphansUnder(root, dir, planned) {
  const pending = [];
  const visit = (rel) => {
    for (const entry of readdirSync(join(root, rel)).sort()) {
      const path = `${rel}/${entry}`;
      const holdsPlanned = planned.some((plannedPath) => plannedPath.startsWith(`${path}/`));
      if (!holdsPlanned && !planned.includes(path)) pending.push({ kind: "remove", path });
      else if (holdsPlanned) visit(path);
    }
  };
  visit(dir);
  return pending;
}

export function apply(root, intended, { log = console.log } = {}) {
  const pending = changes(root, intended);
  for (const { kind, path } of pending) {
    const full = join(root, path);
    if (kind === "remove") {
      rmSync(full, { recursive: true, force: true });
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, intended.files[path]);
    }
    log(`${kind}: ${path}`);
  }
  return pending;
}

// Every cross-file contract the tree under `root` breaks, one message per
// failing check. The checks read the tree, not the plan, so on a stale tree
// they see the stale copies. Without `models`, the policy load is one of the checks.
export function problems(root, models) {
  const failures = [];
  const attempt = (check) => {
    try {
      return check();
    } catch (err) {
      failures.push(err.message);
    }
  };
  const pluginRoot = join(root, PLUGIN);
  const skillsDir = join(root, SKILLS);
  const read = (rel) => readFileSync(join(root, rel), "utf8");
  if (!models) attempt(() => loadModels(root));
  attempt(() => agentSkills(skillsDir));
  attempt(() => validateSkillsTree(skillsDir));
  attempt(() => validatePluginLayout(pluginRoot));
  attempt(() => validateAgentFrontmatter(pluginRoot));
  const codex = attempt(() => JSON.parse(read(CODEX_MANIFEST)));
  if (codex) {
    attempt(() =>
      validateCodexMarketplace(read(".agents/plugins/marketplace.json"), {
        expectedName: codex.name,
        pathExists: (rel) => existsSync(join(root, rel)),
      }),
    );
  }
  const statOf = (rel) => {
    const full = join(pluginRoot, rel);
    if (!existsSync(full) || !pathIsInside(realpathSync(pluginRoot), realpathSync(full))) return null;
    return statSync(full);
  };
  const hookFiles = ["hooks/hooks.json", ...(codex?.hooks ? [codex.hooks.replace(/^\.\//, "")] : [])];
  for (const file of hookFiles) {
    attempt(() => validateHooks(readFileSync(join(pluginRoot, file), "utf8"), { statOf, file }));
  }
  // A Codex manifest that does not parse names no hooks file to compare.
  if (codex) attempt(() => {
    const paths = hookFiles.map((file) => `${PLUGIN}/${file}`);
    const faults = frozenHookFaults({
      pins: JSON.parse(read(FROZEN_HOOKS)),
      files: Object.fromEntries(paths.map((path) => [path, read(path)])),
      version: read("VERSION").trim(),
      changelog: read("CHANGES.md"),
      shipped: shippedOnMain(root, paths),
    });
    if (faults.length) throw new Error(faults.join("\n"));
  });
  return failures;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check")) throw new Error("usage: bun tools/generate.mjs [--check]");
  const check = args.includes("--check");
  const models = loadModels(repo);
  const intended = plan(repo, models);
  const failures = [];
  let pending;
  try {
    pending = check ? changes(repo, intended) : apply(repo, intended);
  } catch (err) {
    failures.push(err.message);
  }
  failures.push(...problems(repo, models));
  if (check && pending?.length) {
    failures.push(
      "generated output is stale; run bun tools/generate.mjs:\n" +
        pending.map(({ kind, path }) => `  ${kind}: ${path}`).join("\n"),
    );
  }
  if (pending?.length === 0) console.log(`ok: ${Object.keys(intended.files).length} generated files current`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  if (failures.length) process.exit(1);
  console.log("ok: skill frontmatter, links, plugin layout, agent frontmatter, Codex marketplace, and hooks pass their checks");
}

// Guarded so importing the generator's validation and rendering functions does
// not regenerate the repo as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exit(1);
  }
}
