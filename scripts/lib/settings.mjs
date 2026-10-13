// Adds or removes the two entries that make Claude Code load the deck-bridge
// mod. Used by install-mod.sh and uninstall.sh; everything else in the
// settings file is left as it is, and a backup is kept before any change.
//
//   node settings.mjs show   <mod folder>
//   node settings.mjs check  <settings.json>
//   node settings.mjs add    <settings.json> <mod folder>
//   node settings.mjs remove <settings.json>
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const MARKETPLACE = "code-command-center";
const MOD = `deck-bridge@${MARKETPLACE}`;

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

/**
 * @param {string} file
 * @returns {Record<string, any>} the settings; empty if there is no file yet
 */
function read(file) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON, so it was left alone.\nFix it and run this again, or change the two entries by hand.`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) fail(`${file} does not hold a settings object, so it was left alone.`);
  return data;
}

/**
 * Writes the settings in one step, with the access rights the file had. A
 * settings file that is a link, as tools that manage dotfiles make them,
 * stays a link: the change goes to the file it leads to.
 *
 * @param {string} file
 * @param {Record<string, any>} data
 */
function write(file, data) {
  const target = followLink(file);
  mkdirSync(path.dirname(file), { recursive: true });
  mkdirSync(path.dirname(target), { recursive: true });
  let mode = 0o600;
  if (existsSync(target)) {
    mode = statSync(target).mode & 0o777;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
    const backup = `${file}.backup-${stamp}`;
    copyFileSync(target, backup);
    console.log(`Backup: ${backup}`);
  }
  const temporary = `${target}.tmp-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { mode });
  renameSync(temporary, target);
}

/**
 * @param {string} file
 * @returns {string} the file itself, or where it leads if it is a link
 */
function followLink(file) {
  try {
    if (!lstatSync(file).isSymbolicLink()) return file;
  } catch {
    return file; // not there yet
  }
  try {
    return realpathSync(file);
  } catch {
    // A link to a file that does not exist yet.
    return path.resolve(path.dirname(file), readlinkSync(file));
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(1);
}

const [command, first, second] = process.argv.slice(2);

if (command === "show" && first !== undefined) {
  console.log(JSON.stringify(entries(path.resolve(first)), null, 2));
} else if (command === "check" && first !== undefined) {
  read(first);
} else if (command === "add" && first !== undefined && second !== undefined) {
  const data = read(first);
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
  const data = read(first);
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
