import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkSheet, parseSheet, SHEET_DIR } from "../../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { check } from "./common.mjs";

const SETUP_HINT = "run /t3-pstack-science:setup-pstack in a T3 thread";

export const sheetPath = (env, home) =>
  join(env.XDG_CONFIG_HOME?.trim() ? resolve(env.XDG_CONFIG_HOME.trim()) : join(home, ".config"), SHEET_DIR, "models.md");

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export function doctorSheet(sheet, { catalog, models }) {
  if (!isFile(sheet)) {
    return [check("machine sheet", false, "none, so every role runs on its skill's defaults", SETUP_HINT, true)];
  }
  const problems = checkSheet(parseSheet(readFileSync(sheet, "utf8")), { models, catalog });
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
