import { appendFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [mode, out] = process.argv.slice(2);
const key = process.env.CURSOR_API_KEY;
const scrub = (text) => (key ? String(text).split(key).join("[redacted]") : String(text));

const TRAILER =
  "<runtime_info>In case you're asked: you are running in T3 Code through the Cursor harness, as grok-4.7. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n" +
  "<pull_request_linking>\nWhen the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked. When asked to monitor, watch, or babysit a PR and watch_pull_request is available, call it and end your turn: T3 Code wakes you when checks finish, someone else comments, or the branch conflicts, so do not poll or run your own watcher. When you hand the work back to the user, call unwatch_pull_request first so the thread returns to their inbox.\n</pull_request_linking>";
const prompt =
  "Run no tools. Reply in plain text.\n\n" +
  "Quote every always-applied rule you were given, in full.\n" +
  "Then list every subagent type you can dispatch, and quote each description in full.\n\n" +
  TRAILER;

const model = {
  id: "grok-4.7",
  params: [
    { id: "context", value: "256k" },
    { id: "reasoning_effort", value: "low" },
    { id: "fast", value: "false" },
  ],
};
const local = {
  cwd: process.env.LIVE_CWD,
  settingSources: ["project", "user", "team", "mdm", "plugins"],
  sandboxOptions: { enabled: false },
};

function textFrom(update) {
  if (!update || typeof update !== "object") return "";
  if (update.type === "text-delta" && typeof update.text === "string") return update.text;
  return "";
}

async function send(agent) {
  let streamed = "";
  const run = await agent.send(prompt, {
    model,
    onDelta: (event) => {
      streamed += textFrom(event && event.update ? event.update : event);
    },
  });
  const waited = run && typeof run.wait === "function" ? await run.wait() : run;
  return typeof waited?.result === "string" && waited.result.length > 0 ? waited.result : streamed;
}

try {
  const { Agent } = createRequire(import.meta.url)(join(process.env.T3_PSTACK_CURSOR_SDK, "dist/cjs/index.js"));
  const options = { model, name: "t3-pstack-science cursor live proof", mode: "agent", apiKey: key, local };
  const agent = await Agent.create(options);
  if (mode === "off") {
    writeFileSync(out, JSON.stringify({ text: await send(agent) }));
  } else {
    const created = await send(agent);
    const resumed = await Agent.resume(agent.agentId, options);
    const resume = await send(resumed);
    appendFileSync(process.env.LIVE_RULE, `\n${process.env.LIVE_MARKER}\n`);
    const updated = await send(await Agent.create(options));
    writeFileSync(out, JSON.stringify({ created, resume, updated }));
  }
} catch (err) {
  writeFileSync(out, JSON.stringify({ error: scrub(err && err.stack ? err.stack : err) }));
  process.exitCode = 1;
}
