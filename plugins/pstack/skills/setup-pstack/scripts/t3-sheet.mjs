#!/usr/bin/env node
// The T3 override sheet: one `<role>: <entry>` line per role, or a
// comma-separated list for a panel role. An entry is
// `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, or
// `inherit-parent` (alias `auto`). An entry maps one to one onto a
// `delegate_task` target, so this file is the only place the grammar lives:
// the generator checks the models.json tiers with it, and setup-pstack checks
// a sheet against the live `orchestrator_capabilities` catalog with it.
//
//   node t3-sheet.mjs [--mode standard|muse] <sheet.md> <catalog.json>
//
// prints one line per problem and exits 1 when there is any.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const GENERAL = "general";
export const SCIENCE = "science";
export const DOMAINS = Object.freeze([GENERAL, SCIENCE]);
export const MUSE = "muse";
const STANDARD = "standard";
export const SHEET_DIR = "t3-pstack-science";
const STANDARD_SPEED = { fastMode: "false", serviceTier: "default" };

/**
 * @typedef {object} Models
 * @property {{ general: Domain, science: Domain }} domains Ordered columns, general then science.
 * @property {Role[]} roles Ordered labels shared by every column.
 * @property {Muse} [muse] Muse mode policy, one tier per standard tier.
 * @typedef {object} Muse
 * @property {string[]} on Phrases that switch muse mode on.
 * @property {string[]} off Phrases that switch it off.
 * @property {Record<string, string | string[]>} tiers No null; every tier seats.
 * @typedef {object} Domain
 * @property {string} [covers]
 * @property {string[]} [termReaders] Families allowed to read this column's terms.
 * @property {Record<string, string | string[] | null>} tiers Null omits a seat.
 * @typedef {object} Role
 * @property {string} role
 * @property {string} [alias] Released sheet label, accepted only in general.
 * @property {string} tier
 * @property {string} skill
 * @typedef {object} Seat
 * @property {string} key
 * @property {string | null} alias
 * @property {string} domain
 * @property {string} role
 * @property {string} skill
 * @property {boolean} panel
 * @property {{ entry: string, termFree: boolean }[]} defaults `termFree` marks a default that gets a term-free brief. On a science seat it always applies. On a muse seat it applies only when the task is science, never for general tasks. A muse default whose family is in science `termReaders` is unmarked; one outside it (Opus) is marked.
 */

const INHERIT = ["inherit-parent", "auto"];
const HOOK_VALUES = ["on", "off"];

// Throws on a malformed entry; returns null for an inherit alias.
export function parseEntry(text) {
  const [target, ...pairs] = text.trim().split(/\s+/);
  if (INHERIT.includes(target)) {
    if (pairs.length) throw new Error(`"${text.trim()}": ${target} takes no options`);
    return null;
  }
  const match = target.match(/^([A-Za-z0-9_-]+)\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)$/);
  if (!match) throw new Error(`"${text.trim()}" does not start with <providerInstanceId>/<modelId>`);
  const options = Object.create(null);
  for (const pair of pairs) {
    const option = pair.match(/^([A-Za-z0-9_]+)=([A-Za-z0-9._-]+)$/);
    if (!option) throw new Error(`"${text.trim()}": "${pair}" is not <optionId>=<value>`);
    if (option[1] in options) throw new Error(`"${text.trim()}" sets "${option[1]}" twice`);
    options[option[1]] = option[2];
  }
  return { providerInstanceId: match[1], model: match[2], options };
}

// The family is the first segment (`claude`, `gpt`, `grok`, `muse`) of the model ID's
// last `/` part, so a Claude model served by a Codex-driver pool still counts as
// Claude, and an OpenCode route prefix such as `openrouter/` decides nothing.
export const family = (model) => model.split("/").pop().split("-")[0];

// A panel's families among its concrete targets. An inherit entry does not
// count: one sheet serves every thread on the machine, so its family depends on
// the thread that dispatches.
export function panelFamilies(entries) {
  return new Set(entries.filter(Boolean).map((e) => family(e.model)));
}

const speedProblem = (id, value) =>
  `${id}=${value} is not standard speed, and this router never runs fast; write ${id}=${STANDARD_SPEED[id]}`;

const isFastSpeed = (id, value) => Object.hasOwn(STANDARD_SPEED, id) && value !== STANDARD_SPEED[id];

export function speedProblems({ options }) {
  return Object.entries(options)
    .filter(([id, value]) => isFastSpeed(id, value))
    .map(([id, value]) => speedProblem(id, value));
}

