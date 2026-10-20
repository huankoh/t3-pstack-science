import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = fileURLToPath(new URL("..", import.meta.url));
export const pluginRoot = join(repoRoot, "plugins/pstack");
export const version = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8")).version;
export const hookId = "plugin:t3-pstack-science:hook:hook-f4f474dee530aff8";
export const agents = ["comment-sicko", "poteto-agent", "thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-review-subagent"];
export const writeJson = (path, value) => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

export function isolatedHome(muse) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "t3-pstack-muse-")));
  const bin = join(home, "bin");
  mkdirSync(bin);
  const windows = process.platform === "win32";
  const node = Bun.which("node");
  if (windows) {
    writeFileSync(join(bin, "node.cmd"), `@"${node}" %*\r\n`);
    if (muse) writeFileSync(join(bin, "muse.cmd"), `@"${muse}" %*\r\n`);
  } else {
    symlinkSync(node, join(bin, "node"));
    const git = Bun.which("git");
    if (git) symlinkSync(git, join(bin, "git"));
    if (muse) symlinkSync(muse, join(bin, "muse"));
  }
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local/share"),
    XDG_STATE_HOME: join(home, ".local/state"),
    XDG_CACHE_HOME: join(home, ".cache"),
    CLAUDE_CONFIG_DIR: join(home, ".claude"),
    CODEX_HOME: join(home, ".codex"),
    T3CODE_HOME: join(home, ".t3"),
    GIT_CONFIG_GLOBAL: "/dev/null",
    MUSE_NO_AUTO_UPDATE: "1",
    PATH: [bin, ...(windows ? [process.env.SystemRoot, join(process.env.SystemRoot, "System32")] : ["/usr/bin", "/bin"])].join(delimiter),
  };
  for (const key of Object.keys(env)) {
    if (key !== "PATH" && key.toUpperCase() === "PATH") delete env[key];
  }
  delete env.MUSE_AUTH_PATH;
  return { home, bin, env, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

export function installer(sandbox, args) {
  return spawnSync(Bun.which("node"), [join(repoRoot, "tools/install.mjs"), ...args], {
    cwd: repoRoot, env: sandbox.env, encoding: "utf8", timeout: 120_000,
  });
}

export function muse(sandbox, args) {
  const file = process.platform === "win32" ? join(sandbox.bin, "muse.cmd") : join(sandbox.bin, "muse");
  return spawnSync(file, args, { cwd: repoRoot, env: sandbox.env, encoding: "utf8", shell: process.platform === "win32" });
}

export const readState = (sandbox) => JSON.parse(readFileSync(join(sandbox.home, ".config/muse/fake-state.json"), "utf8"));
export const setState = (sandbox, patch) => writeJson(join(sandbox.home, ".config/muse/fake-state.json"), { ...readState(sandbox), ...patch });
export const calls = (sandbox) => {
  const path = join(sandbox.home, "calls.jsonl");
  return existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(JSON.parse) : [];
};
