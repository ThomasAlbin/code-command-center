// Adds or removes the one entry that makes the Antigravity CLI run the bridge
// as its status line command. Used by install-agy.sh and uninstall.sh;
// everything else in the settings file is left as it is, and a backup is kept
// before any change. A status line command of your own is never replaced.
//
//   node agy-settings.mjs show   <bridge>
//   node agy-settings.mjs check  <settings.json> <bridge>
//   node agy-settings.mjs add    <settings.json> <bridge>
//   node agy-settings.mjs remove <settings.json> <bridge>
import path from "node:path";
import { fail, read, write } from "./json-file.mjs";

const ENTRY = 'the "statusLine" entry';
/** The CLI may run the command through a shell, so the path has to need no quoting. */
const PLAIN_PATH = /^\/[A-Za-z0-9._/-]+$/;

/**
 * The entry, as it stands in the settings file. `stack_with_default` keeps
 * the CLI's own status line; the bridge prints nothing under it.
 *
 * @param {string} bridge where the copy of the bridge is that the CLI runs
 */
function entry(bridge) {
  if (!PLAIN_PATH.test(bridge)) fail(`The bridge's path has characters the CLI might not take in a command:\n  ${bridge}`);
  return { statusLine: { type: "command", command: bridge, stack_with_default: true } };
}

/**
 * @param {unknown} statusLine what the settings hold under `statusLine`
 * @param {string} bridge
 * @returns {boolean} whether it is the bridge's entry
 */
function isOurs(statusLine, bridge) {
  return statusLine !== null && typeof statusLine === "object" && /** @type {{ command?: unknown }} */ (statusLine).command === bridge;
}

/**
 * Stops when the settings name a status line command of someone else's.
 * @param {string} file
 * @param {Record<string, any>} data
 * @param {string} bridge
 */
function refuseOthers(file, data, bridge) {
  const present = data.statusLine;
  if (present === undefined || isOurs(present, bridge)) return;
  const command = present !== null && typeof present === "object" && typeof present.command === "string" ? present.command : JSON.stringify(present);
  fail(
    `The Antigravity CLI already has a status line command in ${file}:\n  ${command}\n` +
      "The bridge would take its place, so nothing was changed. The CLI runs one status line command;\n" +
      'to use the keys, remove "statusLine" there (or run /statusline delete in the CLI) and run this again.',
  );
}

const [command, first, second] = process.argv.slice(2);

if (command === "show" && first !== undefined) {
  console.log(JSON.stringify(entry(path.resolve(first)), null, 2));
} else if (command === "check" && first !== undefined && second !== undefined) {
  entry(path.resolve(second));
  refuseOthers(first, read(first, ENTRY), path.resolve(second));
} else if (command === "add" && first !== undefined && second !== undefined) {
  const bridge = path.resolve(second);
  const data = read(first, ENTRY);
  refuseOthers(first, data, bridge);
  write(first, { ...data, ...entry(bridge) });
  console.log(`Set the status line command in ${first}`);
} else if (command === "remove" && first !== undefined && second !== undefined) {
  const data = read(first, ENTRY);
  if (isOurs(data.statusLine, path.resolve(second))) {
    delete data.statusLine;
    write(first, data);
    console.log(`Removed the bridge's status line command from ${first}`);
  } else {
    console.log(`Nothing to remove in ${first}`);
  }
} else {
  fail("usage: agy-settings.mjs show <bridge> | check <settings.json> <bridge> | add <settings.json> <bridge> | remove <settings.json> <bridge>");
}
