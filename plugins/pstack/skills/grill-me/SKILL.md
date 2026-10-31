---
name: grill-me
description: Interview the user in rounds until every decision in a plan or design is settled. Use for /grill-me, "grill me", or "stress-test my plan". Runs only when the user asks.
disable-model-invocation: true
---

# Grill me

Interview the user relentlessly until you reach a shared understanding.
Map this as a **design tree**: every decision branches into the decisions that hang off it.

This interview runs because the user asked for it.
No other skill starts it to settle a question that an experiment or a lookup can answer, per the **principle-never-block-on-the-human** skill.

## Rounds

Work the tree in **rounds**.
The **frontier** is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you haven't heard yet.
Ask the whole frontier in one round.
Number each question and give your recommended answer.
Then wait for the user's answers before the next round.

Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>


❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Word each question so "yes" accepts your recommended answer.

Each round the user answers reshapes the tree.
Settled decisions push the frontier outward and unblock questions that depended on them.
Recompute the frontier and ask the next round.
A question whose answer depends on another question still open in this round belongs to a later round, not this one.

## Facts are yours, decisions are theirs

Never ask the user for anything you could look up.
When a frontier question needs a fact from the environment, such as the filesystem, a tool, or the docs, dispatch a fresh research delegate through `delegate_task` on the `how explorer` sheet line, inspect only.
Don't block on it.
A running lookup is an unsettled prerequisite, so only the questions downstream of it wait for its report.
Ask the rest of the frontier now.
The decisions are the user's: put each to them and wait.

When the plan touches the project's own terms, follow [domain-modeling](../domain-modeling/SKILL.md) as you go, so the glossary and ADRs keep up with each decision.

## Done

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed.
Do not act on it until the user confirms you have reached a shared understanding.
