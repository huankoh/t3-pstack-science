// The T3 form of an upstream file, as tools/sync.mjs derives it after the
// substitutions and tools/generate.mjs stamps it: the port's frontmatter, then
// the regions rendered from plugins/pstack/models.json. Models sections carry
// the column gate and term rule. Anchored dispatch hooks live in substitutions.

import { DOMAINS, GENERAL, SCIENCE, SHEET_DIR, seats } from "../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { code } from "./plugin.mjs";

// Split a Markdown file into its YAML frontmatter and the text after it.
// `data` is null when the file does not open with a frontmatter block.
export function parseFrontmatter(text) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!block) return { data: null, body: text };
  return { data: Bun.YAML.parse(block[1]) ?? {}, body: text.slice(block[0].length) };
}

// Frontmatter keys only Cursor reads. The port drops each with any indented
// continuation lines and blank paragraphs.
const CURSOR_ONLY_KEYS = /^(?:mode|icon|color|reminder|is_background):/;

// The skill the session-start hook invokes by name. Upstream marks every skill
// disable-model-invocation: true, which makes the Skill tool refuse it, so the
// port drops the flag here and nowhere else. The other skills stay manual-only,
// as upstream ships them, and poteto-mode reads them by path.
export const ROUTED_SKILL = "poteto-mode";

// The port's frontmatter for an upstream skill or plugin agent: `name` is the
// skill's directory or the agent's file name, which is how Claude Code and
// Codex register it, and Cursor-only keys go.
export function portFrontmatter(file, text) {
  const skill = file.match(/^plugins\/pstack\/skills\/([^/]+)\/SKILL\.md$/)?.[1];
  const name = skill ?? file.match(/^plugins\/pstack\/agents\/([^/]+)\.md$/)?.[1];
  if (!name) return text;
  const { body } = parseFrontmatter(text);
  const kept = [];
  let dropping = false;
  for (const line of text.slice(0, text.length - body.length).split("\n")) {
    dropping = CURSOR_ONLY_KEYS.test(line) || (dropping && /^(?:\s|$)/.test(line));
    if (dropping) continue;
    if (skill === ROUTED_SKILL && line === "disable-model-invocation: true") continue;
    kept.push(line.startsWith("name:") ? `name: ${name}` : line);
  }
  return kept.join("\n") + body;
}

// Locators find a stamped span of a file and return its [start, end) line
// range, or null when the anchor is absent.

// The body of a "## <title>" section: everything up to the next "## " heading or EOF.
export const section = (title) => (lines) => {
  const start = lines.indexOf(`## ${title}`);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("## ")) end++;
  return [start + 1, end];
};

// The rows under a markdown table header (header line, separator, then every
// consecutive line starting with rowPrefix).
export const tableRows = (header, rowPrefix) => (lines) => {
  const start = lines.indexOf(header);
  if (start === -1) return null;
  let end = start + 2;
  while (end < lines.length && lines[end].startsWith(rowPrefix)) end++;
  return [start + 2, end];
};

