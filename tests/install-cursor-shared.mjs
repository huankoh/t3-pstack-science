import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const lockFix = (lock, rerun = "rerun") => `if no t3-pstack-science install or uninstall is running, remove \`${lock}\` and ${rerun}`;

export function fingerprint(dir) {
  if (!existsSync(dir)) return null;
  const rows = [];
  const visit = (rel) => {
    const abs = join(dir, rel);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) {
      for (const name of readdirSync(abs).sort()) visit(rel ? `${rel}/${name}` : name);
      return;
    }
    rows.push(`${rel} ${createHash("sha256").update(readFileSync(abs)).digest("hex")}`);
  };
  visit("");
  return rows;
}
