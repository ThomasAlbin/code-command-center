// @ts-check
import { lstatSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { hostOf, isAntigravityCli, parseQuota, parseStatus, pidOfFile, sessionOf } from "../core/antigravity.js";

/** @typedef {import("../core/antigravity.js").AgyStatus} AgyStatus */
/** @typedef {import("../core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../core/parse-ps.js").ProcessEntry} ProcessEntry */
/** @typedef {import("../core/usage.js").Reading} Reading */

/** The file the bridge keeps the plan's limits in. */
export const QUOTA_FILE = "quota.json";

/** A file of the bridge is a few dozen bytes; anything much larger is not one. */
const MAX_BYTES = 64 * 1024;

/**
 * The sessions of the Antigravity CLI on this Mac, as the bridge in
 * `mod/antigravity-bridge/` reports them: one file per CLI process. A file
 * stays when its CLI quits, so this removes the file of a process that is gone.
 */
export class AntigravityCli {
  #directory;
  #readProcessTable;
  #isAlive;

  /**
   * @param {string} directory where the bridge writes
   * @param {() => Promise<Map<number, ProcessEntry>>} readProcessTable
   * @param {(pid: number) => boolean} isAlive
   */
  constructor(directory, readProcessTable, isAlive) {
    this.#directory = directory;
    this.#readProcessTable = readProcessTable;
    this.#isAlive = isAlive;
  }

  /**
   * @returns {Promise<SessionInfo[]>} empty when the bridge has written nothing, which is not a fault
   */
  async listSessions() {
    const found = this.#read();
    if (found.size === 0) return [];
    // One look at the processes: is each one still the CLI, and in which app's terminal does it run?
    const table = await this.#readProcessTable();
    /** @type {SessionInfo[]} */
    const sessions = [];
    for (const [pid, status] of found) {
      const entry = table.get(pid);
      // A process id is used again once its process has ended. Without a table there is no telling, so the file stays.
      const ended = !this.#isAlive(pid) || (table.size > 0 && (entry === undefined || !isAntigravityCli(entry.comm)));
      if (ended) {
        this.#remove(pid);
      } else if (status !== null) {
        sessions.push(sessionOf(pid, status, hostOf(pid, table)));
      }
    }
    return sessions;
  }

  /**
   * @returns {Map<number, AgyStatus | null>} process id → what the bridge wrote; `null` for a file that is not one of the bridge's
   */
  #read() {
    /** @type {Map<number, AgyStatus | null>} */
    const found = new Map();
    let names;
    try {
      names = readdirSync(this.#directory);
    } catch {
      return found;
    }
    for (const name of names) {
      const pid = pidOfFile(name);
      if (pid === undefined) continue;
      try {
        const stats = lstatSync(path.join(this.#directory, name));
        if (!stats.isFile()) continue; // never follow a link out of this folder
        found.set(pid, stats.size > MAX_BYTES ? null : parseStatus(readFileSync(path.join(this.#directory, name), "utf8")));
      } catch {
        // Removed between listing the folder and reading it: its CLI has quit.
      }
    }
    return found;
  }

  /** @param {number} pid */
  #remove(pid) {
    const file = path.join(this.#directory, `${pid}.json`);
    try {
      if (lstatSync(file).isFile()) unlinkSync(file);
    } catch {
      // Already gone.
    }
  }
}

/**
 * Reads the plan's limits, as the bridge last wrote them. Every CLI writes
 * the same file, since the limits belong to the account.
 *
 * @param {string} directory where the bridge writes
 * @returns {Map<string, Reading | null>} the file's name → its reading, or `null` for a file that could not be read just now; empty without a file
 */
export function readQuota(directory) {
  const file = path.join(directory, QUOTA_FILE);
  try {
    const stats = lstatSync(file);
    if (!stats.isFile()) return new Map(); // never follow a link out of this folder
    return new Map([[QUOTA_FILE, stats.size > MAX_BYTES ? null : parseQuota(readFileSync(file, "utf8"), stats.mtimeMs)]]);
  } catch {
    return new Map();
  }
}
