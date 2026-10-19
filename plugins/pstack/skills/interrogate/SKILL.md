---
name: interrogate
description: "Use for \"interrogate\", \"adversarial review\", \"multi-model review\", \"challenge this\", \"stress test this code\", \"find blind spots\", or \"tear this apart\". Multiple LLM reviewers challenge changes from independent angles."
disable-model-invocation: true
---

# Interrogate

Spawn one reviewer per configured model to adversarially review code changes. The adversarial signal comes from model diversity, not assigned personas. The deliverable is a synthesized verdict. Do NOT auto-apply changes.

## Step 1, Scope

Identify what to review from context:

- If the user points at specific files or a diff, use that.
- If on a feature branch, run `git diff main...HEAD` (or the appropriate base branch) for the full changeset.
- If the user's message references recent work, gather the relevant files.

Package the diff or file contents with any surrounding context files the reviewers need to understand the code.

## Step 2, Intent

Before spawning reviewers, state the intent in one clear paragraph from the user's message, commit messages, the PR description if one exists, and the code. If you're unsure about the intent, ask the user before proceeding.

## Step 3, Spawn Reviewers

Launch all reviewers in a single response with `delegate_task`, one per entry on the `interrogate reviewers` line in the model sheet, labeled Reviewer A, B, and so on to match the entry count. If the sheet or that line is missing, use the table defaults.

| Subagent | Default model |
|----------|---------------|
| Reviewer A | general `claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false`; science `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default` |
| Reviewer B | general `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false`; science `claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false` (term-free brief) |
| Reviewer C | general `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default`; science `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` |

Each reviewer gets `role: "review"`, a brief that says to inspect only and change no file, and `target` set from its configured entry, or from its table default when there is no configured line. Omit `target` for an `auto` or `inherit-parent` entry, so that reviewer runs on the parent model.

If `delegate_task` rejects a configured entry, run that reviewer on another target of the same family from `orchestrator_capabilities` and say so. A model's family is the first segment of its ID's last `/` part, such as `claude`, `gpt`, or `grok`, whatever provider instance serves it. With no family match, use Reviewer A's default. If it rejects a table default, spawn on the closest target of the same family from `orchestrator_capabilities` (prefer the same reasoning tier), and open a separate PR to update the default table. Do not block the review on the slug issue. Never treat an alias entry as a rejected slug or apply either fallback to it.

Read `references/reviewer-prompt.md` and fill in the same template for every reviewer with the stated intent, the diff or file contents, the rubric from `references/rubric.md`, and the code-quality lens from `references/code-quality-review.md`. Pick each subagent's reasoning level and fast or standard speed for the job, per the Subagents section of the **poteto-mode** skill.

## Step 4, Synthesize

As results come back, build a unified picture. Parse every reviewer's findings. Merge findings that describe the same issue differently, and note which models raised each one. Findings two or more models raised independently are the highest signal. Read a lone model's finding, but weight it accordingly. Note disagreements. If one model flags something and another explicitly says the opposite, that is context for the verdict.

## Step 5, Lead Judgment

You are the lead reviewer, a pragmatic senior engineer, not a neutral aggregator. Read `references/lead-judgment.md` for the full framework. Put every finding in one of four buckets, with the model(s) that raised it and a one-line rationale.

- **Act on**. Real issues affecting correctness, security, or maintainability given the actual goals. They would block a real PR.
- **Consider**. Legitimate, but you're not sure they outweigh the cost of addressing them now. Worth the user's attention.
- **Noted**. Technically valid but not actionable. Context-dependent, premature optimization, or low-impact at this stage.
- **Dismissed**. Wrong, nitpicky, or missing context, with a brief reason.

## Output Format

### Intent
> [The stated intent paragraph from Step 2]

### Reviewers
- Reviewer [label]: [model name], [N findings] (one bullet per reviewer)

### Act On
[Each: description, which models raised it, why it matters.]

### Consider
[Each: description, which models raised it, the tradeoff.]

### Noted
[Brief list.]

### Dismissed
[Each with a brief rationale.]

### Agreement Map
[Where models agreed and diverged, and what that pattern tells us.]

## Models

Role defaults on T3, stamped from `plugins/pstack/models.json`, one column per domain. For each task, before step 1 and before the first `delegate_task`, the chat picks the task's column and records it in the todolist as `domain: science` when the task is biology or other scientific work, else as `domain: general`. When the task changes, pick the domain again. When unsure, pick `science`. If the skill opens no todolist, record the domain in the first reply. The chat picks the column, writes each brief, and dispatches each step a skill delegates. Every role resolves from that column, so wherever a skill names a role's line, read `<role>:` under `domain: general` and `science <role>:` under `domain: science`. The column picks only the target. The reasoning level follows the **poteto-mode** skill's Subagents section in every column, up to `max` and never a level above it.

In `science`, only `gpt` and `grok` models read the domain's terms. A `science` dispatch to any other family carries a term-free brief. A default marked (term-free brief) gets one. Resolve an `inherit-parent` or `auto` seat's family from `orchestrator_capabilities`' `inheritedModel` before choosing its brief; an unknown family gets a term-free brief. A term-free brief states inputs, outputs, data shapes, invariants, formulas, and acceptance tests in plain math and code, with no vocabulary of biology or other scientific work. `<plugin root>` is the directory that holds this plugin's `skills/`. Write the brief to a file and run `node "<plugin root>/skills/setup-pstack/scripts/term-free.mjs" "<file>"`, adding `--term <word>` for each domain word the task itself uses. The check knows only the listed terms and does not prove a brief is term-free, so write the brief term-free first and use the check as a last guard. It exits 1 and lists each term it finds; send the brief only once it exits 0. Stage neutral copies of the code, data, and diffs that seat needs in its own directory, check each text input with the same command, and never point the seat at the original scientific files, papers, transcripts, or diffs. When the work cannot be stated without the terms, have a research delegate on the `science how explorer` line translate it first (its default reads the terms). If that seat's family does not read the terms, the translation stays blocked; never route raw context to it.

A line in the model sheet overrides each default. `<role>: <entry>` sets the general column, as in every sheet written before domains, and `science <role>: <entry>` sets the science column. The sheet is `~/.config/t3-pstack/models.md` (`$XDG_CONFIG_HOME/t3-pstack/models.md` when that is set), one per machine, and `/setup-pstack` writes it. When it is missing, read `t3-pstack-models.md` in the host's config directory (`$CLAUDE_CONFIG_DIR` or `~/.claude` on Claude Code, `$CODEX_HOME` or `~/.codex` on Codex). An entry is `<providerInstanceId>/<modelId>` plus `<optionId>=<value>` pairs, and it maps onto `delegate_task`'s `target`, with the provider instance as `providerInstanceId`, the model as `model`, and the pairs as `options`. It splits at its first `/`, so a model ID with its own `/`, such as OpenCode's `<provider>/<model>`, is written whole after it. Option IDs differ per provider, so take them from `orchestrator_capabilities`. `inherit-parent` or `auto` omits `target`.

| Role | general | science |
| --- | --- | --- |
| interrogate reviewers | `claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false`, `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false`, `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default` | `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default`, `claudeAgent/claude-opus-5-5 effort=xhigh fastMode=false` (term-free brief), `cursor/grok-4.7 reasoning_effort=xhigh fastMode=false` |
