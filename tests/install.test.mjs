// The installer's file-level behavior, on constructed homes: which homes it
// finds, how it repairs a stale Claude Code record, how it moves the model
// sheet, and what doctor reports. tests/install-e2e.test.mjs drives the real
// CLIs.
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { doctorClaude, installClaude, syncScopedRecords } from "../tools/install/claude.mjs";
import { AppServer, doctorCodex } from "../tools/install/codex.mjs";
import { parseSource, writeAtomic } from "../tools/install/common.mjs";
import { cursorHome, discoverHomes } from "../tools/install/homes.mjs";
import { doctorSheet } from "../tools/install/sheet.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const models = JSON.parse(readFileSync(join(repoRoot, "plugins/pstack/models.json"), "utf8"));
const legacy = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/identity/legacy-install.json"), "utf8"));
const FIX = "rerun `npx -y github:huankoh/t3-pstack-science install`";

const scratch = [];
function tmp() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "t3-pstack-science-install-")));
  scratch.push(dir);
  return dir;
}
afterEach(() => {
  while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true });
});
const writeJson = (path, value) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
};
const mode = (path) => statSync(path).mode & 0o777;

// The plugin's own skills, and a doctor context that trusts the GitHub repo.
const SKILL = (name) => readFileSync(join(repoRoot, "plugins/pstack/skills", name, "SKILL.md"), "utf8");
const skills = new Map(["how", "why"].map((name) => [name, SKILL(name)]));
const github = parseSource("huankoh/t3-pstack-science", "/home/u");
const context = { source: github, trusted: new Set([github.key]), version: "2.0.0-rc.3", skills };

