// @ts-check
import { sessionKey } from "../core/parse-agents.js";
import { classifyClient } from "../core/parse-ps.js";
import { acknowledge, advance, baseState } from "../core/state.js";

/** @typedef {import("../core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../core/parse-ps.js").Client} Client */
/** @typedef {import("../core/parse-ps.js").ProcessEntry} ProcessEntry */
/** @typedef {import("../core/state.js").Memo} Memo */

/**
 * @typedef {object} TrackedSession
 * @property {string} key
 * @property {SessionInfo} info
 * @property {Client} client
 * @property {Memo} memo
 * @property {number} missed listings in a row that left this session out
 */

/**
 * @typedef {object} MonitorDeps
 * @property {() => Promise<SessionInfo[] | null>} listSessions `null` when listing failed
 * @property {() => Promise<Map<number, ProcessEntry>>} readProcessTable
 * @property {(pid: number) => boolean} isAlive
 * @property {(onChange: () => void) => { close(): void }} watch signals that sessions may have changed
 * @property {() => number} now
 * @property {(info: SessionInfo, table: Map<number, ProcessEntry>) => Client} [classify] which app a session belongs to; by default judged from its parent processes
 * @property {{ activeMs: number, idleMs: number }} [poll] how often to list when nothing signals a change
 */

/**
 * @param {SessionInfo} info
 * @param {Map<number, ProcessEntry>} table
 * @returns {Client}
 */
function byParentProcess(info, table) {
  return info.pid === undefined ? "other" : classifyClient(info.pid, table);
}

const DEBOUNCE_MS = 150;
// Changes are signalled, so these timers are only a net under a signal that
// went missing. They are slow on purpose: every listing starts Claude Code,
// which then looks up its sign-in in the Keychain.
const ACTIVE_POLL_MS = 30_000;
const IDLE_POLL_MS = 60_000;
const RECHECK_MS = 1_000;
const LIVENESS_MS = 5_000;
/** A session younger than this may be a short-lived helper process. */
const MIN_AGE_MS = 2_000;
/** Failed listings in a row before the keys admit they have no data. */
const UNHEALTHY_AFTER = 3;
const MAX_BACKOFF_MS = 60_000;

/**
 * Keeps an up-to-date picture of the running Claude Code sessions. Listing
 * them is the only source of truth; file events, timers and wake-ups only
 * decide when to list again.
 */
export class SessionMonitor {
  #deps;
  /** @type {Map<string, TrackedSession>} */
  #sessions = new Map();
  /** @type {Set<() => void>} */
  #listeners = new Set();
  #failures = 0;
  #running = false;
  #recheck = false;
  /** @type {Promise<void> | undefined} */
  #inFlight;
  #ticking = false;
  #again = false;
  /** @type {{ close(): void } | undefined} */
  #watcher;
  /** @type {NodeJS.Timeout | undefined} */
  #debounce;
  /** @type {NodeJS.Timeout | undefined} */
  #poll;
  /** @type {NodeJS.Timeout | undefined} */
  #liveness;

  /** @param {MonitorDeps} deps */
  constructor(deps) {
    this.#deps = deps;
  }