/** @param {Models} models Validated at build time by parseModels. @param {{ mode?: string }} [opts] `muse` lists the muse seats instead of the domain seats. @returns {Seat[]} */
export function seats(models, { mode = STANDARD } = {}) {
  if (mode === MUSE) {
    if (!models.muse) return [];
    const termReaders = models.domains?.[SCIENCE]?.termReaders;
    return models.roles.map((role) => {
      const value = models.muse.tiers[role.tier];
      return {
        key: `${MUSE} ${role.role}`,
        alias: null,
        domain: MUSE,
        role: role.role,
        skill: role.skill,
        panel: Array.isArray(value),
        defaults: [value].flat().map((entry) => ({
          entry,
          termFree: !!termReaders && !termReaders.includes(family(parseEntry(entry).model)),
        })),
      };
    });
  }
  return DOMAINS.flatMap((domain) => {
    const { tiers, termReaders } = models.domains[domain];
    return models.roles.flatMap((role) => {
      const value = tiers[role.tier];
      if (value === null) return [];
      return [{
        key: domain === GENERAL ? role.role : `${domain} ${role.role}`,
        alias: domain === GENERAL ? role.alias ?? null : null,
        domain,
        role: role.role,
        skill: role.skill,
        panel: Array.isArray(value),
        defaults: [value].flat().map((entry) => ({
          entry,
          termFree: !!termReaders && !termReaders.includes(family(parseEntry(entry).model)),
        })),
      }];
    });
  });
}

// Every line but blank lines and `#` headings, as `{ line, key, value }`, with
// no key or value when the line is not exactly `<key>: <value>`. setup-pstack
// writes the sheet, so it holds no prose, and one strict rule leaves no shape a
// misspelled role line can slip through.
export function parseSheet(markdown) {
  return markdown
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .flatMap((line, i) => {
      if (line.trim() === "" || line.startsWith("#")) return [];
      const match = line.match(/^([a-z][a-z ,-]*[a-z]): (\S(?:.*\S)?)$/);
      return [{ line: i + 1, key: match?.[1], value: match?.[2] }];
    });
}

/** @param {{ line: number, key?: string, value?: string }[]} sheet
 * @param {{ models: Models, catalog: object | null, mode?: string }} context `muse` checks the muse seats' omitted defaults instead of the standard ones.
 */
export function checkSheet(sheet, { models, catalog, mode = STANDARD }) {
  const problems = [];
  const standard = seats(models);
  const muse = seats(models, { mode: MUSE });
  const all = [...standard, ...muse];
  const byKey = new Map(all.flatMap((s) => [[s.key, s], ...(s.alias ? [[s.alias, s]] : [])]));
  const seen = new Set();
  for (const { line, key, value } of sheet) {
    if (!key) {
      problems.push(`line ${line}: not a "<role>: <value>" line (lowercase role, one space after the colon, no indent or markup)`);
      continue;
    }
    const canonical = byKey.get(key)?.key ?? key;
    if (seen.has(canonical)) problems.push(`"${key}" appears twice; only one line may set it`);
    seen.add(canonical);
    if (key === "session hook") {
      if (!HOOK_VALUES.includes(value)) problems.push(`session hook: "${value}" is not on or off`);
      continue;
    }
    if (key === "default effort") {
      problems.push("default effort: T3 entries carry their own options; delete this line");
      continue;
    }
    const seat = byKey.get(key);
    if (!seat) {
      problems.push(unknownKey(key, all, models));
      continue;
    }
    const texts = value.split(",");
    if (!seat.panel && texts.length > 1) problems.push(`${key}: takes one entry, not a list`);
    const entries = [];
    for (const text of texts) {
      try {
        entries.push(parseEntry(text));
      } catch (err) {
        problems.push(`${key}: ${err.message}`);
      }
    }
    const runnable = [];
    const isMuse = seat.domain === MUSE;
    for (const entry of entries.filter(Boolean)) {
      const found = entryProblems(entry, catalog, { includeUnavailable: !isMuse || mode === MUSE });
      problems.push(...found.map((p) => `${key}: ${p}`));
      if (!found.length) runnable.push(entry);
    }
    if (isMuse) {
      for (const text of texts.map((t) => t.trim()).filter((t) => INHERIT.includes(t))) {
        problems.push(`${key}: "${text}" is not allowed on a muse line; write a target`);
      }
    }
    const targets = texts.map((t) => t.trim()).filter((t) => !INHERIT.includes(t));
    if (new Set(targets).size < targets.length) problems.push(`${key}: lists the same target twice`);
    if (seat.panel) {
      const families = panelFamilies(runnable);
      if (families.size < 2) {
        problems.push(
          `${key}: a panel needs at least two model families among its targets (inherit-parent does not count), got ${[...families].join(", ") || "none"}`,
        );
      }
    }
  }
  for (const seat of (mode === MUSE ? muse : standard).filter((s) => !seen.has(s.key))) {
    for (const { entry } of seat.defaults) {
      problems.push(...entryProblems(parseEntry(entry), catalog).map((p) => `${seat.key} (no line, tier default): ${p}`));
    }
  }
  return problems;
}

