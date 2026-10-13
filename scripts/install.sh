#!/bin/sh
# Installs the Code Command Center plugin into Stream Deck.
#
#   sh scripts/install.sh          copies the plugin; this folder is not needed afterwards
#   sh scripts/install.sh --link   links it instead, for working on the plugin
#
# Quit and reopen the Stream Deck app afterwards.
set -eu

PLUGIN="com.thomasalbin.code-command-center.sdPlugin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PLUGINS="${STREAMDECK_PLUGINS_DIR:-$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins}"
TARGET="$PLUGINS/$PLUGIN"
MODE="copy"
[ "${1:-}" = "--link" ] && MODE="link"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This plugin runs on macOS only." >&2
  exit 1
fi
if [ ! -d "$PLUGINS" ]; then
  echo "Stream Deck's plugin folder was not found:" >&2
  echo "  $PLUGINS" >&2
  echo "Install the Stream Deck app and open it once, then run this again." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js 20 or newer (https://nodejs.org), then run this again." >&2
  exit 1
fi

echo "Fetching the plugin's one dependency, Elgato's Stream Deck SDK ..."
(cd "$ROOT/$PLUGIN" && npm ci --omit=dev --no-audit --no-fund)

# Whatever is installed under this plugin's name is replaced.
if [ -L "$TARGET" ]; then
  rm "$TARGET"
elif [ -d "$TARGET" ]; then
  rm -rf "$TARGET"
fi

if [ "$MODE" = "link" ]; then
  ln -s "$ROOT/$PLUGIN" "$TARGET"
  echo "Linked:"
else
  mkdir "$TARGET"
  # The log of an earlier run is not part of the plugin.
  (cd "$ROOT/$PLUGIN" && tar -cf - --exclude ./logs .) | (cd "$TARGET" && tar -xf -)
  cp "$ROOT/LICENSE.md" "$ROOT/NOTICE.md" "$TARGET/"
  echo "Installed:"
fi
echo "  $TARGET"
echo
echo "Now quit the Stream Deck app and open it again."
echo "The keys are in the category \"Code Command Center\"."
echo "For the two quota keys, also run:  sh scripts/install-mod.sh"
