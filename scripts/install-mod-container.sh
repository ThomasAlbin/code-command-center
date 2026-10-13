#!/bin/sh
# Installs the deck-bridge mod into a running Dev Container, so that turns
# taken there feed the quota keys too. The Stream Deck plugin fetches the
# readings out of the container by itself.
#
# A mod runs inside Claude Code with your permissions, so read the two short
# files in mod/deck-bridge/hooks/ before you run this. A rebuild of the
# container removes the mod again; run this once more afterwards.
#
# In the container, root is used for one thing: finding the home folder that
# holds the Claude Code extension. Whatever is written or removed is written
# or removed as the user who owns that folder, so nothing in it ends up
# belonging to root.
#
#   sh scripts/install-mod-container.sh                        lists the running Dev Containers
#   sh scripts/install-mod-container.sh <container>            shows what it will do and asks first
#   sh scripts/install-mod-container.sh <container> --yes      does not ask
#   sh scripts/install-mod-container.sh <container> --remove   takes the mod out of the container again
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONTAINER=""
YES="no"
REMOVE="no"
for argument in "$@"; do
  case "$argument" in
    --yes) YES="yes" ;;
    --remove) REMOVE="yes" ;;
    -*)
      echo "Unknown option: $argument" >&2
      exit 1
      ;;
    *) CONTAINER="$argument" ;;
  esac
done

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
if ! command -v node >/dev/null 2>&1; then
  echo "node was not found. Install Node.js 20 or newer (https://nodejs.org), then run this again." >&2
  exit 1
fi

if [ -z "$CONTAINER" ]; then
  echo "Running Dev Containers (id, project folder):"
  "$DOCKER" ps --filter label=devcontainer.local_folder --format '  {{.ID}}  {{.Label "devcontainer.local_folder"}}'
  echo
  echo "Run this again with the id of the one to install the mod into."
  exit 0
fi

if [ "$("$DOCKER" inspect --format '{{.State.Running}}' "$CONTAINER" 2>/dev/null || true)" != "true" ]; then
  echo "No running container \"$CONTAINER\"." >&2
  exit 1
fi
FOLDER="$("$DOCKER" inspect --format '{{index .Config.Labels "devcontainer.local_folder"}}' "$CONTAINER")"

# The mod goes to the home folder of the user that VS Code runs as in the
# container, which is where the Claude Code extension is installed. That
# folder can be anyone's, so root looks for it.
EXTENSION="$("$DOCKER" exec -u 0 "$CONTAINER" sh -c 'ls -d /root/.vscode-server*/extensions/anthropic.claude-code-* /home/*/.vscode-server*/extensions/anthropic.claude-code-* 2>/dev/null | head -1')"
if [ -z "$EXTENSION" ]; then
  echo "The Claude Code extension was not found in this container." >&2
  echo "Open the container in VS Code with the Claude Code extension installed, then run this again." >&2
  exit 1
fi
HOME_IN="${EXTENSION%%/.vscode-server*}"
OWNER="$("$DOCKER" exec -u 0 "$CONTAINER" stat -c '%u:%g' "$HOME_IN")"
DATA_IN="$HOME_IN/.code-command-center"
TARGET_IN="$DATA_IN/marketplace"
SETTINGS_IN="$HOME_IN/.claude/settings.json"

# From here on everything runs in the container as the owner of that folder.
inside() {
  "$DOCKER" exec -u "$OWNER" "$CONTAINER" "$@" </dev/null
}
# The same, with a file on this Mac as its input.
inside_from() {
  input="$1"
  shift
  "$DOCKER" exec -i -u "$OWNER" "$CONTAINER" "$@" <"$input"
}

