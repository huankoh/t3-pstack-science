# Security

Report a vulnerability privately, through [GitHub's private vulnerability reporting form](https://github.com/huankoh/t3-pstack-science/security/advisories/new) where the repository has it enabled, or else by contacting the maintainer through their [GitHub profile](https://github.com/chhoumann). Please do not open a public issue for a vulnerability, because the issue tracker is public from the moment you press submit. A private report keeps the details between us until a fix is released.

The skill tree, the hooks, the vendored bun scripts under `plugins/pstack/skills/poteto-mode/scripts`, and the CI workflows are all in scope. Anything that makes an agent run a command the user did not intend, exfiltrate a secret, or reach outside the repository it was pointed at counts, as does a supply-chain weakness in how this repository pins and installs its own dependencies. Findings in T3 Code, Claude Code, or Codex belong to their projects, and findings in the upstream project this repository syncs from belong upstream.

Only the latest release on `main` receives fixes.
A fix ships as a new release, and there are no maintained release branches to back-port to.
Claude Code auto-updates its marketplace, while each Codex home receives the release when the installer runs `update`.

## Threat model

The installer installs nothing and trusts no hook in a home whose `t3-pstack-science` marketplace comes from anywhere but `huankoh/t3-pstack-science` or the run's explicit `--source`. In Codex it trusts only t3-pstack-science's own session-start hook, from the hooks file the Codex manifest names, at the digest `tools/frozen-hooks.json` pins. The installer checks the hook entry against the release's pinned hooks file.
Codex 0.164 and later also tie their trust to every installed plugin file. The marketplace source is what vouches for the script.

An attacker who can already write to the user's Claude Code or Codex home, or to the plugin cache inside it, is out of scope. That is the boundary Codex's hook trust has, since such an attacker can write `hooks.state` in `config.toml` themselves. The installer still closes the simple windows. It checks the source, lists the hooks, and writes the trust in one app-server session, reads the hooks file once and never through a symlink, and takes the trust back when the entry changes before Codex confirms it.

`npx -y github:huankoh/t3-pstack-science` runs the latest commit on `main`.
Claude Code marketplaces auto-update from that channel.
The installer pins Codex Git marketplaces to its release tag and trusts the hook again on each update.
`npx -y github:huankoh/t3-pstack-science#v<version>` runs one release's installer from its tag.
