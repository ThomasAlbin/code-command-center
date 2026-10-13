// @ts-check

/**
 * @typedef {object} ProcessEntry
 * @property {number} ppid
 * @property {string} comm executable path
 */

/** @typedef {"desktop" | "vscode" | "other"} Client */

/** How far up the parent chain to look for the app that owns a session. */
const MAX_DEPTH = 12;

/**
 * @param {string} stdout output of `ps -axo pid=,ppid=,comm=`
 * @returns {Map<number, ProcessEntry>}
 */
export function parsePs(stdout) {
  /** @type {Map<number, ProcessEntry>} */
  const table = new Map();
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match === null) continue;
    table.set(Number(match[1]), { ppid: Number(match[2]), comm: match[3] });
  }
  return table;
}

/**
 * Which app started a session, judged by its parent processes.
 *
 * @param {number} pid
 * @param {ReadonlyMap<number, ProcessEntry>} table
 * @returns {Client}
 */
export function classifyClient(pid, table) {
  let current = table.get(pid)?.ppid;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current > 1; depth++) {
    const entry = table.get(current);
    if (entry === undefined) break;
    if (entry.comm.includes("/Claude.app/")) return "desktop";
    if (entry.comm.includes("/Visual Studio Code.app/")) return "vscode";
    current = entry.ppid;
  }
  return "other";
}
