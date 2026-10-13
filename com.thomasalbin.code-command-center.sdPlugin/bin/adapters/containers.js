// @ts-check
import { parseAgents } from "../core/parse-agents.js";
import { findClaudeBinary, parseDevContainers, usageFileIn, userOf } from "../core/parse-docker.js";
import { parseReading } from "../core/usage.js";
import { dockerClaudeAgentsJson, dockerDevContainers, dockerProcesses, dockerReadUsage } from "./exec.js";

/** @typedef {import("../core/parse-agents.js").ContainerRef} ContainerRef */
/** @typedef {import("../core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../core/usage.js").Reading} Reading */

/** How long the list of containers, and "no Claude Code in this one", is trusted. */
const RESCAN_MS = 10_000;
/** A listing this fresh is used again for reading usage, instead of asking every container twice. */
const LISTING_FRESH_MS = 5_000;
/** A session that had no reading is asked again only after this long: most containers have no mod. */
const NO_READING_MS = 60_000;

/**
 * @typedef {object} DockerCalls
 * @property {() => Promise<string>} devContainers
 * @property {(containerId: string) => Promise<string>} processes
 * @property {(containerId: string, binary: string, user?: string) => Promise<string>} claudeAgentsJson
 * @property {(containerId: string, file: string, user?: string) => Promise<string>} readUsage
 */

/** @type {DockerCalls} */
const DOCKER = {
  devContainers: dockerDevContainers,
  processes: dockerProcesses,
  claudeAgentsJson: dockerClaudeAgentsJson,
  readUsage: dockerReadUsage,
};

/**
 * Asks the Claude Code inside each running Dev Container which sessions it
 * has. A session in a container is invisible from the Mac otherwise.
 */
export class DevContainers {
  #docker;
  #now;
  /** @type {ContainerRef[]} */
  #containers = [];
  #scannedAt = -Infinity;
  /**
   * @type {Map<string, { binary: string | undefined, user: string | undefined, checkedAt: number }>}
   * container id → Claude Code in it, and the user it last answered as
   */
  #binaries = new Map();
  /** @type {{ at: number, sessions: SessionInfo[] }} the last listing */
  #listed = { at: -Infinity, sessions: [] };
  /** @type {Map<string, number>} session → when it last turned out to have no reading */
  #withoutReading = new Map();

  /**
   * @param {() => number} now
   * @param {DockerCalls} [docker]
   */
  constructor(now, docker = DOCKER) {
    this.#now = now;
    this.#docker = docker;
  }

  /**
   * @returns {Promise<SessionInfo[]>} empty when Docker is not installed or not running
   */
  async listSessions() {
    const now = this.#now();
    if (now - this.#scannedAt >= RESCAN_MS) {
      this.#scannedAt = now;
      try {
        this.#containers = parseDevContainers(await this.#docker.devContainers());
      } catch {
        this.#containers = [];
      }
      const running = new Set(this.#containers.map((container) => container.id));
      for (const id of this.#binaries.keys()) if (!running.has(id)) this.#binaries.delete(id);
    }
    const lists = await Promise.all(this.#containers.map((container) => this.#sessionsIn(container, now)));
    this.#listed = { at: now, sessions: lists.flat() };
    return this.#listed.sessions;
  }

  /**
   * Reads what the `deck-bridge` mod wrote for each session that runs in a
   * Dev Container. A container without the mod simply has no such file.
   *
   * @returns {Promise<Map<string, Reading>>} `<container id>:<session id>` → its reading
   */
  async readReadings() {
    const now = this.#now();
    const sessions = now - this.#listed.at < LISTING_FRESH_MS ? this.#listed.sessions : await this.listSessions();
    /** @type {Map<string, Reading>} */
    const readings = new Map();
    /** @type {Set<string>} */
    const present = new Set();
    await Promise.all(
      sessions.map(async ({ container, sessionId }) => {
        if (container === undefined) return;
        const known = this.#binaries.get(container.id);
        const file = known?.binary === undefined ? undefined : usageFileIn(known.binary, sessionId);
        if (file === undefined) return;
        const key = `${container.id}:${sessionId}`;
        present.add(key);
        if (now - (this.#withoutReading.get(key) ?? -Infinity) < NO_READING_MS) return;
        try {
          const reading = parseReading(await this.#docker.readUsage(container.id, file, known?.user));
          if (reading !== null) {
            readings.set(key, reading);
            this.#withoutReading.delete(key);
            return;
          }
        } catch {
          // No mod in this container, or no turn taken there yet.
        }
        this.#withoutReading.set(key, now);
      }),
    );
    for (const key of this.#withoutReading.keys()) if (!present.has(key)) this.#withoutReading.delete(key);
    return readings;
  }

  /**
   * @param {ContainerRef} container
   * @param {number} now
   * @returns {Promise<SessionInfo[]>}
   */
  async #sessionsIn(container, now) {
    let known = this.#binaries.get(container.id);
    if (known === undefined || (known.binary === undefined && now - known.checkedAt >= RESCAN_MS)) {
      known = { binary: await this.#findBinary(container.id), user: undefined, checkedAt: now };
      this.#binaries.set(container.id, known);
    }
    if (known.binary === undefined) return [];
    // Claude Code keeps each user's sessions apart, and VS Code often runs as
    // another user than the container's own. So it is asked as the user whose
    // home folder holds it, and as the container's own user only if that fails.
    const owner = userOf(known.binary);
    for (const user of owner === undefined ? [undefined] : [owner, undefined]) {
      try {
        const sessions = parseAgents(await this.#docker.claudeAgentsJson(container.id, known.binary, user));
        if (sessions !== null) {
          known.user = user;
          return sessions.map((session) => ({ ...session, container }));
        }
      } catch {
        // No user of that name here, or the extension has updated and moved its executable.
      }
    }
    this.#binaries.delete(container.id);
    return [];
  }

  /**
   * @param {string} containerId
   * @returns {Promise<string | undefined>}
   */
  async #findBinary(containerId) {
    try {
      return findClaudeBinary(await this.#docker.processes(containerId));
    } catch {
      return undefined;
    }
  }
}
