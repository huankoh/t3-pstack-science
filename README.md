# t3-pstack-science

pstack for [T3 Code](https://github.com/pingdotgg/t3code).
It is Lauren Tan's (poteto's) [pstack](https://github.com/cursor/plugins/tree/main/pstack), with its Cursor mechanics rewritten in place for T3.
Every subagent, panel, fan-out, schedule, and PR watch dispatches through T3's `t3-code` MCP tools, so an `interrogate`, `arena`, or `architect` panel can run Claude, GPT, Muse, and DeepSeek reviewers side by side, from a Claude Code thread or a Codex thread.

The skill text is Lauren's.
A generated set of substitutions rewrites only what names Cursor (its `Task` tool, its model slugs, its `.mdc` rule, its cloud agents, `/loop`), and a few declared forks carry what a substitution cannot.
Nothing else needs loading: the T3 rules sit where Lauren's dispatch rules sit.

t3-pstack-science works only inside T3.

## Install, update, and check

```shell
npx -y github:huankoh/t3-pstack-science install
npx -y github:huankoh/t3-pstack-science update
npx -y github:huankoh/t3-pstack-science doctor
```

`npx -y github:huankoh/t3-pstack-science` runs the installer from the latest commit on `main`.
That is the rolling channel, the same one each home's marketplace auto-updates from.
To run one release's installer, name its tag, as in `npx -y github:huankoh/t3-pstack-science#v2.0.0-rc.15-science.2 doctor`.

`install` and `update` are the same command, and a second run changes nothing.
With Node 20 or later, it installs or updates the `t3-pstack-science@t3-pstack-science` plugin in every Claude Code and Codex config home T3 can run: `~/.claude` and `~/.codex`, `$CLAUDE_CONFIG_DIR` and `$CODEX_HOME`, and the home of each `claudeAgent` and `codex` instance in T3's settings, disabled ones included.
Name any other home with `--claude-home <dir>` or `--codex-home <dir>`.
Each home's `t3-pstack-science` marketplace must come from `huankoh/t3-pstack-science`, or from `--source <owner/repo|git URL|dir>` on the same run, and a home whose marketplace has another source is left as it is.
A local directory needs a path such as `./t3-pstack-science`, since `owner/repo` always means GitHub.
On Codex it also trusts t3-pstack-science's session-start hook, once its hooks file is the one this release pins.
Codex runs a plugin's hook only once it is trusted, and T3's Codex sessions never ask, so without this step the hook never runs.
Run `update` after each release.

`doctor` reports on the same homes and changes nothing itself: each marketplace's source, the installed version, whether its files are all there, whether it is enabled, the Codex hook's trust, Claude Code records that pin an old version, plain copies of the plugin's skills, and the model sheet.
It exits 1 on a failed check and prints a fix for each.
It warns when chhoumann's plugin is enabled in the same home and its session hook runs.
On Codex, that hook must be trusted.
Disable that plugin in the home to run only this fork's hook.
The installer leaves that plugin and its sheets intact.

### Cursor (opt-in)

```shell
npx -y github:huankoh/t3-pstack-science install --cursor
npx -y github:huankoh/t3-pstack-science update --cursor
npx -y github:huankoh/t3-pstack-science doctor --cursor
npx -y github:huankoh/t3-pstack-science uninstall --cursor
```

`install --cursor` and `update --cursor` also install Claude Code and Codex, as a plain install does, and they copy this package into `~/.cursor/plugins/local/t3-pstack-science`.
`doctor --cursor` checks that copy.
`uninstall --cursor` removes only that copy.
`uninstall` without `--cursor` or `--muse` is a usage error.
A `--cursor` run whose `--source` is a remote repository other than `huankoh/t3-pstack-science` is a usage error, because the copy is this package's files or a local `--source` directory.
Plain `install`, `update`, and `doctor` never read or write `~/.cursor`, even when T3 settings list a Cursor instance.

The session text is a Cursor rule, and each skill is named by the absolute path of its `SKILL.md` under that copy.
A `session hook: off` line in the machine sheet leaves the rule out at the next `install --cursor`.
The Cursor app and `cursor-agent` see the copy too, and the rule applies only when a `<runtime_info>` block says the session runs in T3 Code.
Lauren's `pstack` keeps loading beside it.
Moving the folder to another non-dot name inside `plugins/local` does not disable it.
Back out with `uninstall --cursor`.

A running T3 may keep the rule its Cursor sessions read first.
In one live test on Cursor SDK 1.0.35, a new session in the same process quoted the other rules but not a line appended to the installed rule.
As a precaution, restart T3 after `install --cursor`, `update --cursor`, or `uninstall --cursor`.

### Muse Code (opt-in)

```shell
npx -y github:huankoh/t3-pstack-science install --muse
npx -y github:huankoh/t3-pstack-science update --muse
npx -y github:huankoh/t3-pstack-science doctor --muse
npx -y github:huankoh/t3-pstack-science uninstall --muse
```

`install --muse` and `update --muse` also serve Claude Code and Codex, as a plain install does.
They install this package into Muse's cache at user scope, so Muse keeps its own copy after an npx checkout disappears.
A local `--source <dir>` supplies that copy instead.
As with `--cursor`, a remote `--source` must name `huankoh/t3-pstack-science`.
An identical run changes nothing, and a version update replaces the active plugin record.
All four commands accept `--cursor --muse` together.
Plain commands never read or write Muse's setup.

The installer uses `providerInstances.muse.config.binaryPath` from T3's settings when set, then `muse` on PATH, then `~/.local/bin/muse`.
It approves only this plugin's session-start hook and its four agent definitions, `poteto-agent`, `comment-sicko`, `thermo-nuclear-review-subagent`, and `thermo-nuclear-code-quality-review-subagent`.
Each approval is printed with the capability id reported by Muse.
Muse's Claude-compatible loader sets `CLAUDE_PLUGIN_ROOT` and delivers the existing hook's stdout as session context.
Neither frozen hooks JSON file changes.

Muse's built-in `git` skill requires a separate request for each exact Git write, which conflicts with the shared rule used by the other runtimes.
`--muse` disables that skill and records ownership of the change.
The shared rule allows commits, pushes, tags, merges, and PRs when the user's request covers them.
A task ending in a PR, a merge, or a release covers the commits and pushes it needs.
It also forbids killing or deleting a process or lock file holding Git state, and says to wait, retry, or report.
`uninstall --muse` removes only t3-pstack-science from Muse and re-enables the built-in skill only if this installer disabled it.

`doctor --muse` checks the CLI version, the installed release, whether the plugin is enabled and active, hook and agent approval, and the disabled Git skill.
It also exports `muse schema`, builds a session-start fixture, and runs `muse plugins hook test` to verify that the output carries the shared context.
A missing or broken Muse install fails doctor only when `--muse` is passed.
An explicit `session hook: off` in the machine sheet suppresses context, as it does in the other runtimes.
Restart T3 after `update --muse` so new sessions load the refreshed plugin.

Then run `/t3-pstack-science:setup-pstack` in a T3 thread on each machine.
It writes the model sheet, `~/.config/t3-pstack-science/models.md`, with one T3 target per role (`<providerInstanceId>/<modelId>` plus that provider's options), and checks it against the machine's `orchestrator_capabilities`.
Without a sheet, every role runs on the defaults in its skill's Models section.
This fork reads only its machine sheet and never migrates or links another plugin's sheet.

## Use

```text
Use poteto-mode to fix the search filter resetting when I change pages.
```

The session-start hook tells each new chat when to enter `poteto-mode` on its own: work that touches more than one file, a design choice, or a bug whose cause is unknown.
`poteto-mode` matches the task to a playbook and opens the other skills from there.
They ship as upstream ships them, invoked by `poteto-mode` or typed by you (`/t3-pstack-science:<name>` on Claude Code, `$t3-pstack-science:<name>` on Codex).

The plugin carries 64 skill directories, 24 of them `principle-*` leaves, and 4 agents.
A bug fix, feature, or refactoring change gets one `interrogate` review round before a PR, then one fix run and an artifact check, unless you ask for more review rounds.
A failing artifact check gets another fix run and another check, with at most three fix runs and no re-review.

## Model defaults

Routing has two columns, `general` and `science`.
Use `science` for biology or other scientific work, and `general` for other tasks.
Both columns use the defaults below.
The science gate changes the brief for families that cannot read the domain terms.
GPT, Muse, and DeepSeek read science terms, while Claude Opus gets a term-free brief.
In `general`, every family can read the task's terms.

| Tier | Target in general and science |
| --- | --- |
| `code` | `codex/gpt-6.1-sol reasoningEffort=xhigh serviceTier=default` |
| `explore` | `opencode/opencode-go/deepseek-v4.1-flash variant=max` |
| `mechanical` | `opencode/opencode-go/deepseek-v4.1-flash variant=max` |
| `judgment` | `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default` |
| `final` | `codex/gpt-6-astra reasoningEffort=xhigh serviceTier=default` |
| `runners` | GPT Sol xhigh, Claude Opus 5.5 xhigh, Muse Wonder Full 1.0 xhigh |
| `judges` | GPT Astra xhigh, Muse Wonder Full 1.0 xhigh, Claude Opus 5.5 xhigh |
| `reviewers` | DeepSeek V4.1 Flash max, GPT Sol xhigh |

Claude runs with `fastMode=false`, and GPT runs with `serviceTier=default`.
Each helper's reasoning level is tuned per job, up to `xhigh` unless you ask for more or pick the `unlimited` budget.
DeepSeek always stays at `max`.
An unprefixed `<role>:` sheet line overrides the general column, and `science <role>:` overrides the science column.
Existing explicit machine-sheet entries keep their targets until you change them.
On a `/setup-pstack` re-run, choose `keep the current targets` or `adopt the current defaults`.
Adopting starts from the current default table and reapplies only the overrides you name.

## Staying current

This repository syncs from Lauren's tree directly, synced against upstream `88d4751`.
`tools/upstream.json` pins each component, `tools/substitutions.json` holds the rewrite rules and a denylist of Cursor terms, and `tools/forks.json` declares every file the port keeps in its own form and why.
`bun tools/sync.mjs <component> <sha>` derives each upstream file through the rules, merges it three ways with the port's copy, and fails on an undeclared fork, a denylist hit, or a rule that no longer matches upstream.
[CONTRIBUTING.md](CONTRIBUTING.md#the-sync-boundary) has the details.

## Data handling

t3-pstack-science has no server or telemetry.
Anything its skills ask your agent to read, including session transcripts, goes to your model provider.
Scripts run locally, and PR tools use your GitHub CLI login.

## Contributing

Bug reports, documentation fixes, and T3 improvements are welcome.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and where your change belongs.
Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

t3-pstack-science is [MIT-licensed](LICENSE).
Its T3 modifications and additions are © 2026 Christian Bager Bach Houmann.
It builds on:

- [pstack](https://github.com/cursor/plugins/tree/main/pstack) in cursor/plugins, MIT, © 2026 Lauren Tan (poteto), the skill stack itself.
- [pstack-claude](https://github.com/michael-denyer/pstack-claude), MIT, © 2026 Michael Denyer, whose sync, generator, and validation tooling and transcript finder this port still uses.
- The skills imported from [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit), MIT, © 2026 Cursor.
  See [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit).
- The skills and review agents imported from [thermos](https://github.com/cursor/plugins/tree/main/thermos), MIT, © 2026 Cursor.
  See [LICENSE-thermos](LICENSE-thermos).

[NOTICE.md](NOTICE.md) lists each upstream component with its source commit and license file.
