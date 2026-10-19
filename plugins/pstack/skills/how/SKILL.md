---
name: how
description: "Use for \"how does X work\", code walkthroughs before changing something, and placement / ownership / layering questions (\"where should this live\", \"which package owns this\", \"is this the right layer\"). Explains subsystem architecture, runtime flow, onboarding mental models. Use why for motivation."
disable-model-invocation: true
---

# How

Explore the codebase to answer "how does X work?" questions. Produce architectural explanations at the level of a senior engineer onboarding onto a subsystem, enough to build a working mental model, not so much that it reads like annotated source code.

Every spawn is a `delegate_task` child with `role: "research"` and a brief that says to inspect only and change no file. Explorers use the `how explorer` line in the model sheet (default in [Models](#models)), and every explainer uses the `how explainer` line (default in [Models](#models)). Set `target` from that line's entry, or from the default if the sheet or the line is missing. Leave `target` unset when the value is `auto` or `inherit-parent`. If `delegate_task` rejects an entry, use the default and say so. If it rejects the default, use another target of the same family from `orchestrator_capabilities`. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

## 1. Assess complexity

If the scope is ambiguous, state your interpretation and explore. The user can redirect.

- **Simple** (a single module, a small utility, a narrow question such as "how does function X work"): no explorers. Spawn one explainer that explores and explains in one pass, built from `references/explainer-prompt.md` without the explorer-findings section. Go to step 4.
- **Complex** (a subsystem spanning multiple files or services, a cross-cutting feature, a full architectural overview): go to step 2.

When in doubt, take the simple path.

## 2. Explore (complex only)

Decompose the question into 2 to 4 angles, each a distinct slice of the subsystem. Spawn all explorers in a single message, each with `references/explorer-prompt.md` and its angle filled in.

## 3. Synthesize (complex only)

Once all explorers have returned, spawn one explainer with `references/explainer-prompt.md` and every explorer's findings filled in.

## 4. Present

Present the explainer's output. Light edits for clarity or context from the conversation are fine. Do not substantially rewrite it.

## Output format

The explanation uses the sections defined in `references/explainer-prompt.md`, dropping any that do not apply: Overview, Key Concepts, How It Works, Where Things Live, Gotchas.

## Models

Role defaults on T3, stamped from `plugins/pstack/models.json`, one column per domain. Before the first dispatch, the chat that runs the playbook picks the task's column and records it in the todolist as `domain: science` when the task is biology or other scientific work, else as `domain: general`. A thread that already records one keeps it. The chat is the orchestrator only. It picks the column, writes each brief, and dispatches. Every role resolves from that column, so wherever a skill names a role's line, read `<role>:` under `domain: general` and `science <role>:` under `domain: science`. The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, up to `max` and never a level above it, such as Codex's `ultra`.

In `science`, only `gpt` and `grok` models read the domain's terms. A `science` dispatch to any other family carries a term-free brief. Resolve an `inherit-parent` or `auto` seat's family from `orchestrator_capabilities`' `inheritedModel` before choosing its brief; an unknown family gets a term-free brief. A term-free brief states inputs, outputs, data shapes, invariants, formulas, and acceptance tests in plain math and code, with no vocabulary of biology or other scientific work. Write it to a file and run `node <plugin root>/skills/setup-pstack/scripts/term-free.mjs <file>`, adding `--term <word>` for each domain word the task itself uses. It exits 1 and lists each term it finds; send the brief only once it exits 0. Stage neutral copies of the code, data, and diffs that seat needs in its own directory, check each text input with the same command, and never point the seat at the original scientific files, papers, transcripts, or diffs. When the work cannot be stated without the terms, have a research delegate on the `science how explorer` line translate it first (its default reads the terms). If that seat's family does not read the terms, the translation stays blocked; never route raw context to it. A default marked (term-free brief) is such a seat.

A line in the model sheet overrides each default. `<role>: <entry>` sets the general column, as in every sheet written before domains, and `science <role>: <entry>` sets the science column. The sheet is `~/.config/t3-pstack/models.md` (`$XDG_CONFIG_HOME/t3-pstack/models.md` when that is set), one per machine, and `/setup-pstack` writes it. When it is missing, read `t3-pstack-models.md` in the host's config directory (`$CLAUDE_CONFIG_DIR` or `~/.claude` on Claude Code, `$CODEX_HOME` or `~/.codex` on Codex). An entry is `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, and it maps onto `delegate_task`'s `target`, with the provider instance as `providerInstanceId`, the model as `model`, and the pairs as `options`. It splits at its first `/`, so a model ID with its own `/`, such as OpenCode's `<provider>/<model>`, is written whole after it. Option IDs differ per provider, so take them from `orchestrator_capabilities`. `inherit-parent` or `auto` omits `target`.

| Role | general | science |
| --- | --- | --- |
| how explorer | `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` | `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` |
| how explainer | `claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false` | `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default` |