// A `claude` that records each call and changes nothing.
function fakeClaude() {
  const dir = tmp();
  const bin = join(dir, "claude");
  writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${dir}/calls"\n`);
  chmodSync(bin, 0o755);
  return { bin, calls: () => (existsSync(join(dir, "calls")) ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n") : []) };
}

describe("discoverHomes", () => {
  test("resolves each home as T3 does and merges the sources that name it", () => {
    const t3 = tmp();
    writeJson(join(t3, "userdata/settings.json"), {
      providerInstances: {
        claudeAgent: { driver: "claudeAgent", enabled: true, config: { binaryPath: "claude", homePath: "" } },
        claude_pool: { driver: "claudeAgent", config: { homePath: "~/.claude_pool", binaryPath: "/opt/bin/claude" } },
        claude_env: { driver: "claudeAgent", environment: [{ name: "CLAUDE_CONFIG_DIR", value: "/opt/claude-env" }] },
        codex: { driver: "codex", config: { homePath: "", shadowHomePath: "~/.codex-acct2" } },
        codex_pool: { driver: "codex", enabled: false, config: { homePath: "/home/u/.codex-pool" } },
        codex_env: { driver: "codex", config: { enabled: false }, environment: [{ name: "CODEX_HOME", value: "/opt/codex-env" }] },
        grok: { driver: "grok", enabled: true },
      },
    });
    const found = discoverHomes({
      env: { T3CODE_HOME: t3, CODEX_HOME: "/home/u/.codex-acct2", CLAUDE_CONFIG_DIR: "/srv/claude" },
      home: "/home/u",
      claudeHomes: ["~/.claude_pool"],
      codexHomes: ["/data/codex"],
    });
    expect(found).toEqual({
      homes: [
        { harness: "claude", dir: "/home/u/.claude", from: ["default", "T3 instance claudeAgent"], bin: "claude" },
        { harness: "codex", dir: "/home/u/.codex", from: ["default", "T3 instance codex"], bin: "codex" },
        { harness: "claude", dir: "/home/u/.claude_pool", from: ["T3 instance claude_pool", "--claude-home"], bin: "/opt/bin/claude" },
        { harness: "claude", dir: "/opt/claude-env", from: ["T3 instance claude_env"], bin: "claude" },
        { harness: "codex", dir: "/home/u/.codex-pool", from: ["T3 instance codex_pool (disabled)"], bin: "codex" },
        { harness: "codex", dir: "/opt/codex-env", from: ["T3 instance codex_env (disabled)"], bin: "codex" },
        { harness: "claude", dir: "/srv/claude", from: ["CLAUDE_CONFIG_DIR"], bin: "claude" },
        { harness: "codex", dir: "/data/codex", from: ["--codex-home"], bin: "codex" },
      ],
      settings: { path: join(t3, "userdata/settings.json"), instances: 6, error: undefined },
    });
  });

  test("expands a leading ~ in an instance's home variable and binary as T3 does", () => {
    const t3 = tmp();
    writeJson(join(t3, "userdata/settings.json"), {
      providerInstances: {
        claude_env: { driver: "claudeAgent", environment: [{ name: "CLAUDE_CONFIG_DIR", value: "~/.claude-env" }], config: { binaryPath: "~/bin/claude" } },
        codex_env: { driver: "codex", environment: [{ name: "CODEX_HOME", value: "~\\.codex-env" }] },
      },
    });
    const { homes } = discoverHomes({ env: { T3CODE_HOME: t3 }, home: "/home/u" });
    expect(homes.slice(2)).toEqual([
      { harness: "claude", dir: "/home/u/.claude-env", from: ["T3 instance claude_env"], bin: "/home/u/bin/claude" },
      { harness: "codex", dir: "/home/u/.codex-env", from: ["T3 instance codex_env"], bin: "codex" },
    ]);
  });

  test("reports T3 settings that do not parse without quoting them", () => {
    const t3 = tmp();
    mkdirSync(join(t3, "userdata"), { recursive: true });
    writeFileSync(join(t3, "userdata/settings.json"), '{"providerInstances": {"codex": {"environment": [{"name": "OPENAI_API_KEY", "value": "sk-live-123');
    expect(discoverHomes({ env: { T3CODE_HOME: t3 }, home: "/home/u" }).settings).toEqual({
      path: join(t3, "userdata/settings.json"),
      instances: 0,
      error: "invalid JSON",
    });
  });

  test("falls back to the defaults when T3's settings are missing", () => {
    const t3 = tmp();
    expect(discoverHomes({ env: { T3CODE_HOME: t3 }, home: "/home/u" })).toEqual({
      homes: [
        { harness: "claude", dir: "/home/u/.claude", from: ["default"], bin: "claude" },
        { harness: "codex", dir: "/home/u/.codex", from: ["default"], bin: "codex" },
      ],
      settings: { path: join(t3, "userdata/settings.json"), instances: 0, error: "not found" },
    });
  });
});

describe("cursorHome", () => {
  test("is the OS home's .cursor for the default and every T3 cursor instance, whatever the instance names", () => {
    const t3 = tmp();
    writeJson(join(t3, "userdata/settings.json"), {
      providerInstances: {
        claudeAgent: { driver: "claudeAgent", config: { homePath: "" } },
        cursor_main: { driver: "cursor", config: { homePath: "/tmp/not-the-os-home", binaryPath: "/opt/cursor" } },
        cursor_env: { driver: "cursor", enabled: false, environment: [{ name: "CURSOR_HOME", value: "/opt/cursor-env" }] },
        cursor_off: { driver: "cursor", config: { enabled: false } },
      },
    });
    expect(cursorHome({ env: { T3CODE_HOME: t3 }, home: "/home/u" })).toEqual({
      harness: "cursor",
      dir: "/home/u/.cursor",
      from: ["default", "T3 instance cursor_main", "T3 instance cursor_env (disabled)", "T3 instance cursor_off (disabled)"],
      bin: null,
    });
  });

  test("is the default alone when T3's settings are missing or do not parse", () => {
    const t3 = tmp();
    const expected = { harness: "cursor", dir: "/home/u/.cursor", from: ["default"], bin: null };
    expect(cursorHome({ env: { T3CODE_HOME: t3 }, home: "/home/u" })).toEqual(expected);
    mkdirSync(join(t3, "userdata"), { recursive: true });
    writeFileSync(join(t3, "userdata/settings.json"), '{"providerInstances": {"cursor_main": {"driver": "cursor"');
    expect(cursorHome({ env: { T3CODE_HOME: t3 }, home: "/home/u" })).toEqual(expected);
  });
});

// The record a second config home keeps re-acquiring for the home folder.
function claudeHome({ autoUpdate } = {}) {
  const dir = tmp();
  const user = {
    scope: "user",
    installPath: `${dir}/plugins/cache/t3-pstack-science/t3-pstack-science/2.0.0-rc.3`,
    version: "2.0.0-rc.3",
    installedAt: "2026-10-06T08:38:28.344Z",
    lastUpdated: "2026-10-14T11:20:44.228Z",
    gitCommitSha: "1111111111111111111111111111111111111111",
  };
  const project = {
    scope: "project",
    projectPath: "/home/u",
    installPath: `${dir}/plugins/cache/t3-pstack-science/t3-pstack-science/1.0.11`,
    version: "1.0.11",
    installedAt: "2026-10-13T04:43:26.759Z",
    lastUpdated: "2026-10-13T04:43:26.759Z",
    gitCommitSha: "0000000000000000000000000000000000000000",
  };
  const other = { scope: "project", projectPath: "/home/u", installPath: "/x", version: "0.1.0" };
  writeJson(join(user.installPath, ".claude-plugin/plugin.json"), { name: "t3-pstack-science", version: user.version });
  for (const [name, text] of skills) {
    mkdirSync(join(user.installPath, "skills", name), { recursive: true });
    writeFileSync(join(user.installPath, "skills", name, "SKILL.md"), text);
  }
  writeJson(join(dir, "plugins/installed_plugins.json"), {
    version: 2,
    plugins: { "t3-pstack-science@t3-pstack-science": [user, project], "other@market": [other] },
  });
  writeJson(join(dir, "settings.json"), {
    enabledPlugins: { "t3-pstack-science@t3-pstack-science": true },
    extraKnownMarketplaces: {
      "t3-pstack-science": { source: { source: "github", repo: "huankoh/t3-pstack-science" }, ...(autoUpdate && { autoUpdate }) },
    },
  });
  return { dir, user, project, other };
}

describe("a stale other-scope Claude Code record", () => {
  test("moves to the user-scope install, after a backup, and only once", () => {
    const { dir, user, project, other } = claudeHome();
    const path = join(dir, "plugins/installed_plugins.json");
    const original = readFileSync(path, "utf8");

    const steps = syncScopedRecords(dir);
    const backups = readdirSync(join(dir, "plugins")).filter((name) => name.endsWith(".bak"));
    expect(backups).toHaveLength(1);
    expect(steps).toEqual([
      "moved the project-scope record for /home/u from 1.0.11 to 2.0.0-rc.3",
      `backed up plugins/installed_plugins.json to ${join(dir, "plugins", backups[0])}`,
    ]);
    expect(readFileSync(join(dir, "plugins", backups[0]), "utf8")).toBe(original);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      version: 2,
      plugins: {
        "t3-pstack-science@t3-pstack-science": [
          user,
          { ...project, installPath: user.installPath, version: user.version, gitCommitSha: user.gitCommitSha, lastUpdated: user.lastUpdated },
        ],
        "other@market": [other],
      },
    });

    const fixed = readFileSync(path, "utf8");
    expect(syncScopedRecords(dir)).toEqual([]);
    expect(readFileSync(path, "utf8")).toBe(fixed);
    expect(readdirSync(join(dir, "plugins")).filter((name) => name.endsWith(".bak"))).toHaveLength(1);
  });

  test("keeps the records file's mode, and its backup's", () => {
    const { dir } = claudeHome();
    const path = join(dir, "plugins/installed_plugins.json");
    chmodSync(path, 0o600);
    syncScopedRecords(dir);
    const backup = readdirSync(join(dir, "plugins")).find((name) => name.endsWith(".bak"));
    expect([mode(path), mode(join(dir, "plugins", backup))]).toEqual([0o600, 0o600]);
  });

  test("doctor names it, the missing auto-update, and plain skill copies, and passes once they are fixed", () => {
    const { dir } = claudeHome();
    mkdirSync(join(dir, "skills/how"), { recursive: true });
    writeFileSync(join(dir, "skills/how/SKILL.md"), SKILL("how"));
    const home = { harness: "claude", dir, from: ["default"], bin: "claude" };
    expect(doctorClaude(home, context)).toEqual([
      { name: "marketplace", ok: true, detail: "huankoh/t3-pstack-science" },
      { name: "installed", ok: true, detail: "2.0.0-rc.3" },
      { name: "enabled", ok: true, detail: "yes" },
      { name: "marketplace auto-update", ok: false, detail: "false", fix: FIX },
      { name: "other-scope records", ok: false, detail: "project /home/u at 1.0.11", fix: FIX },
      {
        name: "no plain copies of plugin skills",
        ok: false,
        detail: join(dir, "skills/how"),
        fix: "delete these folders; the plugin ships the same skills",
      },
    ]);
    expect(doctorClaude(home, { ...context, version: "2.0.0-rc.4" })[1]).toEqual({
      name: "installed",
      ok: false,
      detail: "2.0.0-rc.3, expected 2.0.0-rc.4",
      fix: FIX,
    });

    syncScopedRecords(dir);
    rmSync(join(dir, "skills"), { recursive: true });
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    settings.extraKnownMarketplaces["t3-pstack-science"].autoUpdate = true;
    writeJson(join(dir, "settings.json"), settings);
    expect(doctorClaude(home, context).filter((c) => !c.ok)).toEqual([]);
  });

  test("doctor leaves a user's own skill that shares a plugin skill's name", () => {
    const { dir } = claudeHome({ autoUpdate: true });
    syncScopedRecords(dir);
    mkdirSync(join(dir, "skills/how"), { recursive: true });
    writeFileSync(join(dir, "skills/how/SKILL.md"), "---\nname: how\ndescription: My own notes on how things work.\n---\n");
    const home = { harness: "claude", dir, from: ["default"], bin: "claude" };
    expect(doctorClaude(home, context).filter((c) => !c.ok)).toEqual([]);
  });

  test("doctor fails an install whose files are gone, and install reinstalls it", () => {
    const { dir, user } = claudeHome({ autoUpdate: true });
    syncScopedRecords(dir);
    rmSync(user.installPath, { recursive: true });
    const claude = fakeClaude();
    const home = { harness: "claude", dir, from: ["default"], bin: claude.bin };
    expect(doctorClaude(home, context).filter((c) => !c.ok)).toEqual([
      { name: "installed", ok: false, detail: `2.0.0-rc.3, but its files at ${user.installPath} are missing`, fix: FIX },
    ]);
    expect(installClaude(home, context)).toEqual(["reinstalled 2.0.0-rc.3, whose files were missing"]);
    expect(claude.calls()).toEqual(["plugin install t3-pstack-science@t3-pstack-science --scope user"]);
  });

  test("install says so when the marketplace has no newer version to update to", () => {
    const { dir } = claudeHome({ autoUpdate: true });
    syncScopedRecords(dir);
    const claude = fakeClaude();
    const home = { harness: "claude", dir, from: ["default"], bin: claude.bin };
    expect(installClaude(home, { ...context, version: "2.0.0-rc.4" })).toEqual(["the marketplace has no 2.0.0-rc.4, so it stays at 2.0.0-rc.3"]);
    expect(claude.calls()).toEqual(["plugin marketplace update t3-pstack-science", "plugin update t3-pstack-science@t3-pstack-science --scope user"]);
  });

  test("doctor reports settings.json that does not parse by path alone", () => {
    const { dir } = claudeHome();
    writeFileSync(join(dir, "settings.json"), '{"env": {"ANTHROPIC_API_KEY": "sk-ant-live-123"');
    const home = { harness: "claude", dir, from: ["default"], bin: "claude" };
    expect(() => doctorClaude(home, context)).toThrow(new Error(`${join(dir, "settings.json")}: invalid JSON`));
  });

  test("turning on auto-update keeps settings.json's mode", () => {
    const { dir } = claudeHome();
    chmodSync(join(dir, "settings.json"), 0o600);
    const claude = fakeClaude();
    const steps = installClaude({ harness: "claude", dir, from: ["default"], bin: claude.bin }, context);
    expect(steps[0]).toBe("turned on marketplace auto-update");
    expect(mode(join(dir, "settings.json"))).toBe(0o600);
  });
});

