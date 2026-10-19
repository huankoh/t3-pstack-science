// This fork reads only its machine sheet. Other plugins' sheets stay untouched.
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { checkSheet, parseSheet, SHEET_DIR } from "../../plugins/pstack/skills/setup-pstack/scripts/t3-sheet.mjs";
import { check, MARKETPLACE, SCIENCE_REPO } from "./common.mjs";

const SETUP_HINT = "run /t3-pstack-science:setup-pstack in a T3 thread";

export const sheetPath = (env, home) =>
  join(env.XDG_CONFIG_HOME?.trim() ? resolve(env.XDG_CONFIG_HOME.trim()) : join(home, ".config"), SHEET_DIR, "models.md");

const isFile = (path) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

export function doctorSheet(sheet, { catalog, models }) {
  if (!models?.domains) {
    return [check(
      "model policy", false, "models.json predates domains; install a t3-pstack-science source",
      `remove the existing \`${MARKETPLACE}\` marketplace from each affected home, then run \`npx -y github:${SCIENCE_REPO} install --source ${SCIENCE_REPO}\` (or set --source to a t3-pstack-science checkout)`,
    )];
  }
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
