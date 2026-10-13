// @ts-check
import { formatClock, formatCountdown, formatDayClock } from "./format.js";

/**
 * One plan limit as Claude Code reports it.
 * @typedef {object} Limit
 * @property {string} kind `five_hour` or `seven_day`
 * @property {number} percentUsed 0 to 100
 * @property {number} [resetsAt] Unix milliseconds
 */

/**
 * What one session last wrote about the plan limits.
 * @typedef {object} Reading
 * @property {number} writtenAt Unix milliseconds
 * @property {Limit[]} limits
 */

/**
 * What a quota key has to show for one limit.
 * @typedef {{ status: "none" }
 *   | { status: "reset" }
 *   | { status: "ok", percent: number, resetsInMs: number | undefined, writtenAt: number, stale: boolean }} LimitView
 */

/** A reading older than this is shown with the time it was taken. */
export const STALE_AFTER_MS = 60 * 60 * 1000;
/** A reading older than this says nothing about either limit any more. */
export const EXPIRED_AFTER_MS = 8 * 24 * 60 * 60 * 1000;
/** A time of day this close is clear without its day. */
const SAME_DAY_MS = 20 * 60 * 60 * 1000;

/**
 * Reads a file written by the `deck-bridge` mod. Tolerant of anything, since
 * the file may be half written or from another version.
 *
 * @param {string} text
 * @returns {Reading | null}
 */
export function parseReading(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object") return null;
  const record = /** @type {Record<string, unknown>} */ (data);
  if (typeof record.writtenAt !== "number" || !Number.isFinite(record.writtenAt) || !Array.isArray(record.limits)) {
    return null;
  }

  /** @type {Limit[]} */
  const limits = [];
  for (const item of record.limits) {
    if (item === null || typeof item !== "object") continue;
    const { kind, percentUsed, resetsAt } = /** @type {Record<string, unknown>} */ (item);
    if (typeof kind !== "string" || typeof percentUsed !== "number" || !Number.isFinite(percentUsed)) continue;
    limits.push({ kind, percentUsed: Math.min(100, Math.max(0, percentUsed)), resetsAt: asTimestamp(resetsAt) });
  }
  return { writtenAt: record.writtenAt, limits };
}

/**
 * Several sessions report the same account, so the newest report wins.
 *
 * @param {ReadonlyArray<Reading>} readings
 * @param {string} kind
 * @param {number} now
 * @returns {LimitView}
 */
export function viewLimit(readings, kind, now) {
  /** @type {{ limit: Limit, writtenAt: number } | undefined} */
  let newest;
  for (const reading of readings) {
    if (now - reading.writtenAt > EXPIRED_AFTER_MS) continue;
    const limit = reading.limits.find((candidate) => candidate.kind === kind);
    if (limit !== undefined && (newest === undefined || reading.writtenAt > newest.writtenAt)) {
      newest = { limit, writtenAt: reading.writtenAt };
    }
  }
  if (newest === undefined) return { status: "none" };

  const { limit, writtenAt } = newest;
  // Past its reset time the window is empty until the next message opens a new one.
  if (limit.resetsAt !== undefined && now >= limit.resetsAt) return { status: "reset" };
  return {
    status: "ok",
    percent: limit.percentUsed,
    resetsInMs: limit.resetsAt === undefined ? undefined : limit.resetsAt - now,
    writtenAt,
    stale: now - writtenAt > STALE_AFTER_MS,
  };
}

/**
 * @param {string} title which limit, such as `5h`
 * @param {LimitView} view
 * @param {import("./pace.js").Pace} [pace] how use compares with time, when that is known
 * @returns {import("./render.js").QuotaKeyView}
 */
export function describeLimit(title, view, pace) {
  if (view.status === "none") return { title, footer: "no data" };
  if (view.status === "reset") return { title, percent: 0, footer: "reset" };
  const shown = pace === undefined ? { title, percent: view.percent } : { title, percent: view.percent, even: pace.even };
  // An old reading may be out of date, so say when it was taken instead of counting down.
  if (view.stale) return { ...shown, footer: `as of ${formatClock(view.writtenAt)}` };
  if (pace?.fullAt !== undefined) {
    // Running out comes before the reset, so a reset later today needs no day.
    const today = view.resetsInMs !== undefined && view.resetsInMs < SAME_DAY_MS;
    return { ...shown, footer: `full ${today ? formatClock(pace.fullAt) : formatDayClock(pace.fullAt)}`, warn: true };
  }
  return { ...shown, footer: view.resetsInMs === undefined ? "" : formatCountdown(view.resetsInMs) };
}

/**
 * @param {unknown} value an ISO 8601 string, or Unix seconds or milliseconds
 * @returns {number | undefined} Unix milliseconds
 */
function asTimestamp(value) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  return undefined;
}