function unknownKey(key, all, models) {
  const general = all.find((s) => s.domain === GENERAL && key === `${GENERAL} ${s.key}`);
  if (general) return `"${key}": unprefixed lines set the general column; write "${general.key}"`;
  const elsewhere = all.find((s) => s.role === key);
  if (elsewhere && !all.some((s) => s.domain === GENERAL && s.role === key)) {
    return `"${key}" has no general seat; write "${elsewhere.key}"`;
  }
  const role = models.roles.find((r) => r.alias && key === `${SCIENCE} ${r.alias}`);
  if (role) return `"${key}": write "${SCIENCE} ${role.role}"; the old name counts only on an unprefixed line`;
  for (const prefix of [`${MUSE} ${SCIENCE} `, `${SCIENCE} ${MUSE} `]) {
    if (key.startsWith(prefix)) {
      const museRole = models.roles.find((r) => r.role === key.slice(prefix.length) || r.alias === key.slice(prefix.length));
      if (museRole) return `"${key}": a muse seat takes no domain; write "${MUSE} ${museRole.role}"`;
    }
  }
  const museAlias = models.roles.find((r) => r.alias && key === `${MUSE} ${r.alias}`);
  if (museAlias) return `"${key}": write "${MUSE} ${museAlias.role}"; the old name counts only on an unprefixed line`;
  return `"${key}" is not a pstack role`;
}

function catalogOptions({ providerInstanceId, model }, catalog) {
  if (!catalog) return { known: null };
  const at = `${providerInstanceId}/${model}`;
  const provider = catalog.providers.find((p) => p.providerInstanceId === providerInstanceId);
  if (!provider) return { known: null, unavailable: `${at}: no provider instance "${providerInstanceId}" in this T3` };
  if (!provider.canRunChildTask || provider.canRunCrossProviderChildTask === false) {
    const why = (provider.constraints ?? []).join(" ");
    return { known: null, unavailable: `${at}: "${providerInstanceId}" cannot run child tasks${why ? ` (${why})` : ""}` };
  }
  const listed = provider.models.find((m) => m.id === model);
  if (!listed) return { known: null, unavailable: `${at}: "${providerInstanceId}" does not list model "${model}"` };
  return { known: listed.options ?? [] };
}

function entryProblems(target, catalog, { includeUnavailable = true } = {}) {
  const { providerInstanceId, model, options } = target;
  const at = `${providerInstanceId}/${model}`;
  const { known, unavailable } = catalogOptions(target, catalog);
  const problems = [];
  for (const [id, value] of Object.entries(options)) {
    const option = known?.find((o) => o.id === id);
    const speed = Object.hasOwn(STANDARD_SPEED, id);
    if (known && !option) {
      problems.push(`${at}: no option "${id}" (has ${known.map((o) => o.id).join(", ") || "none"})${speed ? `; delete ${id}` : ""}`);
    } else if (isFastSpeed(id, value)) {
      problems.push(`${at}: ${speedProblem(id, value)}${known ? "" : `, or delete ${id} if the model lists no such option`}`);
    } else if (option) {
      const allowed = option.type === "boolean" ? ["true", "false"] : (option.options ?? []).map((o) => o.id);
      if (!allowed.includes(value)) problems.push(`${at}: ${id}=${value} is not one of ${allowed.join(", ")}`);
    }
  }
  for (const option of known ?? []) {
    if (Object.hasOwn(STANDARD_SPEED, option.id) && !Object.hasOwn(options, option.id)) {
      problems.push(`${at}: sets no ${option.id}; this router never runs fast, so write ${option.id}=${STANDARD_SPEED[option.id]}`);
    }
  }
  if (unavailable && includeUnavailable) problems.push(unavailable);
  return problems;
}

const invoked = process.argv[1] && existsSync(process.argv[1]) ? realpathSync(process.argv[1]) : null;
if (invoked === fileURLToPath(import.meta.url)) {
  const usage = () => {
    console.error("usage: t3-sheet.mjs [--mode standard|muse] <sheet.md> <catalog.json>");
    process.exit(2);
  };
  const args = process.argv.slice(2);
  let mode = STANDARD;
  const paths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--mode") {
      const value = args[++i];
      if (value !== STANDARD && value !== MUSE) usage();
      mode = value;
    } else if (args[i].startsWith("--")) {
      usage();
    } else {
      paths.push(args[i]);
    }
  }
  if (paths.length !== 2) usage();
  const [sheetPath, catalogPath] = paths;
  const models = JSON.parse(readFileSync(new URL("../../../models.json", import.meta.url), "utf8"));
  const problems = checkSheet(parseSheet(readFileSync(sheetPath, "utf8")), {
    models,
    catalog: JSON.parse(readFileSync(catalogPath, "utf8")),
    mode,
  });
  for (const problem of problems) console.log(problem);
  if (problems.length) process.exit(1);
  console.log("ok: every role line parses and dispatches on this T3");
}
