// @ts-check
import { parsePs } from "../core/parse-ps.js";
import { processTable } from "./exec.js";

/** @typedef {import("../core/parse-ps.js").ProcessEntry} ProcessEntry */

/**
 * @returns {Promise<Map<number, ProcessEntry>>} empty when `ps` fails
 */
export async function readProcessTable() {
  try {
    return parsePs(await processTable());
  } catch {
    return new Map();
  }
}

/**
 * @param {number} pid
 * @returns {boolean}
 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 checks for existence without signalling
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
  }
}
