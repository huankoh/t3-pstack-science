import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkSheet, parseSheet, SHEET_DIR } from "../../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { check } from "./common.mjs";

const SETUP_HINT = "run /t3-pstack-science:setup-pstack in a T3 thread";

export const sheetPath = (env, home) =>
  join(env.XDG_CONFIG_HOME?.trim() ? resolve(env.XDG_CONFIG_HOME.trim()) : join(home, ".config"), SHEET_DIR, "models.md");

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

// The shell hooks read past a stray byte
// (session-start.ps1 always, read-sheet.sh in a C locale), and this check
// keeps the rule on for a sheet that does not decode.
export function sessionHookOff(sheet) {
  let text;
  try {
    if (!isFile(sheet)) return false;
    const bytes = readFileSync(sheet);
    const utf16 = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe;
    text = new TextDecoder(utf16 ? "utf-16le" : "utf-8", { fatal: true }).decode(utf16 ? bytes.subarray(2) : bytes);
  } catch {
    return false;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.split("\n").some((line) => (line.endsWith("\r") ? line.slice(0, -1) : line) === "session hook: off");
}

export function doctorSheet(sheet, { catalog, models }) {
  if (!isFile(sheet)) {
    return [
      check("machine sheet", false, "none, so every role runs on its skill's defaults", SETUP_HINT, true),
    ];
  }
  const parsed = parseSheet(readFileSync(sheet, "utf8"));
  const problems = checkSheet(parsed, { models, catalog });
  return [
    check(
      "machine sheet valid",
      problems.length === 0,
      problems.length
        ? problems.join("; ")
        : catalog
          ? "every line parses and dispatches on the catalog"
          : "every line parses (pass --catalog to check targets)",
      SETUP_HINT,
    ),
  ];
}
