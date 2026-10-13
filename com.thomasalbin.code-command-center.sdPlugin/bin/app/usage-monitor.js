// @ts-check
import { paceOf } from "../core/pace.js";
import { EXPIRED_AFTER_MS, viewLimit } from "../core/usage.js";

/** @typedef {import("../core/pace.js").Pace} Pace */
/** @typedef {import("../core/usage.js").LimitView} LimitView */
/** @typedef {import("../core/usage.js").Reading} Reading */

/**
 * @typedef {object} UsageDeps
 * @property {() => Map<string, Reading | null>} read file name → reading; `null` for a file that could not be read just now
 * @property {(onChange: () => void) => { close(): void }} watch signals that a reading was written
 * @property {() => void} prepare makes sure the folder to watch exists
 * @property {() => number} now
 * @property {() => Promise<Map<string, Reading>>} [readElsewhere] readings that are not files on this Mac: those of sessions in Dev Containers
 */

const DEBOUNCE_MS = 200;
/** The countdown on a key changes by the minute even when nothing is written. */
const TICK_MS = 30_000;
/** More past readings than a week of work leaves behind. */
const MAX_PAST = 5_000;
/** How often readings are fetched from elsewhere. Nothing signals when one is written there. */
const ELSEWHERE_MS = 20_000;

/** Keeps the latest plan usage that Claude Code sessions reported. */
export class UsageMonitor {
  #deps;
  /** @type {Map<string, Reading>} */
  #readings = new Map();
  /** @type {Map<string, Reading>} readings fetched from elsewhere, by where they came from */
  #elsewhere = new Map();
  /** @type {Promise<void> | undefined} a fetch from elsewhere that is still running */
  #fetching;
  /** @type {NodeJS.Timeout | undefined} */
  #fetchTimer;
  /**
   * Every reading seen while the plugin runs, by the time it was written. A
   * session's file only holds its latest one, and pace needs the earlier ones.
   * @type {Map<number, Reading>}
   */
  #past = new Map();
  /** @type {Set<() => void>} */
  #listeners = new Set();
  #users = 0;
  /** @type {{ close(): void } | undefined} */
  #watcher;
  /** @type {NodeJS.Timeout | undefined} */
  #debounce;
  /** @type {NodeJS.Timeout | undefined} */
  #tick;

  /** @param {UsageDeps} deps */
  constructor(deps) {
    this.#deps = deps;
  }

  /** @param {() => void} listener */
  onChange(listener) {
    this.#listeners.add(listener);
  }

  /**
   * @param {string} kind `five_hour` or `seven_day`
   * @returns {LimitView}
   */
  view(kind) {
    return viewLimit([...this.#readings.values(), ...this.#elsewhere.values()], kind, this.#deps.now());
  }

  /**
   * @param {string} kind `five_hour` or `seven_day`
   * @returns {Pace | undefined}
   */
  pace(kind) {
    return paceOf([...this.#past.values()], kind, this.#deps.now());
  }

  /** A quota key became visible. The first one starts the watching. */
  acquire() {
    this.#users += 1;
    if (this.#users > 1) return;
    try {
      this.#deps.prepare();
    } catch {
      // Without the folder there is simply no data.
    }
    this.#watcher = this.#deps.watch(() => {
      clearTimeout(this.#debounce);
      this.#debounce = setTimeout(() => this.refresh(), DEBOUNCE_MS);
    });
    this.#tick = setInterval(() => this.#emit(), TICK_MS);
    this.#tick.unref(); // the link to Stream Deck keeps the process alive, not this
    if (this.#deps.readElsewhere !== undefined) {
      this.#fetchTimer = setInterval(() => void this.fetchElsewhere(), ELSEWHERE_MS);
      this.#fetchTimer.unref();
    }
    this.refresh();
    void this.fetchElsewhere();
  }

  /** A quota key disappeared. The last one stops the watching. */
  release() {
    this.#users = Math.max(0, this.#users - 1);
    if (this.#users > 0) return;
    this.#watcher?.close();
    this.#watcher = undefined;
    clearTimeout(this.#debounce);
    clearInterval(this.#tick);
    clearInterval(this.#fetchTimer);
  }

  /**
   * Fetches the readings that are kept elsewhere and tells the keys if they
   * changed. A call made while one is running waits for that one.
   *
   * @returns {Promise<void>}
   */
  fetchElsewhere() {
    const { readElsewhere } = this.#deps;
    if (readElsewhere === undefined || this.#users === 0) return Promise.resolve();
    this.#fetching ??= readElsewhere()
      .then((found) => {
        const before = [...this.#elsewhere].map(([name, reading]) => `${name}@${reading.writtenAt}`).join();
        const after = [...found].map(([name, reading]) => `${name}@${reading.writtenAt}`).join();
        this.#elsewhere = found;
        this.#remember(found.values());
        if (after !== before) this.#emit();
      })
      .catch(() => {
        // What was fetched before stays until the next try.
      })
      .finally(() => {
        this.#fetching = undefined;
      });
    return this.#fetching;
  }

  /** Reads the readings again and tells the keys. */
  refresh() {
    const read = this.#deps.read();
    /** @type {Map<string, Reading>} */
    const next = new Map();
    for (const [name, reading] of read) {
      // A file caught half written keeps its previous reading until it can be read again.
      const usable = reading ?? this.#readings.get(name);
      if (usable !== undefined) next.set(name, usable);
    }
    this.#readings = next;
    this.#remember(next.values());
    this.#emit();
  }

  /** @param {Iterable<Reading>} readings */
  #remember(readings) {
    for (const reading of readings) this.#past.set(reading.writtenAt, reading);
    const now = this.#deps.now();
    for (const writtenAt of this.#past.keys()) {
      if (now - writtenAt > EXPIRED_AFTER_MS) this.#past.delete(writtenAt);
    }
    if (this.#past.size > MAX_PAST) {
      const oldestFirst = [...this.#past.keys()].sort((a, b) => a - b);
      for (const writtenAt of oldestFirst.slice(0, this.#past.size - MAX_PAST)) this.#past.delete(writtenAt);
    }
  }

  #emit() {
    for (const listener of this.#listeners) listener();
  }
}
