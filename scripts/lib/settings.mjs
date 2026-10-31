// Adds or removes the two entries that make Claude Code load the deck-bridge
// mod. Used by install-mod.sh and uninstall.sh; everything else in the
// settings file is left as it is, and a backup is kept before any change.
//
//   node settings.mjs show   <mod folder>
//   node settings.mjs check  <settings.json>
//   node settings.mjs add    <settings.json> <mod folder>
//   node settings.mjs remove <settings.json>
import path from "node:path";
import { fail, read, write } from "./json-file.mjs";

const MARKETPLACE = "code-command-center";
const MOD = `deck-bridge@${MARKETPLACE}`;
const ENTRIES = "the two entries";

/**
 * The entries, as they stand in the settings file.
 * @param {string} folder where the copy of the mod is that Claude Code runs
 */
function entries(folder) {
  return {
    extraKnownMarketplaces: { [MARKETPLACE]: { source: { source: "directory", path: folder } } },
    enabledPlugins: { [MOD]: true },
  };
}

const [command, first, second] = process.argv.slice(2);

if (command === "show" && first !== undefined) {
  console.log(JSON.stringify(entries(path.resolve(first)), null, 2));
} else if (command === "check" && first !== undefined) {
  read(first, ENTRIES);
} else if (command === "add" && first !== undefined && second !== undefined) {
  const data = read(first, ENTRIES);
  const wanted = entries(path.resolve(second));
  for (const key of /** @type {const} */ (["extraKnownMarketplaces", "enabledPlugins"])) {
    const present = data[key];
    if (present !== undefined && (present === null || typeof present !== "object" || Array.isArray(present))) {
      fail(`"${key}" in ${first} is not an object, so the file was left alone.`);
    }
    data[key] = { ...present, ...wanted[key] };
  }
  write(first, data);
  console.log(`Added "${MARKETPLACE}" and "${MOD}" to ${first}`);
} else if (command === "remove" && first !== undefined) {
  const data = read(first, ENTRIES);
  let changed = false;
  for (const [key, name] of /** @type {const} */ ([
    ["extraKnownMarketplaces", MARKETPLACE],
    ["enabledPlugins", MOD],
  ])) {
    const present = data[key];
    if (present !== null && typeof present === "object" && name in present) {
      delete present[name];
      if (Object.keys(present).length === 0) delete data[key];
      changed = true;
    }
  }
  if (changed) {
    write(first, data);
    console.log(`Removed "${MARKETPLACE}" and "${MOD}" from ${first}`);
  } else {
    console.log(`Nothing to remove in ${first}`);
  }
} else {
  fail("usage: settings.mjs show <mod folder> | check <settings.json> | add <settings.json> <mod folder> | remove <settings.json>");
}
