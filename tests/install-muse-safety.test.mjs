import { afterEach, expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { museHome } from "../tools/install/homes.mjs";
import { calls, installer, isolatedHome, pluginRoot, readState, repoRoot, setState, writeJson } from "./install-muse-shared.mjs";

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
const receiptPath = (s) => join(s.home, ".config/muse/t3-pstack-science-installer.json");
const receipt = (s) => JSON.parse(readFileSync(receiptPath(s), "utf8"));
const changes = (s) => calls(s).filter((a) => ["install", "approve", "disable", "enable", "remove"].includes(a[1]));
function run(s, command = "install", ...args) {
  const r = installer(s, [command, "--muse", "--json", ...args]);
  expect(r.status, `${r.stdout}\n${r.stderr}`).toBe(0);
  return JSON.parse(r.stdout).homes.find((h) => h.harness === "muse");
}
function failure(s, command, message, ...args) {
  const r = installer(s, [command, "--muse", "--json", ...args]);
  expect(r.status).toBe(1);
  expect(r.stdout).toContain(message);
  expect(r.stdout).not.toContain("TypeError");
  return JSON.parse(r.stdout).homes.find((h) => h.harness === "muse");
}

test("external removal leaves the user's later git disable alone and deletes the stale receipt", () => {
  const s = sandbox(); run(s);
  setState(s, { plugins: [], git: "off" });
  run(s, "uninstall");
  expect(readState(s).git).toBe("off");
  expect(existsSync(receiptPath(s))).toBe(false);
});

test("reinstall after external removal does not inherit git ownership", () => {
  const s = sandbox(); run(s);
  setState(s, { plugins: [], git: "off" });
  run(s); run(s, "uninstall");
  expect(readState(s).git).toBe("off");
});

test("failed disable records no ownership and uninstall leaves a later user disable alone", () => {
  const s = sandbox(); run(s); run(s, "uninstall");
  setState(s, { fail: "skills disable" });
  failure(s, "install", "simulated Muse failure");
  expect(readState(s).git).toBe("on");
  expect(receipt(s).disabledBuiltinGit).not.toBe(true);
  setState(s, { fail: null, git: "off" });
  run(s, "uninstall");
  expect(readState(s).git).toBe("off");
});

test("failed git restore keeps a pending uninstall that can be retried after removal", () => {
  const s = sandbox(); run(s);
  setState(s, { fail: "skills enable" });
  failure(s, "uninstall", "simulated Muse failure");
  expect(readState(s).plugins).toEqual([]);
  expect(receipt(s)).toMatchObject({ disabledBuiltinGit: true, uninstallPending: true });
  setState(s, { fail: null }); run(s, "uninstall");
  expect(readState(s).git).toBe("on");
  expect(existsSync(receiptPath(s))).toBe(false);
});

for (const gitShape of [{}, { enabled: true }, { activation: "auto" }, { activation: null }]) {
  test(`unknown skill activation ${JSON.stringify(gitShape)} changes nothing`, () => {
    const s = sandbox(); run(s);
    const before = readFileSync(receiptPath(s), "utf8");
    setState(s, { gitShape });
    const mutations = changes(s);
    for (const command of ["install", "uninstall"]) failure(s, command, "Muse CLI output is not supported by this installer; update t3-pstack-science");
    expect(readState(s).git).toBe("off");
    expect(changes(s)).toEqual(mutations);
    expect(readFileSync(receiptPath(s), "utf8")).toBe(before);
  });
}

test("unrecognized activation on a fresh home is rejected before plugin installation", () => {
  const s = sandbox();
  installer(s, ["doctor", "--muse"]);
  setState(s, { gitShape: { active: true } });
  failure(s, "install", "Muse CLI output is not supported by this installer; update t3-pstack-science");
  expect(changes(s)).toEqual([]);
});

test("same-id foreign records require an explicit matching source and uninstall never removes them", () => {
  const s = sandbox(); run(s);
  const plugins = readState(s).plugins;
  plugins[0].source.path = join(s.home, "foreign/plugins/pstack");
  setState(s, { plugins });
  const before = changes(s);
  failure(s, "install", "not managed");
  failure(s, "uninstall", "not managed");
  expect(changes(s)).toEqual(before);
  const source = join(s.home, "foreign");
  cpSync(join(repoRoot, ".claude-plugin"), join(source, ".claude-plugin"), { recursive: true });
  cpSync(join(repoRoot, ".agents"), join(source, ".agents"), { recursive: true });
  cpSync(pluginRoot, join(source, "plugins/pstack"), { recursive: true, filter: (p) => !p.includes("node_modules") });
  cpSync(join(repoRoot, "tools/frozen-hooks.json"), join(source, "tools/frozen-hooks.json"));
  run(s, "install", "--source", source);
  run(s, "uninstall");
});

test("a record without a receipt cannot be adopted implicitly", () => {
  const s = sandbox(); run(s); rmSync(receiptPath(s));
  const before = changes(s);
  failure(s, "install", "not managed");
  failure(s, "uninstall", "not managed");
  expect(changes(s)).toEqual(before);
  run(s, "install", "--source", repoRoot);
});

test("multiple records give the same concrete cleanup instructions in install and doctor", () => {
  const s = sandbox(); run(s);
  setState(s, { plugins: [...readState(s).plugins, ...readState(s).plugins] });
  const before = changes(s);
  for (const command of ["install", "doctor", "uninstall"]) {
    const row = failure(s, command, "multiple t3-pstack-science records");
    expect(row.checks[0].fix ?? row.checks[1]?.fix).toContain("muse plugins list --json");
    expect(JSON.stringify(row)).toContain("muse plugins remove t3-pstack-science");
  }
  expect(changes(s)).toEqual(before);
});

test("receipts pin identity, provenance, content, trust, and user scope", () => {
  const s = sandbox(); run(s);
  const owned = receipt(s).plugin;
  expect(owned).toMatchObject({ id: "t3-pstack-science", version: readState(s).plugins[0].version, scope: "user", trust: "user-local", source: { provenance: "foreign-import", path: pluginRoot } });
  expect(owned.contentDigest).toMatch(/^[a-f0-9]{64}$/);
  const plugins = readState(s).plugins;
  plugins[0].scope = "project"; setState(s, { plugins });
  const before = changes(s);
  failure(s, "install", "user scope"); failure(s, "uninstall", "user scope");
  expect(changes(s)).toEqual(before);
});

test("approved status and session_start events use schema-derived source and matcher", () => {
  const s = sandbox(); run(s);
  setState(s, { approvedStatus: "approved", event: "session_start", schemaEvent: "session_start", schemaSource: "resume" });
  expect(run(s, "doctor").checks.every((c) => c.ok)).toBe(true);
  expect(run(s).steps).toEqual([]);
});

for (const output of [
  { "plugins list": { plugins: [{}] } },
  { "plugins inspect": { record: {} } },
  { "plugins inspect": { record: null } },
  { "plugins inspect": { plugin: { capabilities: {} } } },
  { "plugins hook": { terminals: [], decision: { additional_contexts: [null] } } },
]) {
  test(`unsupported CLI output is named for ${JSON.stringify(output)}`, () => {
    const s = sandbox(); run(s); setState(s, { output });
    const r = failure(s, "doctor", "Muse CLI output is not supported by this installer; update t3-pstack-science");
    expect(JSON.stringify(r)).not.toContain("rerun");
  });
}

for (const runtime of [null, [{}], [{ candidate: {}, status: 42 }]]) {
  test(`malformed runtime capabilities ${JSON.stringify(runtime)} never throw TypeError`, () => {
    const s = sandbox(); run(s);
    setState(s, { runtime: runtime ?? "unknown" });
    failure(s, "doctor", "Muse CLI output is not supported by this installer; update t3-pstack-science");
  });
}

test("doctor skips hook execution for changed packages or missing hook approval", () => {
  const s = sandbox(); run(s);
  const before = calls(s).filter((a) => a[1] === "hook").length;
  setState(s, { approvals: [] });
  expect(failure(s, "doctor", "skipped").checks.at(-1)).toMatchObject({ name: "session context", ok: false });
  expect(calls(s).filter((a) => a[1] === "hook")).toHaveLength(before);
  writeFileSync(join(readState(s).plugins[0].cache_path, "hooks/session-start.sh"), "changed");
  failure(s, "doctor", "skipped");
  expect(calls(s).filter((a) => a[1] === "hook")).toHaveLength(before);
});

test("museHome trims and resolves XDG_CONFIG_HOME", () => {
  const home = museHome({ env: { XDG_CONFIG_HOME: "  relative-config  " }, home: "/tmp/unused" });
  expect(home.dir).toBe(join(repoRoot, "relative-config/muse"));
});

test("combined flags both appear when rejecting a foreign remote source", () => {
  const s = sandbox();
  const r = installer(s, ["install", "--cursor", "--muse", "--source", "other/repository"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("--cursor --muse");
});

test.skipIf(process.platform === "win32")("package digests hash symlink target paths", () => {
  const s = sandbox();
  const source = join(s.home, "source");
  for (const path of [".claude-plugin", ".agents", "plugins/pstack", "tools/frozen-hooks.json"]) cpSync(join(repoRoot, path), join(source, path), { recursive: true, filter: (p) => !p.includes("node_modules") });
  symlinkSync("session-start-context.md", join(source, "plugins/pstack/hooks/context-link"));
  expect(run(s, "install", "--source", source).checks.every((c) => c.ok)).toBe(true);
});

test("explicit adoption of a replacement record drops the prior record's git ownership", () => {
  const s = sandbox(); run(s);
  const plugins = readState(s).plugins;
  plugins[0].package_sha256 = "replacement";
  setState(s, { plugins });
  run(s, "install", "--source", repoRoot);
  expect(receipt(s).disabledBuiltinGit).toBe(false);
  run(s, "uninstall");
  expect(readState(s).git).toBe("off");
});

test("the T3 settings report counts a Muse instance", () => {
  const s = sandbox();
  writeJson(join(s.home, ".t3/userdata/settings.json"), { providerInstances: { muse: { driver: "muse", config: {} } } });
  const result = installer(s, ["install", "--muse"]);
  expect(result.status, result.stdout).toBe(0);
  expect(result.stdout).toContain("1 Claude Code, Codex, or Muse instances");
});
