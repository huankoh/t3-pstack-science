<EXTREMELY_IMPORTANT>
You have t3-pstack-science, pstack for T3 Code.

Invoke the `t3-pstack-science:poteto-mode` skill and follow its instructions when a task meets any of these:

- it touches more than one file, or changes a signature other files call
- it involves a design or architecture choice
- it is a bug whose cause is not yet known, or a performance issue

It routes to the right pstack skill from there. On Codex, open its SKILL.md whole, in a shell call of its own with `max_output_tokens: 10000`, since a smaller budget cuts out its middle. For smaller tasks, such as a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact.

When the intent is already specific, such as TDD, a design sketch, how or why something works, an arena, or an adversarial review, still enter through `t3-pstack-science:poteto-mode` and open that skill from the bundled path it names. The other pstack skills run only from poteto-mode or when the user types them.

This runs on T3: before the first subagent or panel in a session, read the model sheet, `~/.config/t3-pstack-science/models.md` (`$XDG_CONFIG_HOME/t3-pstack-science/models.md` when that is set). If it is missing, use the defaults in each skill's Models section. This chat runs the playbook itself. A step it says to delegate goes through `delegate_task` to that role's sheet entry, and the reply lists which provider and model ran each step.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence. Other session-start mandates, such as superpowers, still apply. Their skill checks run as before, and when a task meets the criteria above they route implementation through poteto-mode.

<!-- muse-mode:start -->

An instruction from the user to use "muse mode" sets `mode: muse` for this chat. A quoted, discussed, or example use of the phrase does not. It lasts across later tasks and resumed turns until "normal mode", "standard mode", or "turn off muse mode", which sets `mode: standard`. A new top-level chat starts at `mode: standard`. Changing mode does not change running children. Record `mode: muse` or `mode: standard` beside `domain:` before the first dispatch. Under `mode: muse`, read `muse <role>:` from the sheet, else the muse default. Never read a standard line or a standard default. A `muse <role>:` line must name a target. `inherit-parent` and `auto` are rejected on a muse line. The domain does not change muse targets. Muse-mode seats whose family is a science term reader (by default Muse and DeepSeek) read the terms. A muse-mode seat whose family is not a science term reader (by default Opus) gets a term-free brief on a science task. Panels in `mode: muse` follow the normal two-family rule. Muse seats start at their listed level and are tuned per job per the **poteto-mode** skill's Subagents section, never above `xhigh`, and a DeepSeek seat always runs at `max`. The sheet `# budget` comment does not set muse levels. A rejected or unrunnable muse target blocks that dispatch and names the target and the fix. Never use a standard seat or the generic same-family fallback. A failed reviewer gets a fresh reviewer on the same entry, or the gate stays `BLOCKED: independent review`. The handback's extra reviewer under `mode: muse` is the first `muse interrogate reviewers` entry outside the work's families, by family as usual. Every brief to a child that can dispatch carries `mode: muse` and the domain. Muse mode moves helpers only. To keep the whole run on Muse, the user picks a Muse model for the chat in the composer.

<!-- muse-mode:end -->
</EXTREMELY_IMPORTANT>