  /** @returns {TrackedSession[]} */
  get sessions() {
    return [...this.#sessions.values()];
  }

  /** @returns {boolean} `false` once listing has failed several times in a row */
  get healthy() {
    return this.#failures < UNHEALTHY_AFTER;
  }

  /** @param {() => void} listener */
  onChange(listener) {
    this.#listeners.add(listener);
  }

  start() {
    if (this.#running) return;
    this.#running = true;
    this.#watcher = this.#deps.watch(() => this.requestRefresh());
    this.#liveness = setInterval(() => this.#checkLiveness(), LIVENESS_MS);
    this.#liveness.unref(); // the link to Stream Deck keeps the process alive, not this
    this.requestRefresh(0);
  }

  stop() {
    this.#running = false;
    this.#watcher?.close();
    this.#watcher = undefined;
    clearTimeout(this.#debounce);
    clearTimeout(this.#poll);
    clearInterval(this.#liveness);
  }

  /**
   * Lists sessions again soon. Calls in quick succession fold into one.
   * @param {number} [delayMs]
   */
  requestRefresh(delayMs = DEBOUNCE_MS) {
    if (!this.#running) return;
    clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.#tick(), delayMs);
  }

  /**
   * The user looked at a session; it no longer needs to stand out as done.
   * @param {string} key
   */
  acknowledge(key) {
    const session = this.#sessions.get(key);
    if (session === undefined) return;
    const memo = acknowledge(session.memo);
    if (memo === session.memo) return;
    this.#sessions.set(key, { ...session, memo });
    this.#emit();
  }

  /**
   * Lists sessions once. A call made while one is running waits for that one.
   * @returns {Promise<void>}
   */
  refreshNow() {
    this.#inFlight ??= this.#refresh().finally(() => {
      this.#inFlight = undefined;
    });
    return this.#inFlight;
  }

  async #tick() {
    if (this.#ticking) {
      this.#again = true; // something changed mid-listing: list once more after it
      return;
    }
    this.#ticking = true;
    try {
      do {
        this.#again = false;
        await this.refreshNow();
      } while (this.#again && this.#running);
    } catch {
      this.#failures += 1; // never let one bad round end the polling
    } finally {
      this.#ticking = false;
    }
    if (!this.#running) return;
    clearTimeout(this.#poll);
    this.#poll = setTimeout(() => void this.#tick(), this.#nextPollDelay());
  }

  /** @returns {number} */
  #nextPollDelay() {
    if (this.#failures > 0) return Math.min(MAX_BACKOFF_MS, 2_000 * 2 ** (this.#failures - 1));
    if (this.#recheck) return RECHECK_MS;
    const active = this.sessions.some((session) => session.memo.base === "working" || session.memo.base === "waiting");
    const { activeMs = ACTIVE_POLL_MS, idleMs = IDLE_POLL_MS } = this.#deps.poll ?? {};
    return active ? activeMs : idleMs;
  }

  async #refresh() {
    const wasHealthy = this.healthy;
    const listed = await this.#deps.listSessions();
    if (listed === null) {
      this.#failures += 1;
      if (wasHealthy !== this.healthy) this.#emit();
      return;
    }
    this.#failures = 0;
    this.#recheck = false;

    const now = this.#deps.now();
    const needsOwner = listed.some((info) => {
      const key = sessionKey(info);
      const known = key === undefined ? undefined : this.#sessions.get(key);
      return info.pid !== undefined && (known === undefined || known.client === "other");
    });
    const table = needsOwner ? await this.#deps.readProcessTable() : new Map();

    /** @type {Map<string, TrackedSession>} */
    const next = new Map();
    for (const info of listed) {
      const key = sessionKey(info);
      if (key === undefined) continue;
      const known = this.#sessions.get(key);
      const age = info.startedAt === undefined ? Infinity : now - info.startedAt;
      // A negative age is a clock running ahead (a container's can), not a new process.
      if (known === undefined && age >= 0 && age < MIN_AGE_MS) {
        this.#recheck = true; // too young to tell a session from a helper process
        continue;
      }
      const classify = this.#deps.classify ?? byParentProcess;
      const client = known !== undefined && known.client !== "other" ? known.client : classify(info, table);
      next.set(key, { key, info, client, memo: advance(known?.memo, baseState(info), now, info.startedAt), missed: 0 });
    }

    // A listing can leave out a live session for a moment; keep it for one round.
    for (const [key, known] of this.#sessions) {
      if (next.has(key) || known.missed > 0 || known.info.pid === undefined) continue;
      if (!this.#deps.isAlive(known.info.pid)) continue;
      next.set(key, { ...known, missed: known.missed + 1 });
      this.#recheck = true;
    }

    this.#sessions = next;
    this.#emit();
  }

  #checkLiveness() {
    for (const session of this.#sessions.values()) {
      if (session.info.pid !== undefined && !this.#deps.isAlive(session.info.pid)) {
        this.requestRefresh();
        return;
      }
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}
