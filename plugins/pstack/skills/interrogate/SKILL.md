---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Adversaries try to break a change or design, and only findings proven by a run survive."
disable-model-invocation: true
---

# Interrogate

Adversaries try to break a change or a design. A finding survives only when a run proves it. Report the findings. Do not apply fixes.

## Frame

The scope is what the user names. Otherwise it is the branch diff from its merge base with the base branch, through the working tree. State the intent with the **in-your-own-words** skill, from the user's message, the commits, and the PR description. Ask the user when the intent is unclear.

## Fan out

Run Phase A steps 3 and 4 and Phase B of the **arena** skill, with four changes. Read the `interrogate reviewers` line in place of `arena runners`. Copy the scope's uncommitted changes into each worktree. Spawn each adversary as a `delegate_task` child with `role: "review"` and no persona brief.

For a required review, the work's models include the chat's model when it edited the change and every delegate's model whose output is in the change.
A model is its ID's last `/` part, so `gpt-6-astra` and `gpt-6.1-sol` are two models of one family, and a reviewer on another model counts as independent.
Use the first entry of the same column's `interrogate reviewers` whose model is outside those models for the independent verdict.
When no entry of the same column's `interrogate reviewers` has a model outside the work's models, use the first entry of that column's `arena cross-judge pool` whose model is outside them.
Add the independent reviewer to the panel if it comes from the judges pool.
Give a reviewer whose family does not read the column's terms a term-free brief per [Models](#models).
If neither pool has a qualifying reviewer, record `BLOCKED: independent review` and keep the gate closed.

 In place of the arena task and rationale, give each adversary the scope, the intent, and this brief:

> Break this change. Prove each finding with a run against the real code, such as a failing test, a repro script, or command output that shows the wrong behavior. For a design or plan, run a prototype or probe the current tree. Keep repros in your own worktree. Report each finding with a title, the exact command, the output it printed, and the output the intent requires. Leave out anything you did not run. That covers style, naming, structure, and risks that need a future change to matter. No findings is a valid result.

## Verify

Verify each finding per arena Phase F by rerunning its command. Keep a finding when the output shows the failure and the failure breaks the intent. Drop the rest. Merge findings that share a root cause.

Skip arena Phases C, D, and E. Adversaries find different failures, so the verdict keeps every verified finding, not one adversary's list.

## Output

- **Intent**: the restatement.
- **Findings**: for each verified finding, the command, its output, how it breaks the intent, and the adversaries that found it. Say "no verified findings" when none survive.
- **Dropped**: for each adversary, the count of dropped findings and why.

## Models

Role defaults on T3, stamped from `plugins/pstack/models.json`, one column per domain. For each task, before step 1 and before the first `delegate_task`, the chat picks the task's column and records it in the todolist as `domain: science` when the task is biology or other scientific work, else as `domain: general`. When the task changes, pick the domain again. When unsure, pick `science`. If the skill opens no todolist, record the domain in the first reply. The chat picks the column, writes each brief, and dispatches each step a skill delegates. Every role resolves from that column, so wherever a skill names a role's line, read `<role>:` under `domain: general` and `science <role>:` under `domain: science`. The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, never above `xhigh` unless the user asks for more in the chat or picked the `unlimited` budget in `/setup-pstack`, an entry on the `deepseek` family always runs at `max`, its listed level, and an entry on a Terra model (`gpt-*-terra`) starts at its listed level, `max` included, and never runs below `high`.

In `science`, only `gpt`, `muse`, and `deepseek` models read the domain's terms. A `science` dispatch to any other family carries a term-free brief. A default marked (term-free brief) gets one. Resolve an `inherit-parent` or `auto` seat's family from `orchestrator_capabilities`' `inheritedModel` before choosing its brief; an unknown family gets a term-free brief. A term-free brief states inputs, outputs, data shapes, invariants, formulas, and acceptance tests in plain math and code, with no vocabulary of biology or other scientific work. `<plugin root>` is the directory that holds this plugin's `skills/`. Write the brief to a file and run `node "<plugin root>/skills/setup-pstack/scripts/term-free.mjs" "<file>"`, adding `--term <word>` for each domain word the task itself uses. The check knows only the listed terms and does not prove a brief is term-free, so write the brief term-free first and use the check as a last guard. It exits 1 and lists each term it finds. Rewrite each listed scientific word. A listed word used in its ordinary code or math sense, such as a library, API, or variable name, may stay, and the dispatch ledger names it. When a term-free seat still treats a brief as biological research, add the words that set it off to `science-terms.txt` in a PR, with the brief excerpt as the example. Stage neutral copies of the code, data, and diffs that seat needs in its own directory, check each text input with the same command, and never point the seat at the original scientific files, papers, transcripts, or diffs. When the work cannot be stated without the terms, have a research delegate on the `science how explorer` line translate it first (its default reads the terms). If that seat's family does not read the terms, the translation stays blocked; never route raw context to it.

A line in the model sheet overrides each default. `<role>: <entry>` sets the general column, as in every sheet written before domains, and `science <role>: <entry>` sets the science column. The sheet is `~/.config/t3-pstack-science/models.md` (`$XDG_CONFIG_HOME/t3-pstack-science/models.md` when that is set), one per machine, and `/setup-pstack` writes it. When it is missing, use the defaults in the table below. An entry is `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, and it maps onto `delegate_task`'s `target`, with the provider instance as `providerInstanceId`, the model as `model`, and the pairs as `options`. It splits at its first `/`, so a model ID with its own `/`, such as OpenCode's `<provider>/<model>`, is written whole after it. Option IDs differ per provider, so take them from `orchestrator_capabilities`. `inherit-parent` or `auto` omits `target`.

| Role | general | science |
| --- | --- | --- |
| interrogate reviewers | `codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default`, `codex/gpt-6-astra reasoningEffort=high serviceTier=default` | `codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default`, `codex/gpt-6-astra reasoningEffort=high serviceTier=default` |
