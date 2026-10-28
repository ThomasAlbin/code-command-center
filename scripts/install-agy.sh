#!/bin/sh
# Connects the Antigravity CLI to the "Session in Antigravity CLI" keys: it
# makes the bridge in mod/antigravity-bridge/ the CLI's status line command.
# The other keys work without it.
#
# The bridge runs inside the Antigravity CLI with your permissions, so read
# mod/antigravity-bridge/statusline.sh, one short file, before you run this.
#
#   sh scripts/install-agy.sh         shows what it will do and asks first
#   sh scripts/install-agy.sh --yes   does not ask
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$HOME/.code-command-center"
TARGET="$DATA/antigravity-bridge"
BRIDGE="$TARGET/statusline.sh"
SETTINGS="$HOME/.gemini/antigravity-cli/settings.json"

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found. Install Node.js 20 or newer (https://nodejs.org), then run this again." >&2
  exit 1
fi
if [ ! -d "$(dirname "$SETTINGS")" ]; then
  echo "The Antigravity CLI was not found: there is no folder" >&2
  echo "  $(dirname "$SETTINGS")" >&2
  echo "Install it and start it once, then run this again." >&2
  exit 1
fi

echo "This will:"
echo "  1. put a write-protected copy of the bridge into"
echo "       $TARGET"
echo "  2. make it the Antigravity CLI's status line command, keeping a backup of the file:"
echo "       $SETTINGS"
node "$ROOT/scripts/lib/agy-settings.mjs" show "$BRIDGE" | sed 's/^/       /'
echo "     The CLI's own status line stays; the bridge adds nothing to it."
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

# Checked before anything is written: settings that cannot be read, or a
# status line command of your own, stop the installation.
node "$ROOT/scripts/lib/agy-settings.mjs" check "$SETTINGS" "$BRIDGE"

# The CLI runs this copy, not the folder you cloned. The copy is
# write-protected against changes by accident; that does not stop a program
# that means to change it.
if [ -d "$TARGET" ]; then
  chmod -R u+w "$TARGET"
  rm -rf "$TARGET"
fi
mkdir -p "$TARGET" "$DATA/antigravity"
chmod 700 "$DATA" "$DATA/antigravity"
cp "$ROOT/mod/antigravity-bridge/statusline.sh" "$BRIDGE"
cp "$ROOT/LICENSE.md" "$TARGET/"
chmod 555 "$BRIDGE"
chmod -R a-w "$TARGET"

node "$ROOT/scripts/lib/agy-settings.mjs" add "$SETTINGS" "$BRIDGE"

echo
echo "Done. Start your Antigravity CLI sessions anew: a session reads its status line"
echo "command when it starts. The \"Session in Antigravity CLI\" keys then show them."
