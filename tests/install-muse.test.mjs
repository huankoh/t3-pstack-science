import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { calls, hookId, agents, installer, isolatedHome, pluginRoot, readState, repoRoot, setState, version, writeJson } from "./install-muse-shared.mjs";

const sandboxes = [];
afterEach(() => { while (sandboxes.length) sandboxes.pop().cleanup(); });
function sandbox() {
  const s = isolatedHome();
  sandboxes.push(s);
  const script = join(repoRoot, "tests/fake-muse.mjs");
  writeFileSync(join(s.bin, process.platform === "win32" ? "muse.cmd" : "muse"), process.platform === "win32"
    ? `@"${Bun.which("node")}" "${script}" %*\r\n`
    : `#!/bin/sh\nexec "${Bun.which("node")}" "${script}" "$@"\n`, { mode: 0o755 });
  return s;
}
function run(s, command, ...args) {
  const r = installer(s, [command, "--muse", "--source", repoRoot, "--json", ...args]);
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout).homes.find((row) => row.harness === "muse");
}
const mutations = (s) => calls(s).filter((a) => ["install", "approve", "disable", "enable", "remove"].includes(a[1]));

describe("the opt-in Muse installer", () => {
  test("installs at user scope, approves only our hook and manifest agents, and disables built-in git once", () => {
    const s = sandbox();
    const row = run(s, "install");
    expect(calls(s)).toContainEqual(["plugins", "install", pluginRoot, "--scope", "user", "--json"]);
    const approvals = calls(s).filter((a) => a[1] === "approve").map((a) => a[2]);
    expect(approvals.sort()).toEqual([hookId, ...agents.map((name) => `t3-pstack-science:agent_definition:t3-pstack-science/${name}`)].sort());
    expect(row.steps.filter((step) => step.startsWith("approved ")).length).toBe(1 + agents.length);
    expect(calls(s)).toContainEqual(["skills", "disable", "git", "--scope", "built-in"]);
    expect(readState(s).git).toBe("off");
    expect(row.checks.every((c) => c.ok)).toBe(true);
    const before = mutations(s);
    expect(run(s, "install").steps).toEqual([]);
    expect(mutations(s)).toEqual(before);
    const text = installer(s, ["update", "--muse"]);
    expect(text.status, text.stderr).toBe(0);
    expect(text.stdout).toContain("Nothing to change.");
  });

  test("a new version replaces the old record and a changed file at the same version is refreshed", () => {
    const s = sandbox();
    run(s, "install");
    const state = readState(s);
    const cache = state.plugins[0].cache_path;
    const source = join(s.home, "new-source");
    for (const path of [".claude-plugin", ".agents", "plugins/pstack", "tools/frozen-hooks.json"]) cpSync(join(repoRoot, path), join(source, path), { recursive: true, filter: (p) => !p.includes("node_modules") });
    const manifest = join(source, "plugins/pstack/.claude-plugin/plugin.json");
    writeJson(manifest, { ...JSON.parse(readFileSync(manifest, "utf8")), version: "0.0.1" });
    expect(run(s, "update", "--source", source).steps).toContain(`updated Muse ${version} to 0.0.1`);
    expect(run(s, "update").steps).toContain(`updated Muse 0.0.1 to ${version}`);
    expect(readState(s).plugins.filter((p) => p.id === "t3-pstack-science")).toHaveLength(1);
    writeFileSync(join(cache, "hooks/session-start-context.md"), "broken");
    expect(run(s, "update").steps).toContain(`refreshed Muse ${version}`);
  });

  test("doctor reports every Muse row and detects broken approval, version, git, and hook context", () => {
    const s = sandbox();
    run(s, "install");
    const row = run(s, "doctor");
    expect(row.steps).toEqual([]);
    expect(row.checks.map((c) => c.name)).toEqual(["CLI", "installed", "session hook approved", "agents approved", "built-in git", "session context"]);
    expect(row.checks[0].detail).toContain("Muse Code 1.4.11");
    setState(s, { approvals: [], git: "on", badContext: true });
    const r = installer(s, ["doctor", "--muse", "--json"]);
    expect(r.status).toBe(1);
    const bad = JSON.parse(r.stdout).homes.find((h) => h.harness === "muse").checks;
    expect(bad.filter((c) => !c.ok).map((c) => c.name)).toEqual(["session hook approved", "agents approved", "built-in git", "session context"]);
  });

  test("uninstall removes only this plugin and restores git only when we disabled it", () => {
    const s = sandbox();
    run(s, "install");
    setState(s, { plugins: [...readState(s).plugins, { id: "other", version: "1" }] });
    const removed = run(s, "uninstall");
    expect(removed.steps).toContain("re-enabled Muse's built-in git skill");
    expect(readState(s)).toMatchObject({ git: "on", plugins: [{ id: "other", version: "1" }] });
    expect(run(s, "uninstall").steps).toEqual(["nothing to remove"]);
    setState(s, { git: "off" });
    run(s, "install");
    run(s, "uninstall");
    expect(readState(s).git).toBe("off");
    expect(calls(s).filter((a) => a[0] === "skills" && a[1] === "enable")).toHaveLength(1);
  });

  test("a failed git disable can be retried before uninstall", () => {
    const s = sandbox();
    run(s, "install");
    run(s, "uninstall");
    setState(s, { fail: "skills disable" });
    const failed = installer(s, ["install", "--muse", "--json"]);
    expect(failed.status).toBe(1);
    setState(s, { fail: null });
    run(s, "install");
    run(s, "uninstall");
    expect(readState(s).git).toBe("on");
  });

  test("discovers T3's configured binary before PATH, and falls back to ~/.local/bin/muse", () => {
    const s = sandbox();
    const binary = join(s.bin, process.platform === "win32" ? "muse.cmd" : "muse");
    const configured = join(s.home, process.platform === "win32" ? "configured.cmd" : "configured");
    cpSync(binary, configured);
    rmSync(binary);
    writeJson(join(s.home, ".t3/userdata/settings.json"), { providerInstances: { muse: { config: { binaryPath: `~/${configured.split(/[\\/]/).at(-1)}` } } } });
    expect(run(s, "install").checks[0].detail).toContain(configured);
    rmSync(join(s.home, ".t3"), { recursive: true });
    const fallback = join(s.home, ".local/bin", process.platform === "win32" ? "muse.cmd" : "muse");
    writeJson(join(s.home, ".local/bin/placeholder.json"), {});
    renameSync(configured, fallback);
    expect(run(s, "doctor").checks[0].detail).toContain(fallback);
    writeJson(join(s.home, ".t3/userdata/settings.json"), { providerInstances: { muse: { config: { binaryPath: "~/missing-muse" } } } });
    expect(installer(s, ["doctor", "--muse"]).status).toBe(1);
  });

  test("missing CLI fails only with --muse, and plain commands never call Muse", () => {
    const s = sandbox();
    for (const command of ["install", "update", "doctor"]) {
      expect(installer(s, [command]).status).toBe(0);
    }
    expect(calls(s)).toEqual([]);
    rmSync(join(s.bin, process.platform === "win32" ? "muse.cmd" : "muse"));
    for (const command of ["install", "update", "doctor"]) {
      const r = installer(s, [command, "--muse", "--json"]);
      expect(r.status, r.stderr).toBe(1);
      const row = JSON.parse(r.stdout).homes.find((h) => h.harness === "muse");
      expect(row.checks).toEqual([expect.objectContaining({ name: "CLI", ok: false, detail: expect.stringContaining("not found") })]);
    }
  });

  test("--muse combines with --cursor for install, doctor, and uninstall", () => {
    const s = sandbox();
    for (const command of ["install", "doctor", "uninstall"]) {
      const r = installer(s, [command, "--muse", "--cursor", "--json"]);
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout).homes.map((h) => h.harness)).toContain("cursor");
      expect(JSON.parse(r.stdout).homes.map((h) => h.harness)).toContain("muse");
    }
    expect(existsSync(join(s.home, ".cursor/plugins/local/t3-pstack-science"))).toBe(false);
  });

  test("re-enables our disabled plugin and respects an explicit session hook off sheet", () => {
    const s = sandbox();
    run(s, "install");
    const plugins = readState(s).plugins;
    plugins[0].enabled = false;
    setState(s, { plugins });
    expect(run(s, "update").steps).toContain("enabled Muse t3-pstack-science");
    writeJson(join(s.home, ".config/t3-pstack-science/placeholder.json"), {});
    writeFileSync(join(s.home, ".config/t3-pstack-science/models.md"), "session hook: off\n");
    expect(run(s, "doctor").checks.at(-1)).toMatchObject({ ok: true, detail: expect.stringContaining("session hook: off") });
  });
});
