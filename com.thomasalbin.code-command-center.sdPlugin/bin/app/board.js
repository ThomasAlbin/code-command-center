// @ts-check
import { focusTarget } from "../core/focus.js";
import { folderLabel, formatElapsed, reasonWord } from "../core/format.js";
import { projectOf } from "../core/parse-agents.js";
import { listProjects, nextPin, pinOf } from "../core/pins.js";
import { renderEmptyKey, renderPinnedEmptyKey, renderSessionKey, svgToDataUri } from "../core/render.js";
import { assignSlots } from "../core/slots.js";
import { displayState, elapsed, overdue, priority } from "../core/state.js";

/** @typedef {import("../core/focus.js").FocusTarget} FocusTarget */
/** @typedef {import("../core/pins.js").Project} Project */
/** @typedef {import("../core/state.js").DisplayState} DisplayState */
/** @typedef {import("./session-monitor.js").TrackedSession} TrackedSession */

/** @typedef {"desktop" | "vscode"} Group */

/**
 * The part of a Stream Deck key the board uses.
 * @typedef {object} Key
 * @property {string} id
 * @property {{ column: number, row: number } | undefined} coordinates
 * @property {{ id: string }} device
 * @property {(image?: string) => Promise<void>} setImage
 */

/**
 * @typedef {object} Placed
 * @property {Group} group
 * @property {Key} key
 * @property {string} slot where the key sits; stays the same when the page is left and shown again
 * @property {string} [pin] project the user reserved this key for; without one the key is automatic
 * @property {string} [session] the session the key shows now
 * @property {string} [image] what the key shows now
 */

/**
 * @typedef {object} BoardMonitor
 * @property {TrackedSession[]} sessions
 * @property {boolean} healthy
 * @property {(listener: () => void) => void} onChange
 * @property {(visible: { desktop: number, vscode: number }) => void} watch
 * @property {(key: string) => void} acknowledge
 */

/**
 * @typedef {object} BoardDeps
 * @property {BoardMonitor} monitor
 * @property {(target: FocusTarget) => Promise<void>} bringToFront
 * @property {() => number} now
 * @property {import("../core/render.js").Logos} [logos] the logo each app's keys carry; the plugin's own marks by default
 */

/** @typedef {{ session: TrackedSession, state: DisplayState }} Shown */

/** @type {Group[]} */
const GROUPS = ["desktop", "vscode"];
const CAPTIONS = { desktop: "Claude", vscode: "VS Code" };
/** Keys are also redrawn on a timer, so "done" can fade without any event. */
const REDRAW_MS = 60_000;
/** More often while a key shows how long its session has been at it, so the minutes do not lag. */
const CLOCK_MS = 5_000;
/** How long each half of the pulse of a key that has waited too long lasts. */
const PULSE_MS = 1_000;
/**
 * The keys of a page appear one event at a time. Sessions are handed out once
 * they have all arrived, so the layout does not depend on the order of events.
 */
const SETTLE_MS = 40;

/** Decides what every visible session key shows and what a press does. */
export class Board {
  #deps;
  /** @type {Map<string, Placed>} */
  #keys = new Map();
  /** @type {Record<Group, Map<string, string>>} slot → session key, for automatic keys */
  #assignments = { desktop: new Map(), vscode: new Map() };
  /** @type {NodeJS.Timeout | undefined} */
  #redraw;
  /** @type {NodeJS.Timeout | undefined} */
  #settle;