describe("side-by-side Claude plugins", () => {
  test.each([true, false])("warns only when the foreign plugin is enabled too (%s)", (foreignEnabled) => {
    const { dir } = claudeHome({ autoUpdate: true });
    const path = join(dir, "settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8"));
    settings.enabledPlugins["t3-pstack-science@t3-pstack-science"] = true;
    settings.enabledPlugins[legacy.pluginId] = foreignEnabled;
    writeJson(path, settings);
    const before = readFileSync(path, "utf8");
    const home = { harness: "claude", dir, bin: "claude" };
    const warnings = doctorClaude(home, context).filter((c) => c.warn);
    expect(warnings).toEqual(foreignEnabled ? [{
      name: "session hooks", ok: false, warn: true,
      detail: "t3-pstack is also enabled, and its session hook runs too",
      fix: `disable ${legacy.pluginId} in this home`,
    }] : []);
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

describe("side-by-side Codex plugins", () => {
  test.each(["trusted", "untrusted", "modified"])("warns only when the foreign hook is trusted (%s)", async (trustStatus) => {
    const calls = [];
    const start = spyOn(AppServer, "start").mockResolvedValue({
      request: async (method) => {
        calls.push(method);
        return ({
          "config/read": { config: {} },
          "plugin/list": { marketplaces: [{ plugins: [
            { id: "t3-pstack-science@t3-pstack-science", enabled: true },
            { id: legacy.pluginId, enabled: true },
          ] }] },
          "hooks/list": { data: [{ hooks: [
            { pluginId: legacy.pluginId, trustStatus },
            { pluginId: "another@market", trustStatus: "trusted" },
          ] }] },
          "skills/list": { data: [{ skills: [] }] },
        })[method];
      },
      close() {},
    });
    try {
      const checks = await doctorCodex({ dir: tmp(), bin: "codex" }, context);
      expect(calls.filter((method) => method === "hooks/list")).toHaveLength(1);
      expect(checks.filter((c) => c.warn)).toEqual(trustStatus === "trusted" ? [{
        name: "session hooks", ok: false, warn: true,
        detail: "t3-pstack is also enabled, and its session hook runs too",
        fix: `disable ${legacy.pluginId} in this home`,
      }] : []);
    } finally {
      start.mockRestore();
    }
  });
});

describe("a t3-pstack-science marketplace from another source", () => {
  function counterfeit() {
    const { dir } = claudeHome({ autoUpdate: true });
    const elsewhere = tmp();
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    settings.extraKnownMarketplaces["t3-pstack-science"].source = { source: "directory", path: elsewhere };
    writeJson(join(dir, "settings.json"), settings);
    rmSync(join(dir, "plugins/installed_plugins.json"));
    return { dir, elsewhere };
  }

  test("installs nothing, and doctor fails it with the source", () => {
    const { dir, elsewhere } = counterfeit();
    const claude = fakeClaude();
    const home = { harness: "claude", dir, from: ["default"], bin: claude.bin };
    expect(installClaude(home, context)).toEqual([]);
    expect(claude.calls()).toEqual([]);
    expect(doctorClaude(home, context)[0]).toEqual({
      name: "marketplace",
      ok: false,
      detail: `${elsewhere}, which is neither huankoh/t3-pstack-science nor --source`,
      fix: `if you trust it, rerun with --source ${elsewhere}; otherwise remove it with \`CLAUDE_CONFIG_DIR=${dir} claude plugin marketplace remove t3-pstack-science\`, then ${FIX}`,
    });
  });

  test("rejects the foreign plugin's GitHub source under this fork's marketplace name", () => {
    const { dir } = claudeHome({ autoUpdate: true });
    const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
    const foreignRepo = legacy.install.slice("github:".length);
    settings.extraKnownMarketplaces["t3-pstack-science"].source = { source: "github", repo: foreignRepo };
    writeJson(join(dir, "settings.json"), settings);
    const claude = fakeClaude();
    const home = { harness: "claude", dir, bin: claude.bin };
    expect(installClaude(home, context)).toEqual([]);
    expect(claude.calls()).toEqual([]);
    expect(doctorClaude(home, context)[0]).toEqual({
      name: "marketplace", ok: false,
      detail: `${foreignRepo}, which is neither huankoh/t3-pstack-science nor --source`,
      fix: `if you trust it, rerun with --source ${foreignRepo}; otherwise remove it with \`CLAUDE_CONFIG_DIR=${dir} claude plugin marketplace remove t3-pstack-science\`, then ${FIX}`,
    });
  });

  test("is trusted when it is this run's --source", () => {
    const { dir, elsewhere } = counterfeit();
    const local = parseSource(elsewhere, "/home/u");
    const home = { harness: "claude", dir, from: ["default"], bin: "claude" };
    expect(doctorClaude(home, { ...context, source: local, trusted: new Set([github.key, local.key]) })[0]).toEqual({
      name: "marketplace",
      ok: true,
      detail: elsewhere,
    });
  });
});

describe("--source", () => {
  test("a home with no marketplace registers the science fork passed as --source", () => {
    const claude = fakeClaude();
    const r = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), "install", "--source", "huankoh/t3-pstack-science", "--json"], {
      cwd: repoRoot,
      env: { HOME: tmp(), TMPDIR: process.env.TMPDIR, PATH: `${process.env.HOME}/.bun/bin:${dirname(claude.bin)}` },
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    const report = JSON.parse(r.stdout);
    expect(report.source).toBe("huankoh/t3-pstack-science");
    expect(report.homes[0].steps).toEqual(["added the t3-pstack-science marketplace from huankoh/t3-pstack-science"]);
    expect(claude.calls()).toEqual(["plugin marketplace add huankoh/t3-pstack-science"]);
  });

  test.each([
    [".claude-plugin/marketplace.json", legacy.name],
    [".agents/plugins/marketplace.json", legacy.name],
    [".claude-plugin/marketplace.json", null],
    ["plugins/pstack/models.json", "domains"],
    [".claude-plugin/marketplace.json", "plugin entry"],
    [".agents/plugins/marketplace.json", "plugin entry"],
    ["plugins/pstack/.claude-plugin/plugin.json", legacy.name],
    ["plugins/pstack/.codex-plugin/plugin.json", legacy.name],
  ])("rejects an incompatible %s before calling a CLI or changing homes", (file, found) => {
    const source = tmp();
    for (const path of [".claude-plugin/marketplace.json", ".agents/plugins/marketplace.json"]) {
      writeJson(join(source, path), { name: "t3-pstack-science", plugins: [{ name: "t3-pstack-science" }] });
    }
    for (const path of ["plugins/pstack/.claude-plugin/plugin.json", "plugins/pstack/.codex-plugin/plugin.json"]) {
      writeJson(join(source, path), { name: "t3-pstack-science" });
    }
    writeJson(join(source, "plugins/pstack/models.json"), models);
    const staleEntry = found === "plugin entry";
    writeJson(join(source, file), file.endsWith("models.json") ? { tiers: {}, roles: [] }
      : staleEntry ? { name: "t3-pstack-science", plugins: [{ name: legacy.name }] } : { name: found });
    const home = tmp();
    const claude = fakeClaude();
    const r = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), "install", "--source", source], {
      cwd: repoRoot,
      env: { HOME: home, TMPDIR: process.env.TMPDIR, PATH: dirname(claude.bin) },
      encoding: "utf8",
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(join(source, file));
    expect(r.stderr).toContain(JSON.stringify(staleEntry ? legacy.name : found));
    expect(claude.calls()).toEqual([]);
    expect(readdirSync(home)).toEqual([]);
  });

  test("reads owner/repo as GitHub even where that relative directory exists, and a URL to the same repository as the same source", () => {
    const cwd = tmp();
    mkdirSync(join(cwd, "huankoh/t3-pstack-science"), { recursive: true });
    const r = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), "doctor", "--source", "huankoh/t3-pstack-science", "--json"], {
      cwd,
      env: { HOME: tmp(), PATH: tmp() },
      encoding: "utf8",
    });
    expect({ status: r.status, stderr: r.stderr, source: r.status === 0 && JSON.parse(r.stdout).source }).toEqual({
      status: 0,
      stderr: "",
      source: "huankoh/t3-pstack-science",
    });
    expect(parseSource("git@github.com:HuanKoh/t3-pstack-science.git", "/home/u").key).toBe(github.key);
    expect(parseSource("https://github.com/huankoh/t3-pstack-science", "/home/u").key).toBe(github.key);
    expect(() => parseSource("./missing", cwd)).toThrow("--source ./missing: not owner/repo, a Git URL, or an existing directory");
  });
});

