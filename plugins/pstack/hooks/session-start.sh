#!/bin/sh
set -eu

case "${1:-}" in
  claude|codex) ;;
  *)
    echo "session-start.sh: unknown runtime '${1:-}' (expected claude or codex)" >&2
    exit 2
    ;;
esac

reader="${CLAUDE_PLUGIN_ROOT}/skills/setup-pstack/scripts/read-sheet.sh"
sheet="${XDG_CONFIG_HOME:-$HOME/.config}/t3-pstack-science/models.md"

# A sheet that cannot be decoded counts as missing, so injection stays on.
if ! { [ -f "$sheet" ] && [ -r "$sheet" ] && normalized=$(sh "$reader" "$sheet"); }; then
  normalized=
fi
if printf '%s\n' "$normalized" | grep -qx 'session hook: off'; then
  exit 0
fi

cat "${CLAUDE_PLUGIN_ROOT}/hooks/session-start-context.md"
