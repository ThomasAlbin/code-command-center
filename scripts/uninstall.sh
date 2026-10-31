#!/bin/sh
# Removes Code Command Center from this Mac: the plugin from Stream Deck, the
# mod's two entries from Claude Code's settings, the bridge's status line
# entry from the Antigravity CLI's settings, and the folder with the copies of
# the mod and the bridge, the usage readings and the sessions' states.
#
#   sh scripts/uninstall.sh         shows what it will remove and asks first
#   sh scripts/uninstall.sh --yes   does not ask
set -eu

PLUGIN="com.thomasalbin.code-command-center.sdPlugin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS="${STREAMDECK_PLUGINS_DIR:-$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins}"
TARGET="$PLUGINS/$PLUGIN"
DATA="$HOME/.code-command-center"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
AGY_SETTINGS="$HOME/.gemini/antigravity-cli/settings.json"
BRIDGE="$DATA/antigravity-bridge/statusline.sh"

echo "This will remove:"
echo "  $TARGET"
echo "  $DATA"
echo "  the entries for \"code-command-center\" in $SETTINGS"
echo "  the bridge's status line command in $AGY_SETTINGS"
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

# The settings come first: if they cannot be changed, nothing has been removed yet.
ENTRIES="gone"
if [ -f "$SETTINGS" ]; then
  if command -v node >/dev/null 2>&1; then
    node "$ROOT/scripts/lib/settings.mjs" remove "$SETTINGS"
  else
    ENTRIES="left"
  fi
fi
# Only the bridge's own entry: a status line command of yours stays.
STATUS_LINE="gone"
if [ -f "$AGY_SETTINGS" ] && grep -qF "$BRIDGE" "$AGY_SETTINGS"; then
  if command -v node >/dev/null 2>&1; then
    node "$ROOT/scripts/lib/agy-settings.mjs" remove "$AGY_SETTINGS" "$BRIDGE"
  else
    STATUS_LINE="left"
  fi
fi

if [ -L "$TARGET" ]; then
  rm "$TARGET"
elif [ -d "$TARGET" ]; then
  rm -rf "$TARGET"
fi

if [ -d "$DATA" ]; then
  chmod -R u+w "$DATA"
  rm -rf "$DATA"
fi

if [ "$ENTRIES" = "left" ]; then
  echo "The plugin and the folder are removed, but node was not found, so two entries are still in"
  echo "  $SETTINGS"
  echo "Remove them by hand: \"code-command-center\" under \"extraKnownMarketplaces\" and"
  echo "\"deck-bridge@code-command-center\" under \"enabledPlugins\". Or install Node.js and run this again."
fi
if [ "$STATUS_LINE" = "left" ]; then
  echo "The plugin and the folder are removed, but node was not found, so the bridge is still the"
  echo "status line command in"
  echo "  $AGY_SETTINGS"
  echo "Remove \"statusLine\" there by hand, or run /statusline delete in the Antigravity CLI."
fi
[ "$ENTRIES" = "gone" ] && [ "$STATUS_LINE" = "gone" ] || exit 1
echo "Removed. Quit and reopen Stream Deck and Claude, and start Antigravity CLI sessions anew, to finish."
