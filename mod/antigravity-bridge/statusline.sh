#!/bin/sh
# Everything that Code Command Center runs inside the Antigravity CLI is this
# file.
#
# The CLI runs it as its status line command each time the agent's state
# changes, and hands it that state as JSON on stdin. It keeps three things of
# it: the state, whether a tool call waits for your approval, and the folder
# the CLI was started in. It writes them to a small file that the Stream Deck
# plugin reads, one file per CLI process, named after the process id. It also
# keeps the plan's limits, how much of each is left and when it resets, in one
# more file for the quota keys.
#
# It prints nothing, so the CLI's own status line stays as it is, and it
# always exits 0, so the CLI never counts it as failing. It reads no prompt or
# reply, makes no network request and changes nothing in the session. The
# programs it starts are all part of macOS: cat, plutil, ps, tr, sed, mv, rm.

DIR="$HOME/.code-command-center/antigravity"
# Made by the installer and by the Stream Deck plugin. Without it nobody is listening.
[ -d "$DIR" ] || exit 0

input=$(/bin/cat)

# One field of the JSON on stdin, as plain text; nothing when it is not there.
field() {
  printf '%s' "$input" | /usr/bin/plutil -extract "$1" raw -o - - 2>/dev/null
}

# The CLI's own process. The CLI starts this file directly; the loop also
# copes with a shell in between.
pid=""
process=$PPID
for _ in 1 2 3; do
  case "$process" in '' | *[!0-9]* | 0 | 1) break ;; esac
  case "$(/bin/ps -o comm= -p "$process" 2>/dev/null)" in
    agy | */agy | antigravity | */antigravity)
      pid=$process
      break
      ;;
  esac
  process=$(/bin/ps -o ppid= -p "$process" 2>/dev/null)
  process=${process##* }
done
[ -n "$pid" ] || exit 0

state=$(field agent_state)
case "$state" in
  '' | *[!a-z_]*) exit 0 ;;
esac
waiting=false
[ "$(field tool_confirmation_pending)" = "true" ] && waiting=true
# Written into JSON, so escaped; a control character has no place in a folder name.
cwd=$(field cwd | LC_ALL=C /usr/bin/tr -d '\000-\037' | /usr/bin/sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
# The limits belong to the account, not to the session: every CLI writes the
# same file and the newest wins. As plutil writes them out again, so valid JSON.
quota=$(printf '%s' "$input" | /usr/bin/plutil -extract quota json -o - - 2>/dev/null)

# Writes a file whole and then moves it into place, so the plugin never reads half a file.
put() {
  tmp="$DIR/.$1.$$.tmp"
  if printf '%s\n' "$2" >"$tmp" 2>/dev/null; then
    /bin/mv -f "$tmp" "$DIR/$1" 2>/dev/null
  fi
  /bin/rm -f "$tmp" 2>/dev/null
}

put "$pid.json" "$(printf '{"v":1,"state":"%s","waiting":%s,"cwd":"%s"}' "$state" "$waiting" "$cwd")"
case "$quota" in
  '{'*'}') put quota.json "{\"v\":1,\"quota\":$quota}" ;;
esac
exit 0
