// Reads and writes a settings file of another program with care: a file that
// cannot be read is left alone, a backup is kept before any change, the file
// keeps its access rights, and a file that is a link stays one. Used by
// settings.mjs (Claude Code) and agy-settings.mjs (the Antigravity CLI).
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

/**
 * @param {string} file
 * @param {string} entries what this tool would change, for the message when the file cannot be read
 * @returns {Record<string, any>} the settings; empty if there is no file yet
 */
export function read(file, entries) {
  if (!existsSync(file)) return {};
  const text = readFileSync(file, "utf8");
  if (text.trim() === "") return {};
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`${file} is not valid JSON, so it was left alone.\nFix it and run this again, or change ${entries} by hand.`);
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
export function write(file, data) {
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
export function fail(message) {
  console.error(message);
  process.exit(1);
}
