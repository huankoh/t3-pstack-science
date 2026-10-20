import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { agents, installer, isolatedHome, muse, pluginRoot, repoRoot, version, writeJson } from "./install-muse-shared.mjs";

const fallback = join(homedir(), ".local/bin/muse");
const candidate = Bun.which("muse") ?? (existsSync(fallback) ? fallback : null);
const probe = isolatedHome(candidate);
let binary;
try {
  const result = candidate && muse(probe, ["--version"]);
  binary = result?.status === 0 && /Muse Code/.test(result.stdout) ? candidate : null;
} finally { probe.cleanup(); }

function realSetupMetadata() {
  const snapshot = [];
  function walk(path) {
    if (!existsSync(path)) return;
    const st = lstatSync(path);
    snapshot.push([path, st.mode, st.size, st.mtimeMs, st.ctimeMs]);
    if (st.isDirectory()) for (const name of readdirSync(path).sort()) walk(join(path, name));
  }
  walk(join(homedir(), ".config/muse"));
  walk(join(homedir(), ".local/share/muse/plugins"));
  return snapshot;
}
const json = (s, args) => {
  const r = muse(s, [...args, "--json"]);
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout);
};
const install = (s, args) => {
  const r = installer(s, [...args, "--json"]);
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout);
};

describe.skipIf(!binary)("Muse Code's real plugin runtime in a throwaway home", () => {
  test("installs, approves, injects session context, converges, updates, and uninstalls with git restored", () => {
    const before = realSetupMetadata();
    const s = isolatedHome(binary);
    try {
      expect(json(s, ["plugins", "list"]).plugins).toEqual([]);
      expect(json(s, ["skills", "inspect", "git", "--source", "built-in"]).skill.activation).toBe("on");
      const report = install(s, ["install", "--muse", "--source", repoRoot]);
      const row = report.homes.find((h) => h.harness === "muse");
      expect(row.checks.every((c) => c.ok)).toBe(true);
      const info = json(s, ["plugins", "inspect", "t3-pstack-science"]);
      expect(info).toMatchObject({ active: true, valid: true, record: { version, enabled: true } });
      expect(info.runtime_capabilities).toHaveLength(1 + agents.length);
      expect(info.runtime_capabilities.every((c) => c.status === "trusted_enabled")).toBe(true);
      expect(info.agent_inventory.map((c) => c.candidate.scoped_definition_id).sort()).toEqual(agents.map((name) => `t3-pstack-science/${name}`));
      expect(json(s, ["skills", "inspect", "git", "--source", "built-in"]).skill.activation).toBe("off");

      const schemaDir = join(s.home, "schema");
      const schema = muse(s, ["schema", "generate-json-schema", "--out", schemaDir]);
      expect(schema.status, schema.stderr).toBe(0);
      const event = JSON.parse(readFileSync(join(schemaDir, "msp.schema.json"), "utf8")).$defs.HookEventName.enum.find((e) => e === "sessionStart");
      expect(event).toBe("sessionStart");
      const name = event[0].toUpperCase() + event.slice(1);
      const fixture = join(s.home, "session-start.json");
      writeJson(fixture, { event: name, matcher_input: "startup", cwd: repoRoot, stdin: { hook_event_name: name, source: "startup", session_id: "muse-installer-e2e", cwd: repoRoot } });
      const hook = info.runtime_capabilities.find((c) => c.candidate.kind === "hook").candidate.stable_id;
      const result = json(s, ["plugins", "hook", "test", hook, "--fixture", fixture]);
      expect(result.terminals).toHaveLength(1);
      expect(result.terminals[0]).toMatchObject({ status: "completed", exit_code: 0, effects: ["context"] });
      expect(result.decision.additional_contexts).toEqual([readFileSync(join(pluginRoot, "hooks/session-start-context.md"), "utf8").trimEnd()]);

      const again = install(s, ["update", "--muse", "--source", repoRoot]);
      expect(again.homes.find((h) => h.harness === "muse").steps).toEqual([]);
      expect(json(s, ["plugins", "inspect", "t3-pstack-science"]).record).toEqual(info.record);
      expect(install(s, ["doctor", "--muse", "--source", repoRoot]).failed).toBe(0);

      const source = join(s.home, "source");
      for (const path of [".claude-plugin", ".agents", "plugins/pstack", "tools/frozen-hooks.json"]) {
        cpSync(join(repoRoot, path), join(source, path), { recursive: true, filter: (p) => !p.includes("node_modules") });
      }
      const manifest = join(source, "plugins/pstack/.claude-plugin/plugin.json");
      const next = `${version}.e2e`;
      writeJson(manifest, { ...JSON.parse(readFileSync(manifest, "utf8")), version: next });
      const updated = install(s, ["update", "--muse", "--source", source]);
      expect(updated.homes.find((h) => h.harness === "muse").steps).toContain(`updated Muse ${version} to ${next}`);
      const plugins = json(s, ["plugins", "list"]).plugins.filter((p) => p.record.id === "t3-pstack-science");
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({ active: true, record: { version: next, enabled: true } });

      install(s, ["uninstall", "--muse"]);
      expect(json(s, ["plugins", "list"]).plugins).toEqual([]);
      expect(json(s, ["skills", "inspect", "git", "--source", "built-in"]).skill.activation).toBe("on");
      expect(existsSync(join(s.home, ".config/muse/t3-pstack-science-installer.json"))).toBe(false);
    } finally {
      s.cleanup();
      expect(realSetupMetadata()).toEqual(before);
    }
  }, 120_000);
  for (const approved of [true, false]) {
    test(`doctor never runs a modified ${approved ? "approved" : "unapproved"} hook`, () => {
      const before = realSetupMetadata();
      const s = isolatedHome(binary);
      try {
        expect(json(s, ["plugins", "list"]).plugins).toEqual([]);
        install(s, ["install", "--muse", "--source", repoRoot]);
        const info = json(s, ["plugins", "inspect", "t3-pstack-science"]);
        const hook = info.runtime_capabilities.find((c) => c.candidate.kind === "hook").candidate.stable_id;
        if (!approved) json(s, ["plugins", "reject", hook]);
        const marker = join(s.home, "unvalidated-hook-ran");
        const script = join(info.record.cache_path, "hooks/session-start.sh");
        writeFileSync(script, readFileSync(script, "utf8").replace("#!/bin/sh", `#!/bin/sh\ntouch "${marker}"`));
        const result = installer(s, ["doctor", "--muse", "--source", repoRoot, "--json"]);
        expect(result.status).toBe(1);
        expect(existsSync(marker)).toBe(false);
        const row = JSON.parse(result.stdout).homes.find((h) => h.harness === "muse");
        expect(row.checks.at(-1)).toMatchObject({ name: "session context", ok: false, detail: expect.stringContaining("skipped") });
      } finally {
        s.cleanup();
        expect(realSetupMetadata()).toEqual(before);
      }
    }, 120_000);
  }

});