if ! inside sh -c 'test -w "$1" && { [ ! -e "$1/.claude" ] || test -w "$1/.claude"; }' sh "$HOME_IN"; then
  echo "In this container the owner of $HOME_IN cannot write to it, or to the .claude folder in it." >&2
  echo "Claude Code needs to write there itself. Give the folder back to its user, then run this again." >&2
  exit 1
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# The container's settings are changed on this Mac and checked before
# anything in the container is touched.
HAD_SETTINGS="no"
if inside test -f "$SETTINGS_IN"; then
  HAD_SETTINGS="yes"
  inside cat "$SETTINGS_IN" >"$STAGE/settings.json"
  cp "$STAGE/settings.json" "$STAGE/settings-before.json"
fi

# Puts the changed settings into the container, after a backup of the file
# that is there. It is written in place, so a settings file that is a link
# stays one.
put_settings() {
  if [ "$HAD_SETTINGS" = "yes" ]; then
    inside cp -p "$SETTINGS_IN" "$SETTINGS_IN.backup-$(date +%Y%m%d-%H%M%S)"
  fi
  inside_from "$STAGE/settings.json" sh -c 'umask 077; cat >"$1"' sh "$SETTINGS_IN"
}

confirm() {
  if [ "$YES" = "yes" ]; then
    return 0
  fi
  printf "Proceed? [y/N] "
  read -r answer
  case "$answer" in
    y | Y | yes | Yes | YES) return 0 ;;
    *)
      echo "Nothing was changed."
      exit 0
      ;;
  esac
}

if [ "$REMOVE" = "yes" ]; then
  echo "In the Dev Container of $FOLDER this will remove:"
  echo "  $DATA_IN"
  echo "  the entries for \"code-command-center\" in $SETTINGS_IN, keeping a backup of the file"
  echo
  confirm
  if [ "$HAD_SETTINGS" = "yes" ]; then
    node "$ROOT/scripts/lib/settings.mjs" remove "$STAGE/settings.json" >/dev/null
    # Settings without the entries are left exactly as they are.
    if ! cmp -s "$STAGE/settings.json" "$STAGE/settings-before.json"; then
      put_settings
    fi
  fi
  inside sh -c 'if [ -d "$1" ]; then chmod -R u+w "$1"; rm -rf "$1"; fi' sh "$DATA_IN"
  echo "Removed. Claude Code sessions in the container stop using the mod when they are started again."
  exit 0
fi

echo "In the Dev Container of $FOLDER this will:"
echo "  1. put a write-protected copy of the mod into"
echo "       $TARGET_IN"
echo "  2. add these two entries to Claude Code's settings in the container, keeping a backup of the file:"
echo "       $SETTINGS_IN"
node "$ROOT/scripts/lib/settings.mjs" show "$TARGET_IN" | sed 's/^/       /'
echo
confirm

node "$ROOT/scripts/lib/settings.mjs" add "$STAGE/settings.json" "$TARGET_IN" >/dev/null

mkdir -p "$STAGE/marketplace/.claude-plugin"
cp "$ROOT/.claude-plugin/marketplace.json" "$STAGE/marketplace/.claude-plugin/"
cp -R "$ROOT/mod" "$STAGE/marketplace/mod"
cp "$ROOT/LICENSE.md" "$STAGE/marketplace/"

# An earlier copy is replaced. New folders are for their owner only.
inside sh -c 'umask 077; if [ -d "$1" ]; then chmod -R u+w "$1"; rm -rf "$1"; fi; mkdir -p "$1" "$2/usage" "$3"' sh "$TARGET_IN" "$DATA_IN" "$HOME_IN/.claude"
(cd "$STAGE/marketplace" && find . -type f ! -name .DS_Store) | while IFS= read -r file; do
  inside_from "$STAGE/marketplace/$file" sh -c 'umask 077; mkdir -p "$(dirname "$1")" && cat >"$1"' sh "$TARGET_IN/${file#./}"
done
put_settings
# Write-protected, so that the copy is not changed by accident.
inside sh -c 'chmod 700 "$2" "$2/usage"; chmod -R a-w "$1"' sh "$TARGET_IN" "$DATA_IN"

echo
echo "Done. Start a new Claude Code conversation in that container, or reload its VS Code window:"
echo "sessions load the mod when they start."
echo "After the next turn there, the quota keys also show what that session reports."
