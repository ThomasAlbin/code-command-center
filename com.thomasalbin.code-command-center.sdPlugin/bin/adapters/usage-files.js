// @ts-check
import { lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { EXPIRED_AFTER_MS, parseReading } from "../core/usage.js";

/** @typedef {import("../core/usage.js").Reading} Reading */

/** A reading is a few hundred bytes; anything much larger is not one. */
const MAX_BYTES = 64 * 1024;

/**
 * Creates the folder the `deck-bridge` mod writes into, private to the user.
 * @param {string} directory
 */
export function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

/**
 * Reads what the `deck-bridge` mod wrote: one small file per Claude Code
 * session. Files too old to matter are removed on the way.
 *
 * @param {string} directory
 * @param {number} now
 * @returns {Map<string, Reading | null>} file name → reading, or `null` for a file that could not be read just now
 */
export function readReadings(directory, now) {
  /** @type {Map<string, Reading | null>} */
  const readings = new Map();
  let names;
  try {
    names = readdirSync(directory);
  } catch {
    return readings;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(directory, name);
    try {
      const stats = lstatSync(file);
      if (!stats.isFile()) continue; // never follow a link out of this folder
      if (now - stats.mtimeMs > EXPIRED_AFTER_MS) {
        unlinkSync(file);
        continue;
      }
      readings.set(name, stats.size > MAX_BYTES ? null : parseReading(readFileSync(file, "utf8")));
    } catch {
      readings.set(name, null);
    }
  }
  return readings;
}