// The inside of the first ```<lang> fence after the `### N. <title>` step
// heading. The ordinal is not part of the anchor.
export const fenceUnder = (title, lang) => (lines) => {
  const step = lines.findIndex((l) => l.replace(/^### \d+\. /, "### ") === `### ${title}`);
  if (step === -1) return null;
  const open = lines.indexOf("```" + lang, step);
  if (open === -1) return null;
  const close = lines.indexOf("```", open + 1);
  return close === -1 ? null : [open + 1, close];
};

const sheetProse =
  `A line in the model sheet overrides each default. \`<role>: <entry>\` sets the ${GENERAL} column, as in every sheet written before domains, and \`${SCIENCE} <role>: <entry>\` sets the ${SCIENCE} column. ` +
  `The sheet is \`~/.config/${SHEET_DIR}/models.md\` (\`$XDG_CONFIG_HOME/${SHEET_DIR}/models.md\` when that is set), one per machine, and \`/setup-pstack\` writes it. ` +
  "When it is missing, use the defaults in the table below. " +
  "An entry is `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, and it " +
  "maps onto `delegate_task`'s `target`, with the provider instance as `providerInstanceId`, the model as `model`, " +
  "and the pairs as `options`. It splits at its first `/`, so a model ID with its own `/`, such as OpenCode's " +
  "`<provider>/<model>`, is written whole after it. Option IDs differ per provider, so take them from " +
  "`orchestrator_capabilities`. `inherit-parent` or `auto` omits `target`.";

function routerProse(models) {
  const { covers, termReaders } = models.domains[SCIENCE];
  const translator = seats(models).find((s) => s.key === `${SCIENCE} how explorer`);
  if (!translator || translator.defaults.length !== 1 || translator.defaults[0].termFree) {
    throw new Error(`models.json: "${SCIENCE} how explorer" needs a default that reads the domain terms`);
  }
  const families = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(termReaders.map(code));
  const gate =
    `For each task, before step 1 and before the first \`delegate_task\`, the chat picks the task's column and records it in the todolist as \`domain: ${SCIENCE}\` when the task is ${covers}, else as \`domain: ${GENERAL}\`. ` +
    `When the task changes, pick the domain again. When unsure, pick \`${SCIENCE}\`. If the skill opens no todolist, record the domain in the first reply. ` +
    "The chat picks the column, writes each brief, and dispatches each step a skill delegates. " +
    `Every role resolves from that column, so wherever a skill names a role's line, read \`<role>:\` under \`domain: ${GENERAL}\` and \`${SCIENCE} <role>:\` under \`domain: ${SCIENCE}\`. ` +
    "The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, up to `max` and never a level above it.";
  const terms =
    `In \`${SCIENCE}\`, only ${families} models read the domain's terms. A \`${SCIENCE}\` dispatch to any other family carries a term-free brief. A default marked (term-free brief) gets one. ` +
    "Resolve an `inherit-parent` or `auto` seat's family from `orchestrator_capabilities`' `inheritedModel` before choosing its brief; an unknown family gets a term-free brief. " +
    `A term-free brief states inputs, outputs, data shapes, invariants, formulas, and acceptance tests in plain math and code, with no vocabulary of ${covers}. ` +
    '`<plugin root>` is the directory that holds this plugin\'s `skills/`. Write the brief to a file and run `node "<plugin root>/skills/setup-pstack/scripts/term-free.mjs" "<file>"`, adding `--term <word>` for each domain word the task itself uses. ' +
    "The check knows only the listed terms and does not prove a brief is term-free, so write the brief term-free first and use the check as a last guard. " +
    "It exits 1 and lists each term it finds. Rewrite each listed scientific word. A listed word used in its ordinary code or math sense, such as a library, API, or variable name, may stay, and the dispatch ledger names it. " +
    "When a term-free seat still treats a brief as biological research, add the words that set it off to `science-terms.txt` in a PR, with the brief excerpt as the example. " +
    "Stage neutral copies of the code, data, and diffs that seat needs in its own directory, check each text input with the same command, and never point the seat at the original scientific files, papers, transcripts, or diffs. " +
    `When the work cannot be stated without the terms, have a research delegate on the \`${translator.key}\` line translate it first (its default reads the terms). ` +
    "If that seat's family does not read the terms, the translation stays blocked; never route raw context to it.";
  return `${gate}\n\n${terms}\n\n${sheetProse}`;
}

const defaultCell = (value) => value ? `${code(value.entry)}${value.termFree ? " (term-free brief)" : ""}` : "none";
const cell = (seat) => seat ? seat.defaults.map(defaultCell).join(", ") : "none";

export function modelsSection(models, roles) {
  const byRole = Map.groupBy(seats(models), (s) => s.role);
  const header = `| Role | ${DOMAINS.join(" | ")} |\n| --- |${" --- |".repeat(DOMAINS.length)}`;
  const rows = roles.map((role) => {
    const label = role.role + (role.alias ? ` (a \`${role.alias}\` line counts as this role)` : "");
    const columns = DOMAINS.map((domain) => cell(byRole.get(role.role).find((s) => s.domain === domain)));
    return `| ${label} | ${columns.join(" | ")} |`;
  });
  return `Role defaults on T3, stamped from \`plugins/pstack/models.json\`, one column per domain. ${routerProse(models)}\n\n${header}\n${rows.join("\n")}`;
}

export function reviewerRows(models) {
  const reviewers = seats(models).filter((s) => s.role === "interrogate reviewers");
  const count = Math.max(...reviewers.map((s) => s.defaults.length));
  return Array.from({ length: count }, (_, i) =>
    `| Reviewer ${String.fromCharCode(65 + i)} | ${DOMAINS.map((domain) => `${domain} ${defaultCell(reviewers.find((s) => s.domain === domain)?.defaults[i])}`).join("; ")} |`,
  );
}

export function sheetBlock(models) {
  return [
    "# pstack model configuration (T3). One line per role and column. Delete a line to fall back to the skill default.",
    `# \`<role>:\` sets the ${GENERAL} column, as in every sheet before domains. \`${SCIENCE} <role>:\` sets the ${SCIENCE} column.`,
    "# `inherit-parent` or `auto` as a value: the role runs on the parent chat's model (`delegate_task` omits `target`). Alias entries in a panel list still count toward its fan-out.",
    "# budget: large (xhigh)",
    ...seats(models).map((s) => `${s.key}: ${s.defaults.map((d) => d.entry).join(", ")}`),
    "session hook: on",
  ];
}

const skillFile = (skill) => `plugins/pstack/skills/${skill}/SKILL.md`;
const padded = (text) => ["", ...text.split("\n"), ""];

// Every stamped region: its file, how to find it, and what it renders. A region
// with `appendHeading` is added as the last H2 when the file lacks it.
export function t3Regions(models) {
  const bySkill = Map.groupBy(models.roles, (r) => r.skill);
  return [
    ...[...bySkill].map(([skill, roles]) => ({
      file: skillFile(skill),
      name: "Models section",
      locate: section("Models"),
      appendHeading: "## Models",
      render: () => padded(modelsSection(models, roles)),
    })),
    {
      file: skillFile("interrogate"),
      name: "reviewer table",
      locate: tableRows("| Subagent | Default model |", "| Reviewer "),
      render: () => reviewerRows(models),
    },
    {
      file: skillFile("setup-pstack"),
      name: "sheet block",
      locate: fenceUnder("Write the sheet", "markdown"),
      render: () => sheetBlock(models),
    },
  ];
}

// Stamp every region in `file` (repo-relative). With strict, a missing anchor
// throws, because a stamped region is a contract with the file. Without it, a
// region whose anchor upstream lacks is left alone, so the file surfaces in the
// sync as forked or conflicted instead of aborting it.
export function applyRegions(file, text, models, { strict = false } = {}) {
  const lines = text.split("\n");
  const regions = t3Regions(models).filter((r) => r.file === file);
  for (const region of regions.filter((r) => r.appendHeading)) {
    if (region.locate(lines)) continue;
    if (lines.at(-1) !== "") lines.push("");
    lines.push(region.appendHeading, "");
  }
  for (const region of regions) {
    const range = region.locate(lines);
    if (!range) {
      if (strict) throw new Error(`${file}: no anchor for the ${region.name} to stamp`);
      continue;
    }
    lines.splice(range[0], range[1] - range[0], ...region.render());
  }
  return lines.join("\n");
}

export function deriveT3(file, text, models) {
  return applyRegions(file, portFrontmatter(file, text), models);
}
