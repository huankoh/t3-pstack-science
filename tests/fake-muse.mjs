import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.env.HOME;
for (const key of ["XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
  if (!process.env[key]?.startsWith(home)) throw new Error(`${key} is not isolated`);
}
const args = process.argv.slice(2);
appendFileSync(join(home, "calls.jsonl"), `${JSON.stringify(args)}\n`);
const path = join(process.env.XDG_CONFIG_HOME, "muse/fake-state.json");
const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { git: "on", plugins: [] };
const save = () => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(state));
};
const out = (value) => console.log(JSON.stringify(value));
const id = "t3-pstack-science";
const hook = "hook-f4f474dee530aff8";
const names = ["comment-sicko", "poteto-agent", "thermo-nuclear-code-quality-review-subagent", "thermo-nuclear-review-subagent"];
const runtime = () => [
  { candidate: { plugin_id: id, kind: "hook", capability_id: hook, stable_id: `plugin:${id}:hook:${hook}` }, status: state.approvals?.includes(hook) ? "trusted_enabled" : "review_needed" },
  ...names.map((name) => ({ candidate: { plugin_id: id, scoped_definition_id: `${id}/${name}` }, status: state.approvals?.includes(name) ? "trusted_enabled" : "review_needed" })),
  { candidate: { plugin_id: "other-plugin", kind: "hook", capability_id: "foreign", stable_id: "plugin:other-plugin:hook:foreign" }, status: "review_needed" },
];
if (state.fail && args.join(" ").startsWith(state.fail)) {
  console.error("simulated Muse failure");
  process.exit(1);
}
if (args[0] === "--version") console.log("Muse Code 1.4.11 (fake)");
else if (args[0] === "schema") {
  const dir = args[args.indexOf("--out") + 1];
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "msp.schema.json"), JSON.stringify({ $defs: { HookEventName: { enum: ["sessionStart"] } } }));
} else if (args[0] === "skills") {
  if (args[1] === "inspect") out({ skill: { activation: state.git } });
  else { state.git = args[1] === "disable" ? "off" : "on"; save(); }
} else if (args[0] === "plugins") {
  if (args[1] === "list") out({ plugins: state.plugins.map((record) => ({ record })) });
  else if (args[1] === "install") {
    const source = args[2];
    const manifest = JSON.parse(readFileSync(join(source, ".claude-plugin/plugin.json"), "utf8"));
    const cache = join(process.env.XDG_DATA_HOME, "muse/plugins/cache", id);
    rmSync(cache, { recursive: true, force: true });
    cpSync(source, cache, { recursive: true, filter: (src) => !src.includes("node_modules") });
    const record = { id, version: manifest.version, enabled: true, cache_path: cache };
    state.plugins = [...state.plugins.filter((p) => p.id !== id), record];
    state.approvals = [];
    save(); out({ installed: record });
  } else if (args[1] === "inspect") {
    const record = state.plugins.find((p) => p.id === args[2]);
    out({ record, valid: true, active: record.enabled, plugin: { id, capabilities: { hooks: [{ id: hook, event: "SessionStart" }] } }, runtime_capabilities: runtime() });
  } else if (args[1] === "approve") {
    if (!args[2].startsWith(`plugin:${id}:hook:`) && !args[2].startsWith(`${id}:agent_definition:${id}/`)) throw new Error("foreign approval");
    state.approvals ??= [];
    state.approvals.push(args[2].split(/[/:]/).at(-1));
    save(); out({ decision: "approve" });
  } else if (args[1] === "enable") {
    state.plugins.find((p) => p.id === args[2]).enabled = true; save(); out({});
  } else if (args[1] === "remove") {
    const record = state.plugins.find((p) => p.id === args[2]);
    rmSync(record.cache_path, { recursive: true, force: true });
    state.plugins = state.plugins.filter((p) => p.id !== args[2]); save(); out({});
  } else if (args[1] === "hook") {
    const f = JSON.parse(readFileSync(args[args.indexOf("--fixture") + 1], "utf8"));
    if (f.event !== "SessionStart" || f.matcher_input !== "startup" || f.stdin.source !== "startup") throw new Error("bad session fixture");
    const record = state.plugins.find((p) => p.id === id);
    const sheet = join(process.env.XDG_CONFIG_HOME, "t3-pstack-science/models.md");
    const off = existsSync(sheet) && readFileSync(sheet, "utf8").includes("session hook: off");
    const context = state.badContext ? "unrelated context" : readFileSync(join(record.cache_path, "hooks/session-start-context.md"), "utf8").trimEnd();
    out({ decision: { additional_contexts: off ? [] : [context] }, terminals: [{ status: "completed", exit_code: 0 }], records: 2 });
  } else throw new Error(`unexpected ${args}`);
} else throw new Error(`unexpected ${args}`);
