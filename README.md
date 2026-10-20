# t3-pstack-science

pstack for [T3 Code](https://github.com/pingdotgg/t3code). It is Lauren Tan's (poteto's) [pstack](https://github.com/cursor/plugins/tree/main/pstack), with its Cursor mechanics rewritten in place for T3. Every subagent, panel, fan-out, schedule, and PR watch dispatches through T3's `t3-code` MCP tools, so an `interrogate`, `arena`, or `architect` panel can run Claude, GPT, and Muse reviewers side by side, from a Claude Code thread or a Codex thread.

The skill text is Lauren's. A generated set of substitutions rewrites only what names Cursor (its `Task` tool, its model slugs, its `.mdc` rule, its cloud agents, `/loop`), and a few declared forks carry what a substitution cannot. Nothing else needs loading: the T3 rules sit where Lauren's dispatch rules sit.

t3-pstack-science works only inside T3.

## Install, update, and check

```shell
npx -y github:huankoh/t3-pstack-science install
npx -y github:huankoh/t3-pstack-science update
npx -y github:huankoh/t3-pstack-science doctor
```

`npx -y github:huankoh/t3-pstack-science` runs the installer from the latest commit on `main`. That is the rolling channel, the same one each home's marketplace auto-updates from. To run one release's installer, name its tag, as in `npx -y github:huankoh/t3-pstack-science#v2.0.0-rc.14-science.3 doctor`.

`install` and `update` are the same command, and a second run changes nothing. With Node 20 or later, it installs or updates the `t3-pstack-science@t3-pstack-science` plugin in every Claude Code and Codex config home T3 can run: `~/.claude` and `~/.codex`, `$CLAUDE_CONFIG_DIR` and `$CODEX_HOME`, and the home of each `claudeAgent` and `codex` instance in T3's settings, disabled ones included. Name any other home with `--claude-home <dir>` or `--codex-home <dir>`. Each home's `t3-pstack-science` marketplace must come from `huankoh/t3-pstack-science`, or from `--source <owner/repo|git URL|dir>` on the same run, and a home whose marketplace has another source is left as it is. A local directory needs a path such as `./t3-pstack-science`, since `owner/repo` always means GitHub. On Codex it also trusts t3-pstack-science's session-start hook, once its hooks file is the one this release pins. Codex runs a plugin's hook only once it is trusted, and T3's Codex sessions never ask, so without this step the hook never runs. Run `update` after each release.

`doctor` reports on the same homes and changes nothing itself: each marketplace's source, the installed version, whether its files are all there, whether it is enabled, the Codex hook's trust, Claude Code records that pin an old version, plain copies of the plugin's skills, and the model sheet. It exits 1 on a failed check and prints a fix for each. It warns when chhoumann's plugin is enabled in the same home and its session hook runs. On Codex, that hook must be trusted. Disable that plugin in the home to run only this fork's hook. The installer leaves that plugin and its sheets intact.

### Cursor (opt-in)

```shell
npx -y github:huankoh/t3-pstack-science install --cursor
npx -y github:huankoh/t3-pstack-science update --cursor
npx -y github:huankoh/t3-pstack-science doctor --cursor
npx -y github:huankoh/t3-pstack-science uninstall --cursor
```

`install --cursor` and `update --cursor` also install Claude Code and Codex, as a plain install does, and they copy this package into `~/.cursor/plugins/local/t3-pstack-science`. `doctor --cursor` checks that copy. `uninstall --cursor` removes only that copy. `uninstall` without `--cursor` is a usage error. A `--cursor` run whose `--source` is a remote repository other than `huankoh/t3-pstack-science` is a usage error, because the copy is this package's files or a local `--source` directory. Plain `install`, `update`, and `doctor` never read or write `~/.cursor`, even when T3 settings list a Cursor instance.

The session text is a Cursor rule, and each skill is named by the absolute path of its `SKILL.md` under that copy. A `session hook: off` line in the machine sheet leaves the rule out at the next `install --cursor`. The Cursor app and `cursor-agent` see the copy too, and the rule applies only when a `<runtime_info>` block says the session runs in T3 Code. Lauren's `pstack` keeps loading beside it. Moving the folder to another non-dot name inside `plugins/local` does not disable it. Back out with `uninstall --cursor`.

A running T3 may keep the rule its Cursor sessions read first. In one live test on Cursor SDK 1.0.35, a new session in the same process quoted the other rules but not a line appended to the installed rule. As a precaution, restart T3 after `install --cursor`, `update --cursor`, or `uninstall --cursor`.

Then run `/t3-pstack-science:setup-pstack` in a T3 thread on each machine. It writes the model sheet, `~/.config/t3-pstack-science/models.md`, with one T3 target per role (`<providerInstanceId>/<modelId>` plus that provider's options), and checks it against the machine's `orchestrator_capabilities`. Without a sheet, every role runs on the defaults in its skill's Models section. This fork reads only its machine sheet and never migrates or links another plugin's sheet.

## Use

```text
Use poteto-mode to fix the search filter resetting when I change pages.
```

The session-start hook tells each new chat when to enter `poteto-mode` on its own: work that touches more than one file, a design choice, or a bug whose cause is unknown. `poteto-mode` matches the task to a playbook and opens the other skills from there. They ship as upstream ships them, invoked by `poteto-mode` or typed by you (`/t3-pstack-science:<name>` on Claude Code, `$t3-pstack-science:<name>` on Codex).

The plugin carries 64 skill directories, 24 of them `principle-*` leaves, and 4 agents.

## Muse mode

Say "muse mode" in a chat and every helper that chat dispatches runs on Muse seats instead of the standard routes, for that chat only. It lasts across later tasks in the chat until "normal mode", "standard mode", or "turn off muse mode". A new chat starts in standard mode, and a quoted or discussed use of the phrase switches nothing. Muse mode needs the Muse provider in T3. It moves helpers only, so the chat's own model stays your pick in the composer. To keep the whole run on Muse, pick a Muse model for the chat as well. Muse runs in contributor mode, so muse mode requests go to Meta under contributor terms.

| Job | Tier | Target |
| --- | --- | --- |
| Implementation, swarm workers | `code` | `muse/muse-wonder-1.0 reasoningEffort=xhigh` |
| Mechanical edits | `mechanical` | `muse/muse-spark-1.3 reasoningEffort=max` |
| Research | `explore` | `muse/muse-wonder-1.0 reasoningEffort=xhigh` |
| Judgment, writing, hardest tasks | `judgment` | `muse/muse-wonder-full-1.0 reasoningEffort=xhigh` |
| Final review | `final` | `muse/muse-wonder-full-1.0 reasoningEffort=xhigh` |
| Design candidates | `runners` | Wonder Full xhigh, Opus 5.5 xhigh |
| Design judge | `judges` | Wonder xhigh (ran no candidate), Opus 5.5 xhigh |
| Review panel | `reviewers` | Wonder Full xhigh, Opus 5.5 xhigh |

Opus 5.5 sits on every muse mode panel, so each panel spans two families. On a science task, an Opus panel seat gets a term-free brief, exactly as in the science route. Muse seats read the science terms. Muse mode levels are fixed as listed, and a muse target this machine cannot run blocks that dispatch instead of falling back to a standard seat. `/setup-pstack` writes no muse lines by default. An optional `muse <role>:` sheet line overrides one muse seat, and `doctor` warns, without failing, when the catalog cannot run every muse target.

## Staying current

This repository syncs from Lauren's tree directly, synced against upstream `d457567`. `tools/upstream.json` pins each component, `tools/substitutions.json` holds the rewrite rules and a denylist of Cursor terms, and `tools/forks.json` declares every file the port keeps in its own form and why. `bun tools/sync.mjs <component> <sha>` derives each upstream file through the rules, merges it three ways with the port's copy, and fails on an undeclared fork, a denylist hit, or a rule that no longer matches upstream. [CONTRIBUTING.md](CONTRIBUTING.md#the-sync-boundary) has the details.

## Data handling

t3-pstack-science has no server or telemetry. Anything its skills ask your agent to read, including session transcripts, goes to your model provider. Scripts run locally, and PR tools use your GitHub CLI login.

## Contributing

Bug reports, documentation fixes, and T3 improvements are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the checks and where your change belongs. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

t3-pstack-science is [MIT-licensed](LICENSE). Its T3 modifications and additions are © 2026 Christian Bager Bach Houmann. It builds on:

- [pstack](https://github.com/cursor/plugins/tree/main/pstack) in cursor/plugins, MIT, © 2026 Lauren Tan (poteto), the skill stack itself.
- [pstack-claude](https://github.com/michael-denyer/pstack-claude), MIT, © 2026 Michael Denyer, whose sync, generator, and validation tooling and transcript finder this port still uses.
- The skills imported from [cursor-team-kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit), MIT, © 2026 Cursor. See [LICENSE-cursor-team-kit](LICENSE-cursor-team-kit).
- The skills and review agents imported from [thermos](https://github.com/cursor/plugins/tree/main/thermos), MIT, © 2026 Cursor. See [LICENSE-thermos](LICENSE-thermos).

[NOTICE.md](NOTICE.md) lists each upstream component with its source commit and license file.