  /** @param {BoardDeps} deps */
  constructor(deps) {
    this.#deps = deps;
    deps.monitor.onChange(() => {
      // While a page is still arriving, the pending render covers this change too.
      if (this.#settle === undefined) this.render();
    });
  }

  /**
   * @param {Group} group
   * @param {Key} key
   * @param {unknown} [settings] what Stream Deck stored for this key
   */
  keyAppeared(group, key, settings) {
    const { coordinates } = key;
    // A key inside a multi-action has no coordinates; its id has to do.
    const slot = coordinates === undefined ? key.id : `${key.device.id}:${coordinates.row}:${coordinates.column}`;
    this.#keys.set(key.id, { group, key, slot, pin: pinOf(settings) });
    this.#watch();
    clearTimeout(this.#settle);
    this.#settle = setTimeout(() => this.render(), SETTLE_MS);
    this.#settle.unref(); // the link to Stream Deck keeps the process alive, not this
  }

  /** @param {string} id */
  keyDisappeared(id) {
    if (!this.#keys.delete(id)) return;
    if (this.#keys.size === 0) clearTimeout(this.#redraw);
    this.#watch();
  }

  /**
   * The user chose a project, or automatic, in the key's settings.
   * @param {string} id
   * @param {unknown} settings
   */
  settingsChanged(id, settings) {
    const placed = this.#keys.get(id);
    if (placed === undefined) return;
    placed.pin = pinOf(settings);
    this.render();
  }

  /**
   * A short press: bring the session's window forward.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async keyPressed(id) {
    const placed = this.#keys.get(id);
    if (placed === undefined) return;
    const session = this.#deps.monitor.sessions.find((candidate) => candidate.key === placed.session);
    if (session !== undefined) this.#deps.monitor.acknowledge(session.key);
    // A key without a session still brings its app, or its reserved project, forward.
    const target = focusTarget(placed.group, session?.info, placed.pin);
    if (target !== undefined) await this.#deps.bringToFront(target);
  }

  /**
   * A long press: reserve the key for the next project, or make it automatic again.
   * @param {string} id
   * @returns {{ pin: string | undefined } | undefined} the choice to store, or nothing for an unknown key
   */
  keyHeld(id) {
    const placed = this.#keys.get(id);
    if (placed === undefined) return undefined;
    const elsewhere = new Set();
    for (const other of this.#keys.values()) {
      if (other !== placed && other.group === placed.group && other.pin !== undefined) elsewhere.add(other.pin);
    }
    placed.pin = nextPin(this.#projects(placed), placed.pin, elsewhere);
    this.render();
    return { pin: placed.pin };
  }

  /**
   * What the key's settings panel offers.
   * @param {string} id
   * @returns {{ projects: Project[], pin: string }} `pin` is empty for an automatic key
   */
  choices(id) {
    const placed = this.#keys.get(id);
    if (placed === undefined) return { projects: [], pin: "" };
    return { projects: this.#projects(placed), pin: placed.pin ?? "" };
  }

  render() {
    clearTimeout(this.#settle);
    this.#settle = undefined;
    const now = this.#deps.now();
    const { sessions, healthy } = this.#deps.monitor;
    let redrawIn = REDRAW_MS;

    for (const group of GROUPS) {
      const placed = [...this.#keys.values()].filter((entry) => entry.group === group).sort(readingOrder);
      if (placed.length === 0) continue;

      /** @type {Shown[]} */
      const mine = sessions
        .filter((session) => session.client === group)
        .map((session) => ({ session, state: displayState(session.memo, now) }));

      // Reserved keys go first: each takes the best session of its project.
      const taken = new Set();
      for (const entry of placed) {
        entry.session = undefined;
        if (entry.pin === undefined) continue;
        const [best] = mine
          .filter(({ session }) => !taken.has(session.key) && projectOf(session.info) === entry.pin)
          .sort(bestFirst);
        if (best === undefined) continue;
        taken.add(best.session.key);
        entry.session = best.session.key;
      }

      // Automatic keys share what is left.
      const automatic = placed.filter((entry) => entry.pin === undefined);
      const candidates = mine
        .filter(({ session }) => !taken.has(session.key))
        .map(({ session, state }) => ({ key: session.key, priority: priority(state), recency: session.memo.lastChange }));
      const { assignment, overflow } = assignSlots(
        this.#assignments[group],
        candidates,
        automatic.map((entry) => entry.slot),
      );
      this.#assignments[group] = assignment;
      for (const entry of automatic) entry.session = assignment.get(entry.slot);

      const byKey = new Map(mine.map((shown) => [shown.session.key, shown]));
      const last = automatic[automatic.length - 1];
      for (const entry of placed) {
        const assigned = entry.session === undefined ? undefined : byKey.get(entry.session);
        // While sessions on this Mac cannot be listed, the ones last seen here
        // may be long gone. Those in Dev Containers are listed on their own.
        const current = assigned !== undefined && (healthy || assigned.session.info.container !== undefined);
        const shown = current ? assigned : undefined;
        if (shown !== undefined) {
          const { memo } = shown.session;
          if (overdue(memo, now)) redrawIn = PULSE_MS;
          else if (elapsed(memo, now) !== undefined) redrawIn = Math.min(redrawIn, CLOCK_MS);
        }
        this.#show(entry, image(entry, healthy, shown, entry === last ? overflow : 0, now, this.#deps.logos));
      }
    }

    clearTimeout(this.#redraw);
    if (this.#keys.size === 0) return;
    // Aimed just past the next multiple of the interval, so no half of a pulse is skipped.
    this.#redraw = setTimeout(() => this.render(), redrawIn - (now % redrawIn) + 10);
    this.#redraw.unref();
  }

  /**
   * @param {Placed} placed
   * @returns {Project[]} projects this key could be reserved for
   */
  #projects(placed) {
    const running = this.#deps.monitor.sessions
      .filter((session) => session.client === placed.group)
      .map((session) => projectOf(session.info));
    return listProjects(running, placed.pin);
  }

  #watch() {
    const visible = { desktop: 0, vscode: 0 };
    for (const placed of this.#keys.values()) visible[placed.group] += 1;
    this.#deps.monitor.watch(visible);
  }

  /**
   * @param {Placed} placed
   * @param {string} svg
   */
  #show(placed, svg) {
    if (placed.image === svg) return;
    placed.image = svg;
    placed.key.setImage(svgToDataUri(svg)).catch(() => {
      placed.image = undefined; // not delivered: send it again next time
    });
  }
}

/**
 * @param {Placed} placed
 * @param {boolean} healthy whether sessions on this Mac can be listed; without that, a key cannot say that it has none
 * @param {Shown | undefined} shown the key's session, if what is known of it is current
 * @param {number} overflow
 * @param {number} now
 * @param {import("../core/render.js").Logos} [logos]
 * @returns {string} SVG
 */
function image(placed, healthy, shown, overflow, now, logos) {
  const pinned = placed.pin !== undefined;
  const app = placed.group;
  if (shown !== undefined) {
    const { info, memo } = shown.session;
    const since = elapsed(memo, now);
    const urgent = overdue(memo, now);
    return renderSessionKey(
      {
        app,
        state: shown.state,
        label: folderLabel(projectOf(info)),
        overflow,
        pinned,
        time: since === undefined ? "" : formatElapsed(since),
        reason: shown.state === "waiting" ? reasonWord(info.waitingFor) : "",
        urgent,
        lit: urgent && Math.floor(now / PULSE_MS) % 2 === 1,
      },
      logos,
    );
  }
  if (!healthy) return renderSessionKey({ app, state: "unknown", label: "", pinned }, logos);
  if (placed.pin !== undefined) return renderPinnedEmptyKey(folderLabel(placed.pin), app, logos);
  return renderEmptyKey(CAPTIONS[app], app, logos);
}

/**
 * @param {Shown} a
 * @param {Shown} b
 * @returns {number}
 */
function bestFirst(a, b) {
  return priority(b.state) - priority(a.state) || b.session.memo.lastChange - a.session.memo.lastChange;
}

/**
 * @param {Placed} a
 * @param {Placed} b
 * @returns {number}
 */
function readingOrder(a, b) {
  const [first, second] = [a.key.coordinates, b.key.coordinates];
  if (first === undefined || second === undefined) return Number(first === undefined) - Number(second === undefined);
  return (
    a.key.device.id.localeCompare(b.key.device.id) || first.row - second.row || first.column - second.column
  );
}
