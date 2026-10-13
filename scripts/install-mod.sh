#!/bin/sh
# Installs the deck-bridge mod into Claude Code. The two quota keys need it;
# the session keys work without it.
#
# A mod runs inside Claude Code with your permissions, so read the two short
# files in mod/deck-bridge/hooks/ before you run this.
#
#   sh scripts/install-mod.sh         shows what it will do and asks first
#   sh scripts/install-mod.sh --yes   does not ask
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/.code-command-center"
TARGET="$DATA/marketplace"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found. Install Node.js 20 or newer (https://nodejs.org), then run this again." >&2
  exit 1
fi

echo "This will:"
echo "  1. put a write-protected copy of the mod into"
echo "       $TARGET"
echo "  2. add these two entries to Claude Code's settings, keeping a backup of the file:"
echo "       $SETTINGS"
node "$ROOT/scripts/lib/settings.mjs" show "$TARGET" | sed 's/^/       /'
echo

if [ "${1:-}" != "--yes" ]; then
  printf "Proceed? [y/N] "
  read -r answer
  case "$answer" in
    y | Y | yes | Yes | YES) ;;
    *)
      echo "Nothing was changed."
      exit 0
      ;;
  esac
fi

# Checked before anything is written: a settings file that cannot be read stops the installation.
node "$ROOT/scripts/lib/settings.mjs" check "$SETTINGS"

# Claude Code runs this copy, not the folder you cloned, so work on the
# clone does not reach Claude Code. The copy is write-protected against
# changes by accident; that does not stop a program that means to change it.
if [ -d "$TARGET" ]; then
  chmod -R u+w "$TARGET"
  rm -rf "$TARGET"
fi
mkdir -p "$TARGET/.claude-plugin" "$DATA/usage"
chmod 700 "$DATA" "$DATA/usage"
cp "$ROOT/.claude-plugin/marketplace.json" "$TARGET/.claude-plugin/"
cp -R "$ROOT/mod" "$TARGET/mod"
cp "$ROOT/LICENSE.md" "$TARGET/"
find "$TARGET" -name .DS_Store -delete
chmod -R a-w "$TARGET"

node "$ROOT/scripts/lib/settings.mjs" add "$SETTINGS" "$TARGET"

echo
echo "Done. Quit Claude (and VS Code, if you use Claude Code there) and open it again:"
echo "sessions load the mod when they start."
echo "After your next turn in Claude Code a file appears in"
echo "  $DATA/usage"
echo "and the quota keys show their numbers."
