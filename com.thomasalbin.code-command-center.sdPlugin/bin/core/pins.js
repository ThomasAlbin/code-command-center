// @ts-check
import { folderLabel } from "./format.js";

/**
 * A project a key can be pinned to.
 * @typedef {object} Project
 * @property {string} id the project's folder on this Mac
 * @property {string} label
 * @property {boolean} running whether a session of it is running now
 */

/**
 * Reads the pin out of a key's stored settings, which could hold anything.
 *
 * @param {unknown} settings
 * @returns {string | undefined} a project folder, or nothing for an automatic key
 */
export function pinOf(settings) {
  if (settings === null || typeof settings !== "object") return undefined;
  const pin = /** @type {Record<string, unknown>} */ (settings).pin;
  return typeof pin === "string" && pin.startsWith("/") ? pin : undefined;
}

/**
 * The projects offered for a key, in a stable order: those running now, plus
 * the key's own pin when its project is not running.
 *
 * @param {ReadonlyArray<string | undefined>} runningProjects one entry per running session
 * @param {string} [pin] what the key is pinned to now
 * @returns {Project[]}
 */
export function listProjects(runningProjects, pin) {
  const running = new Set(runningProjects.filter((project) => project !== undefined));
  const ids = new Set(running);
  if (pin !== undefined) ids.add(pin);
  return [...ids]
    .map((id) => ({ id, label: folderLabel(id), running: running.has(id) }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
}

/**
 * What holding a key switches it to: the next running project that no other
 * key is pinned to, and after the last one back to automatic.
 *
 * @param {ReadonlyArray<Project>} projects as returned by `listProjects`
 * @param {string | undefined} pin what the key is pinned to now
 * @param {ReadonlySet<string>} pinnedElsewhere pins of the other keys of this kind
 * @returns {string | undefined} the new pin, or nothing for automatic
 */
export function nextPin(projects, pin, pinnedElsewhere) {
  const choices = projects.filter((project) => project.running && !pinnedElsewhere.has(project.id)).map((project) => project.id);
  /** @type {Array<string | undefined>} */
  const cycle = [undefined, ...choices];
  const position = cycle.indexOf(pin);
  // A pin that is no longer on offer restarts the cycle at the first project.
  if (position === -1) return choices[0];
  return cycle[(position + 1) % cycle.length];
}
