// @ts-check
import { EXPIRED_AFTER_MS } from "./usage.js";

/** @typedef {import("./usage.js").Reading} Reading */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * How the window of one limit is judged.
 * @typedef {object} Rule
 * @property {number} lengthMs how long the window lasts
 * @property {number} lookbackMs the stretch whose use counts as the current pace
 * @property {number} minSpanMs use over less time than this is too rough to project from
 * @property {number} marginMs running out this close to the reset is not worth a warning
 */

/** @type {Map<string, Rule>} */
const RULES = new Map([
  ["five_hour", { lengthMs: 5 * HOUR, lookbackMs: HOUR, minSpanMs: 15 * MINUTE, marginMs: 10 * MINUTE }],
  ["seven_day", { lengthMs: 7 * DAY, lookbackMs: DAY, minSpanMs: 6 * HOUR, marginMs: 2 * HOUR }],
]);

/**
 * How the use of a limit compares with the time that has passed.
 * @typedef {object} Pace
 * @property {number} even the percent that even use would have reached by now
 * @property {number} [fullAt] when the limit runs out at the current pace; set only if that is before the reset
 */

/**
 * Claude Code reports how much is used and when the window ends. The pace is
 * worked out from how the readings changed over time.
 *
 * @param {ReadonlyArray<Reading>} readings every reading known, in any order
 * @param {string} kind
 * @param {number} now
 * @returns {Pace | undefined} nothing while the limit's window is not known
 */
export function paceOf(readings, kind, now) {
  const rule = RULES.get(kind);
  if (rule === undefined) return undefined;

  /** @type {Array<{ at: number, percent: number, resetsAt: number | undefined }>} */
  const samples = [];
  for (const reading of readings) {
    if (now - reading.writtenAt > EXPIRED_AFTER_MS) continue;
    const limit = reading.limits.find((candidate) => candidate.kind === kind);
    if (limit !== undefined) samples.push({ at: reading.writtenAt, percent: limit.percentUsed, resetsAt: limit.resetsAt });
  }
  samples.sort((a, b) => a.at - b.at);
  const latest = samples[samples.length - 1];
  if (latest === undefined || latest.resetsAt === undefined || now >= latest.resetsAt) return undefined;
  const { resetsAt } = latest;

  const start = resetsAt - rule.lengthMs;
  const even = Math.min(100, Math.max(0, ((now - start) / rule.lengthMs) * 100));
  if (latest.percent >= 100) return { even };

  // The window opened empty, which is one more point to measure from than the readings give.
  /** @type {{ at: number, percent: number }} */
  let base = { at: start, percent: 0 };
  for (const sample of samples) {
    const sameWindow = sample.resetsAt !== undefined && Math.abs(sample.resetsAt - resetsAt) < rule.lengthMs / 2;
    // The newest point that is at least the lookback old: use since then is the current pace.
    if (sameWindow && sample.at >= base.at && sample.at <= now - rule.lookbackMs) base = sample;
  }
  // Measured up to now, not up to the last reading, so the pace falls once use stops.
  const span = now - base.at;
  const gained = latest.percent - base.percent;
  if (span < rule.minSpanMs || gained <= 0) return { even };

  const fullAt = Math.round(now + ((100 - latest.percent) / gained) * span);
  return fullAt <= resetsAt - rule.marginMs ? { even, fullAt } : { even };
}
