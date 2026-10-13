// @ts-check
import { accessSync, constants, readdirSync } from "node:fs";
import path from "node:path";
import { parseAgents } from "../core/parse-agents.js";
import { compareVersions, parseVersion } from "../core/version.js";
import { claudeAgentsJson } from "./exec.js";

/** @typedef {import("../core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../core/parse-ps.js").ProcessEntry} ProcessEntry */

/** The choice of executable is reviewed this often, since apps update while the plugin runs. */
const RECHOOSE_MS = 10 * 60 * 1000;

/**
 * @typedef {object} Binary
 * @property {string} file
 * @property {number[]} version
 */

/**
 * Finds the Claude Code executables that ship inside the Claude desktop app
 * and the VS Code extension, newest first. Their paths contain the version,
 * so they change with every update.
 *
 * @param {string} home
 * @returns {Binary[]}
 */
export function findBinaries(home) {
  /** @type {Binary[]} */
  const found = [];

  const desktopRoot = path.join(home, "Library", "Application Support", "Claude", "claude-code");
  for (const versionDirectory of list(desktopRoot)) {
    const version = parseVersion(versionDirectory);
    if (version === undefined) continue;
    for (const build of list(path.join(desktopRoot, versionDirectory))) {
      const file = path.join(desktopRoot, versionDirectory, build, "claude.app", "Contents", "MacOS", "claude");
      found.push({ version, file });
    }
  }

  const extensionsRoot = path.join(home, ".vscode", "extensions");
  for (const extension of list(extensionsRoot)) {
    const match = /^anthropic\.claude-code-(\d+\.\d+\.\d+)-/.exec(extension);
    const version = match === null ? undefined : parseVersion(match[1]);
    if (version === undefined) continue;
    found.push({ version, file: path.join(extensionsRoot, extension, "resources", "native-binary", "claude") });
  }

  return found.filter((binary) => isExecutable(binary.file)).sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * Puts the executables that some session is running right now first. Such a
 * copy is already in memory and answers several times faster than one that
 * has to be loaded from disk, and a copy that has never run can take seconds.
 *
 * @param {ReadonlyArray<Binary>} binaries newest first
 * @param {ReadonlySet<string>} running executables of the processes on this Mac
 * @returns {Binary[]}
 */
export function preferRunning(binaries, running) {
  return [...binaries.filter((binary) => running.has(binary.file)), ...binaries.filter((binary) => !running.has(binary.file))];
}

/** Asks Claude Code which sessions are running. */
export class ClaudeCli {
  #home;
  #readProcessTable;
  #now;
  /** @type {Binary | undefined} */
  #binary;
  #chosenAt = 0;
  #installed = true;

  /**
   * @param {string} home
   * @param {() => Promise<Map<number, ProcessEntry>>} readProcessTable
   * @param {() => number} [now]
   */
  constructor(home, readProcessTable, now = Date.now) {
    this.#home = home;
    this.#readProcessTable = readProcessTable;
    this.#now = now;
  }

  /** @returns {string | undefined} version of the Claude Code executable in use */
  get version() {
    return this.#binary?.version.join(".");
  }

  /** @returns {boolean} whether the last look found Claude Code on this Mac at all */
  get installed() {
    return this.#installed;
  }

  /**
   * @returns {Promise<SessionInfo[] | null>} `null` when Claude Code is here but no copy of it could list sessions
   */
  async listSessions() {
    if (this.#binary !== undefined && this.#now() - this.#chosenAt < RECHOOSE_MS) {
      const sessions = await query(this.#binary);
      if (sessions !== null) return sessions;
      // Moved by an update, or broken: choose again.
    }
    const binaries = findBinaries(this.#home);
    this.#installed = binaries.length > 0;
    if (!this.#installed) {
      // No Claude Code on this Mac means no sessions on it, which is not a
      // fault: someone who works in Dev Containers only has none here.
      this.#binary = undefined;
      return [];
    }
    const running = new Set([...(await this.#readProcessTable()).values()].map((entry) => entry.comm));
    for (const binary of preferRunning(binaries, running)) {
      const sessions = await query(binary);
      if (sessions !== null) {
        this.#binary = binary;
        this.#chosenAt = this.#now();
        return sessions;
      }
    }
    this.#binary = undefined;
    return null;
  }
}

/**
 * @param {Binary} binary
 * @returns {Promise<SessionInfo[] | null>}
 */
async function query(binary) {
  try {
    return parseAgents(await claudeAgentsJson(binary.file));
  } catch {
    return null;
  }
}

/**
 * @param {string} directory
 * @returns {string[]} entry names; empty when the directory cannot be read
 */
function list(directory) {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isExecutable(file) {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
