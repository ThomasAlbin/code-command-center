#!/bin/sh
# Builds the file people install with a double click:
#   dist/com.thomasalbin.code-command-center.streamDeckPlugin
# Attach it to a release. It holds the plugin, its one dependency and the
# license; the mod is installed separately (see the README).
set -eu

PLUGIN="com.thomasalbin.code-command-center.sdPlugin"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/dist/${PLUGIN%.sdPlugin}.streamDeckPlugin"

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir "$STAGE/$PLUGIN"
(cd "$ROOT/$PLUGIN" && tar -cf - --exclude ./logs --exclude ./node_modules .) | (cd "$STAGE/$PLUGIN" && tar -xf -)
(cd "$STAGE/$PLUGIN" && npm ci --omit=dev --no-audit --no-fund)
cp "$ROOT/LICENSE.md" "$ROOT/NOTICE.md" "$STAGE/$PLUGIN/"

mkdir -p "$ROOT/dist"
rm -f "$OUT"
(cd "$STAGE" && zip -r -q -X "$OUT" "$PLUGIN" -x "*.DS_Store")
echo "$OUT"
