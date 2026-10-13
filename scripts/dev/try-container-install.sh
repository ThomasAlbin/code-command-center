#!/bin/sh
# Tries install-mod-container.sh on a throwaway container whose user is not
# root, and checks that nothing in that user's home folder ends up belonging
# to root. A development aid: it starts a container from the image
# ubuntu:22.04, which Docker fetches if it is not on this machine yet, and
# removes the container at the end.
#
#   sh scripts/dev/try-container-install.sh
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DOCKER=""
for candidate in "$(command -v docker 2>/dev/null || true)" /usr/local/bin/docker /opt/homebrew/bin/docker /Applications/Docker.app/Contents/Resources/bin/docker; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    DOCKER="$candidate"
    break
  fi
done
if [ -z "$DOCKER" ]; then
  echo "docker was not found." >&2
  exit 1
fi

NAME="ccc-try-$$"
"$DOCKER" run -d --name "$NAME" ubuntu:22.04 sleep 900 >/dev/null
trap '"$DOCKER" rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

# A user that is not root, with the Claude Code extension where VS Code puts
# it and no ~/.claude yet: the state right after "Rebuild Container".
"$DOCKER" exec "$NAME" sh -c 'useradd -m -u 1234 dev && mkdir -p /home/dev/.vscode-server/extensions/anthropic.claude-code-0.0.0-linux-arm64 && chown -R dev:dev /home/dev/.vscode-server'

FAILED=0
check() {
  description="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "  ok    $description"
  else
    echo "  FAIL  $description"
    FAILED=1
  fi
}
as_dev() {
  "$DOCKER" exec -u dev "$NAME" "$@"
}
all_the_users() {
  "$DOCKER" exec "$NAME" sh -c 'test -z "$(find /home/dev/.claude /home/dev/.code-command-center ! -user dev 2>/dev/null)"'
}
MOD=/home/dev/.code-command-center/marketplace/mod/deck-bridge/hooks/register.js

echo "Install into a home folder that has no ~/.claude yet:"
sh "$ROOT/scripts/install-mod-container.sh" "$NAME" --yes >/dev/null
check "nothing belongs to root" all_the_users
check "the user can still write to ~/.claude" as_dev sh -c 'touch /home/dev/.claude/probe && rm /home/dev/.claude/probe'
check "the settings name the mod" as_dev grep -q 'deck-bridge@code-command-center' /home/dev/.claude/settings.json
check "the mod's copy is there" as_dev test -f "$MOD"
check "the mod's copy is write-protected" as_dev sh -c '! test -w "$1"' sh "$MOD"
check "a reading can be written" as_dev touch /home/dev/.code-command-center/usage/probe.json

echo "Install again over the first, with settings that are a link and hold something else:"
as_dev sh -c 'mkdir -p /home/dev/dotfiles && echo "{\"model\": \"kept\"}" >/home/dev/dotfiles/settings.json && rm /home/dev/.claude/settings.json && ln -s /home/dev/dotfiles/settings.json /home/dev/.claude/settings.json'
sh "$ROOT/scripts/install-mod-container.sh" "$NAME" --yes >/dev/null
check "nothing belongs to root" all_the_users
check "the settings are still a link" as_dev test -L /home/dev/.claude/settings.json
check "what was in them is kept" as_dev grep -q '"kept"' /home/dev/dotfiles/settings.json
check "and the mod is named in them" as_dev grep -q 'deck-bridge@code-command-center' /home/dev/dotfiles/settings.json
check "a backup of the settings was kept" as_dev sh -c 'ls /home/dev/.claude/settings.json.backup-* >/dev/null'
check "the mod's copy is there" as_dev test -f "$MOD"

echo "Remove:"
sh "$ROOT/scripts/install-mod-container.sh" "$NAME" --remove --yes >/dev/null
check "the mod's folder is gone" as_dev sh -c '! test -e /home/dev/.code-command-center'
check "the entries are out of the settings" as_dev sh -c '! grep -q code-command-center /home/dev/dotfiles/settings.json'
check "what else was in them is kept" as_dev grep -q '"kept"' /home/dev/dotfiles/settings.json
check "the settings are still a link" as_dev test -L /home/dev/.claude/settings.json
check "nothing belongs to root" all_the_users

echo "Remove once more, with nothing left to remove:"
sh "$ROOT/scripts/install-mod-container.sh" "$NAME" --remove --yes >/dev/null
check "the settings are untouched" as_dev grep -q '"kept"' /home/dev/dotfiles/settings.json

echo
if [ "$FAILED" = "0" ]; then
  echo "All checks passed."
else
  echo "Some checks failed."
  exit 1
fi