describe("files the installer replaces", () => {
  test("keep their mode", () => {
    const path = join(tmp(), "settings.json");
    writeFileSync(path, "{}\n", { mode: 0o600 });
    writeAtomic(path, '{"a": 1}\n');
    expect([readFileSync(path, "utf8"), mode(path)]).toEqual(['{"a": 1}\n', 0o600]);
  });
});

describe("codex app-server output that is not JSON-RPC", () => {
  test("fails the request instead of crashing the run", async () => {
    const dir = tmp();
    const bin = join(dir, "codex");
    writeFileSync(bin, "#!/bin/sh\necho 'token sk-live-123 expired'\nexec cat >/dev/null\n");
    chmodSync(bin, 0o755);
    await expect(AppServer.start({ dir, bin })).rejects.toThrow(new Error("codex app-server printed a line that is not JSON-RPC"));
  });
});

describe("the model sheet", () => {
  const SHEET = "# budget: large (xhigh)\nbug-fix: inherit-parent\nsession hook: on\n";

  function machine() {
    const root = tmp();
    const homes = [".claude", ".codex", ".codex-pool", ".claude-never-run"].map((name) => ({ dir: join(root, name) }));
    for (const { dir } of homes.slice(0, 3)) mkdirSync(dir);
    return { root, homes, sheet: join(root, ".config/t3-pstack-science/models.md") };
  }

  test("install leaves foreign sheets and their symlinks untouched", () => {
    const { root, homes, sheet } = machine();
    const legacy = join(root, ".claude/t3-pstack-models.md");
    const linked = join(root, ".codex/t3-pstack-models.md");
    writeFileSync(legacy, SHEET, { mode: 0o600 });
    symlinkSync(legacy, linked);
    const oldMachine = join(root, ".config/t3-pstack/models.md");
    mkdirSync(dirname(oldMachine), { recursive: true });
    writeFileSync(oldMachine, "session hook: off\n");
    const claude = fakeClaude();
    const result = spawnSync(process.execPath, [join(repoRoot, "tools/install.mjs"), "install", "--json"], {
      cwd: repoRoot,
      env: { HOME: root, TMPDIR: process.env.TMPDIR, PATH: dirname(claude.bin) },
      encoding: "utf8",
    });
    const report = JSON.parse(result.stdout);
    expect(report.sheet.path).toBe(join(root, ".config/t3-pstack-science/models.md"));
    expect(report.sheet.steps).toEqual([]);
    expect(readFileSync(legacy, "utf8")).toBe(SHEET);
    expect(mode(legacy)).toBe(0o600);
    expect(readlinkSync(linked)).toBe(legacy);
    expect(readFileSync(oldMachine, "utf8")).toBe("session hook: off\n");
    expect(existsSync(join(root, ".config/t3-pstack-science/models.md"))).toBe(false);
    expect(readdirSync(homes[2].dir)).toEqual([]);
  });

  test("doctor ignores conflicting foreign home sheets", () => {
    const { root, homes, sheet } = machine();
    writeFileSync(join(root, ".claude/t3-pstack-models.md"), SHEET);
    writeFileSync(join(root, ".codex/t3-pstack-models.md"), "session hook: off\n");
    expect(doctorSheet(sheet, { catalog: null, models })).toEqual([
      {
        name: "machine sheet", ok: false, warn: true,
        detail: "none, so every role runs on its skill's defaults",
        fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
      },
      {
        name: "muse mode", ok: false, warn: true,
        detail: "not checked (pass --catalog to check targets); standard mode is unaffected",
        fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
      },
    ]);
  });

  test("doctor warns without a sheet and fails on a malformed one", () => {
    const { homes, sheet } = machine();
    expect(doctorSheet(sheet, { catalog: null, models })).toEqual([
      {
        name: "machine sheet",
        ok: false,
        detail: "none, so every role runs on its skill's defaults",
        fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
        warn: true,
      },
      {
        name: "muse mode", ok: false, warn: true,
        detail: "not checked (pass --catalog to check targets); standard mode is unaffected",
        fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
      },
    ]);
    mkdirSync(join(sheet, ".."), { recursive: true });
    writeFileSync(sheet, "bug-fix: claude-opus\nhow critics: inherit-parent\n");
    expect(doctorSheet(sheet, { catalog: null, models })[0]).toEqual({
      name: "machine sheet valid",
      ok: false,
      detail: 'bug-fix: "claude-opus" does not start with <providerInstanceId>/<modelId>; "how critics" is not a pstack role',
      fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
    });
  });

  test("doctor names a science line that does not parse", () => {
    const { homes, sheet } = machine();
    mkdirSync(join(sheet, ".."), { recursive: true });
    writeFileSync(sheet, "science bug-fix: opus\n");
    expect(doctorSheet(sheet, { catalog: null, models })[0]).toEqual({
      name: "machine sheet valid", ok: false,
      detail: 'science bug-fix: "opus" does not start with <providerInstanceId>/<modelId>',
      fix: "run /t3-pstack-science:setup-pstack in a T3 thread",
    });
  });

  test("doctor reports muse mode ready when the catalog runs every muse target", () => {
    const { sheet } = machine();
    const catalog = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/t3-catalog.json"), "utf8"));
    const museCatalog = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/t3-muse-catalog.json"), "utf8"));
    const run = { providers: [...museCatalog.providers, ...catalog.providers.filter((p) => !["muse", "opencode"].includes(p.providerInstanceId))] };
    mkdirSync(join(sheet, ".."), { recursive: true });
    writeFileSync(sheet, SHEET);
    const rows = doctorSheet(sheet, { catalog: run, models });
    expect(rows.at(-1)).toEqual({ name: "muse mode", ok: true, detail: "every muse target dispatches on the catalog" });
    expect(rows.filter((r) => !r.ok && !r.warn)).toEqual([]);
  });

  test("doctor keeps a bad standard line out of the muse row", () => {
    const { sheet } = machine();
    const catalog = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/t3-catalog.json"), "utf8"));
    const museCatalog = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/t3-muse-catalog.json"), "utf8"));
    const run = { providers: [...museCatalog.providers, ...catalog.providers.filter((p) => !["muse", "opencode"].includes(p.providerInstanceId))] };
    mkdirSync(join(sheet, ".."), { recursive: true });
    writeFileSync(sheet, "bug-fix: opus\n");
    const rows = doctorSheet(sheet, { catalog: run, models });
    expect(rows[0].name).toBe("machine sheet valid");
    expect(rows[0].ok).toBe(false);
    expect(rows[0].detail).toContain("bug-fix");
    expect(rows.at(-1)).toEqual({ name: "muse mode", ok: true, detail: "every muse target dispatches on the catalog" });
  });

  test("doctor warns on muse mode without failing, on an old sheet and a catalog without muse", () => {
    const { sheet } = machine();
    const catalog = JSON.parse(readFileSync(join(repoRoot, "tests/fixtures/t3-catalog.json"), "utf8"));
    const noMuse = { providers: catalog.providers.filter((p) => p.providerInstanceId !== "muse") };
    mkdirSync(join(sheet, ".."), { recursive: true });
    writeFileSync(sheet, SHEET);
    const rows = doctorSheet(sheet, { catalog: noMuse, models });
    const muse = rows.at(-1);
    expect(muse.name).toBe("muse mode");
    expect(muse.ok).toBe(false);
    expect(muse.warn).toBe(true);
    expect(muse.detail).toContain('no provider instance "muse" in this T3');
    expect(muse.detail).toContain("standard mode is unaffected");
    expect(rows.filter((r) => !r.ok && !r.warn).map((r) => r.name)).toEqual(["machine sheet valid"]);
  });
});
