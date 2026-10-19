---
name: swarm
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
4. Pick the worker model from the `swarm workers` line in the model sheet. If the sheet or that line is missing, use the default in [Models](#models). For `auto` or `inherit-parent`, omit `target` so the workers run on the parent model. If `delegate_task` rejects an entry, use the default and say so. If it rejects the default, use another target of the same family from `orchestrator_capabilities`. For a model race, name each arm's model up front. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.
5. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one response as `delegate_task` calls with `mode: "async"` and the step 4 `target`, left unset for `auto` or `inherit-parent`. Every worker runs on this machine, so a worker that writes gets its own git worktree, named by absolute path in its brief as the only place it writes.

When a worker must start from a non-default branch, create its worktree from that branch.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with the table, issue one-liners, gaps or dropouts, and the race rule when used.

## Models

Role defaults on T3, stamped from `plugins/pstack/models.json`, one column per domain. For each task, before step 1 and before the first `delegate_task`, the chat picks the task's column and records it in the todolist as `domain: science` when the task is biology or other scientific work, else as `domain: general`. When the task changes, pick the domain again. When unsure, pick `science`. If the skill opens no todolist, record the domain in the first reply. The chat picks the column, writes each brief, and dispatches each step a skill delegates. Every role resolves from that column, so wherever a skill names a role's line, read `<role>:` under `domain: general` and `science <role>:` under `domain: science`. The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, up to `max` and never a level above it.

In `science`, only `gpt` and `grok` models read the domain's terms. A `science` dispatch to any other family carries a term-free brief. A default marked (term-free brief) gets one. Resolve an `inherit-parent` or `auto` seat's family from `orchestrator_capabilities`' `inheritedModel` before choosing its brief; an unknown family gets a term-free brief. A term-free brief states inputs, outputs, data shapes, invariants, formulas, and acceptance tests in plain math and code, with no vocabulary of biology or other scientific work. `<plugin root>` is the directory that holds this plugin's `skills/`. Write the brief to a file and run `node "<plugin root>/skills/setup-pstack/scripts/term-free.mjs" "<file>"`, adding `--term <word>` for each domain word the task itself uses. The check knows only the listed terms and does not prove a brief is term-free, so write the brief term-free first and use the check as a last guard. It exits 1 and lists each term it finds. Rewrite each listed scientific word. A listed word used in its ordinary code or math sense, such as a library, API, or variable name, may stay, and the dispatch ledger names it. When a term-free seat still treats a brief as biological research, add the words that set it off to `science-terms.txt` in a PR, with the brief excerpt as the example. Stage neutral copies of the code, data, and diffs that seat needs in its own directory, check each text input with the same command, and never point the seat at the original scientific files, papers, transcripts, or diffs. When the work cannot be stated without the terms, have a research delegate on the `science how explorer` line translate it first (its default reads the terms). If that seat's family does not read the terms, the translation stays blocked; never route raw context to it.

A line in the model sheet overrides each default. `<role>: <entry>` sets the general column, as in every sheet written before domains, and `science <role>: <entry>` sets the science column. The sheet is `~/.config/t3-pstack-science/models.md` (`$XDG_CONFIG_HOME/t3-pstack-science/models.md` when that is set), one per machine, and `/setup-pstack` writes it. When it is missing, use the defaults in the table below. An entry is `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, and it maps onto `delegate_task`'s `target`, with the provider instance as `providerInstanceId`, the model as `model`, and the pairs as `options`. It splits at its first `/`, so a model ID with its own `/`, such as OpenCode's `<provider>/<model>`, is written whole after it. Option IDs differ per provider, so take them from `orchestrator_capabilities`. `inherit-parent` or `auto` omits `target`.

| Role | general | science |
| --- | --- | --- |
| swarm workers | `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` | `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` |
