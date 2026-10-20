import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PLUGIN_ID } from "./common.mjs";

export const NAME = PLUGIN_ID.split("@")[0];
export const APPROVED = new Set(["trusted_enabled", "approved"]);
export const UPDATE_HINT = "update t3-pstack-science";
export function unsupported(field) {
  return Object.assign(new Error(`Muse CLI output is not supported by this installer; update t3-pstack-science (${field})`), { fix: UPDATE_HINT });
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (value) => typeof value === "string" && value.length > 0;
export const normalizeEvent = (event) => event.replace(/_/g, "").toLowerCase();

export function parseRecord(record) {
  if (!object(record) || !string(record.id)) throw unsupported("record.id");
  if (record.id !== NAME) return record;
  if (!string(record.version) || typeof record.enabled !== "boolean" || !string(record.cache_path)
    || !string(record.package_sha256) || !string(record.trust)
    || !object(record.source) || !string(record.source.provenance) || !string(record.source.path)
    || (record.scope !== undefined && !string(record.scope))) throw unsupported("plugin record");
  return record;
}

export function parseRecords(value) {
  if (!object(value) || !Array.isArray(value.plugins)) throw unsupported("plugins list");
  return value.plugins.map((entry) => parseRecord(entry?.record)).filter((record) => record.id === NAME);
}

export function parseInfo(info) {
  const record = parseRecord(info?.record);
  if (record.id !== NAME || info?.plugin?.id !== NAME || typeof info.valid !== "boolean" || typeof info.active !== "boolean") throw unsupported("plugins inspect");
  const hooks = info.plugin.capabilities?.hooks;
  if (!Array.isArray(hooks) || hooks.some((hook) => !object(hook) || !string(hook.id) || !string(hook.event)
    || (hook.matcher != null && typeof hook.matcher !== "string"))) throw unsupported("hook capabilities");
  const runtime = info.runtime_capabilities;
  if (!Array.isArray(runtime) || runtime.some((entry) => !object(entry) || !object(entry.candidate)
    || !string(entry.candidate.plugin_id) || !string(entry.status))) throw unsupported("runtime capability status");
  for (const { candidate } of runtime) {
    if (candidate.plugin_id !== NAME) continue;
    if (candidate.kind === "hook") {
      if (!string(candidate.capability_id) || !string(candidate.stable_id)) throw unsupported("runtime hook identity");
    } else if (!string(candidate.scoped_definition_id) || !candidate.scoped_definition_id.startsWith(`${NAME}/`)) throw unsupported("runtime agent identity");
  }
  return info;
}

export function parseActivation(value) {
  const activation = value?.skill?.activation;
  if (activation !== "on" && activation !== "off") throw unsupported("git skill activation");
  return activation;
}

export function agentNames(pluginRoot) {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
  if (!Array.isArray(manifest.agents) || manifest.agents.some((path) => typeof path !== "string" || !/^\.\/agents\/[a-z0-9-]+\.md$/.test(path))) {
    throw new Error("package manifest has unsupported agent definitions");
  }
  return manifest.agents.map((path) => path.split("/").at(-1).slice(0, -3));
}

export function capabilities(info, names) {
  const hooks = info.plugin.capabilities.hooks.filter((hook) => normalizeEvent(hook.event) === "sessionstart");
  if (hooks.length !== 1) throw unsupported("expected one session-start hook");
  const definition = hooks[0];
  const stable = `plugin:${NAME}:hook:${definition.id}`;
  const runtime = info.runtime_capabilities;
  const matching = (predicate, field) => {
    const entries = runtime.filter(predicate);
    if (entries.length > 1) throw unsupported(field);
    return entries[0] ?? { status: "missing" };
  };
  const hook = matching(({ candidate: c }) => c.plugin_id === NAME && c.kind === "hook"
    && c.capability_id === definition.id && c.stable_id === stable, "session hook runtime capability");
  const agents = names.map((name) => {
    const scoped = `${NAME}/${name}`;
    const entry = matching(({ candidate: c }) => c.plugin_id === NAME && c.scoped_definition_id === scoped, `agent ${scoped}`);
    return { id: `${NAME}:agent_definition:${scoped}`, status: entry.status };
  });
  return { hook: { ...definition, id: stable, status: hook.status }, agents };
}

export function parseHookResult(result) {
  if (!Array.isArray(result?.terminals) || result.terminals.some((terminal) => !object(terminal) || !string(terminal.status)
    || (terminal.exit_code !== null && !Number.isInteger(terminal.exit_code)))
    || !Array.isArray(result?.decision?.additional_contexts) || result.decision.additional_contexts.some((text) => typeof text !== "string")) {
    throw unsupported("hook test decision.additional_contexts or terminals");
  }
  return result;
}

export function sessionFixture(schema, hook, cwd) {
  const defs = schema?.$defs;
  const events = defs?.HookEventName?.enum;
  if (!Array.isArray(events) || events.some((event) => !string(event))) throw unsupported("schema HookEventName");
  const event = events.find((name) => normalizeEvent(name) === "sessionstart");
  if (!event) throw unsupported("schema session-start event");
  const dereference = (spec) => {
    if (!object(spec)) throw unsupported("schema hook field");
    if (spec.$ref === undefined) return spec;
    if (!string(spec.$ref) || !spec.$ref.startsWith("#/$defs/") || !object(defs[spec.$ref.split("/").at(-1)])) throw unsupported("schema hook reference");
    return defs[spec.$ref.split("/").at(-1)];
  };
  const values = (spec) => {
    spec = dereference(spec);
    if (spec.const !== undefined) {
      if (!string(spec.const)) throw unsupported("schema hook const");
      return [spec.const];
    }
    if (spec.enum !== undefined) {
      if (!Array.isArray(spec.enum) || !spec.enum.length || !spec.enum.every(string)) throw unsupported("schema hook enum");
      return spec.enum;
    }
    if (spec.anyOf !== undefined) {
      if (!Array.isArray(spec.anyOf)) throw unsupported("schema hook anyOf");
      return spec.anyOf.flatMap(values);
    }
    return [];
  };
  const fields = Object.entries(defs).filter(([name]) => /hook|sessionstart/i.test(name)).flatMap(([, def]) => {
    if (!object(def) || (def.properties !== undefined && !object(def.properties))) throw unsupported("schema hook properties");
    return Object.entries(def.properties ?? {});
  });
  const options = (name) => fields.filter(([key]) => key === name).flatMap(([, spec]) => values(spec));
  const sources = options("source");
  const matchers = [...options("matcher_input"), ...options("matcherInput")];
  const source = sources[0] ?? matchers[0] ?? hook.matcher?.split("|")[0] ?? "startup";
  const matcher = matchers[0] ?? source;
  // The Claude-compatible hook test uses PascalCase for MSP's camelCase spelling.
  const name = event === "sessionStart" ? "SessionStart" : event;
  return { event: name, matcher_input: matcher, cwd, stdin: {
    hook_event_name: name, source, session_id: "t3-pstack-science-doctor", cwd,
  } };
}
