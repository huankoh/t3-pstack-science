<EXTREMELY_IMPORTANT>
You have t3-pstack-science, pstack for T3 Code.

Invoke the `t3-pstack-science:poteto-mode` skill and follow its instructions when a task meets any of these:

- it touches more than one file, or changes a signature other files call
- it involves a design or architecture choice
- it is a bug whose cause is not yet known, or a performance issue

It routes to the right pstack skill from there. On Codex, open its SKILL.md whole, in a shell call of its own with `max_output_tokens: 10000`, since a smaller budget cuts out its middle. For smaller tasks, such as a contained change to one file with an obvious test, a question, or a one-line edit, work directly and verify on the real artifact.

When the intent is already specific, such as TDD, a design sketch, how or why something works, an arena, or an adversarial review, still enter through `t3-pstack-science:poteto-mode` and open that skill from the bundled path it names. The other pstack skills run only from poteto-mode or when the user types them.

This runs on T3: before the first subagent or panel in a session, read the model sheet, `~/.config/t3-pstack-science/models.md` (`$XDG_CONFIG_HOME/t3-pstack-science/models.md` when that is set). If it is missing, use the defaults in each skill's Models section. This chat runs the playbook itself. A step it says to delegate goes through `delegate_task` to that role's sheet entry, and the reply lists which provider and model ran each step.

Commit, push, tag, merge, or open a PR only when the user's request covers it.
A request for a task that ends in a PR, a green or merge-ready PR, a merge, or a release covers the commits, pushes, tags, and PR that task needs, and a task that needs an auditable decision trail covers the commit that records it.
Amend, rebase, cherry-pick, revert, or reset only as part of a task the user's request covers.
Never kill a process that holds a Git lock, and never delete a Git lock file.
For a held lock or a corrupt index, wait, retry, use the holder's own stop mechanism, or report.

User instructions (CLAUDE.md, AGENTS.md, direct requests) take precedence.
This Git rule applies alongside other session-start mandates, such as superpowers.
Their skill checks run as before, and when a task meets the criteria above they route implementation through poteto-mode.
</EXTREMELY_IMPORTANT>
