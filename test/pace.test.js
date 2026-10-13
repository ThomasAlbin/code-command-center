// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { paceOf } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/pace.js";
import { renderQuotaKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";
import { describeLimit, viewLimit } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js";

/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js").Reading} Reading */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Noon, local time, so that times of day read the same wherever the tests run. */
const NOW = new Date(2026, 9, 8, 12, 0).getTime();

/**
 * A reading of one limit.
 * @param {string} kind
 * @param {number} percent
 * @param {number} writtenAt
 * @param {number} [resetsAt]
 * @returns {Reading}
 */
const reading = (kind, percent, writtenAt, resetsAt) => ({ writtenAt, limits: [{ kind, percentUsed: percent, resetsAt }] });

/**
 * Even use is a fraction, so it is compared to two decimals.
 * @param {ReturnType<typeof paceOf>} pace
 */
const rounded = (pace) => (pace === undefined ? undefined : { ...pace, even: Math.round(pace.even * 100) / 100 });

/** The reset time of a 5-hour window that opened `ago` before now. */
const openedAgo = (/** @type {number} */ ago) => NOW - ago + 5 * HOUR;

test("even use is where the clock is in the window", () => {
  const halfway = reading("five_hour", 10, NOW - MINUTE, openedAgo(2.5 * HOUR));
  assert.equal(rounded(paceOf([halfway], "five_hour", NOW))?.even, 50);

  const week = reading("seven_day", 10, NOW - MINUTE, NOW + 1.75 * DAY);
  assert.equal(rounded(paceOf([week], "seven_day", NOW))?.even, 75);
});

test("there is no pace without a window to measure against", () => {
  assert.equal(paceOf([], "five_hour", NOW), undefined);
  assert.equal(paceOf([reading("five_hour", 10, NOW - MINUTE)], "five_hour", NOW), undefined, "no reset time");
  assert.equal(paceOf([reading("five_hour", 10, NOW - HOUR, NOW - MINUTE)], "five_hour", NOW), undefined, "window over");
  assert.equal(paceOf([reading("spend_limit", 10, NOW - MINUTE, NOW + HOUR)], "spend_limit", NOW), undefined, "unknown kind of limit");
});

test("a window that reports a start in the future is at its beginning", () => {
  const early = reading("five_hour", 1, NOW - MINUTE, NOW + 5 * HOUR + 3 * MINUTE);
  assert.deepEqual(paceOf([early], "five_hour", NOW), { even: 0 });
});

test("in a young window the pace is measured from its start", () => {
  // 30% in the first half hour: at that rate the limit is reached 100 minutes in.
  const resetsAt = openedAgo(30 * MINUTE);
  const pace = paceOf([reading("five_hour", 30, NOW - MINUTE, resetsAt)], "five_hour", NOW);
  assert.ok(pace?.fullAt !== undefined);
  assert.equal(Math.round((pace.fullAt - NOW) / MINUTE), 70);
});

test("the first minutes of a window are too little to judge by", () => {
  const resetsAt = openedAgo(10 * MINUTE);
  assert.deepEqual(rounded(paceOf([reading("five_hour", 20, NOW - MINUTE, resetsAt)], "five_hour", NOW)), { even: 3.33 });
});

test("the pace is the use of the last hour, not of the whole window", () => {
  // Three quiet hours, then 30% in the last one: 68% left takes over two hours, and one is left.
  const resetsAt = openedAgo(4 * HOUR);
  const readings = [
    reading("five_hour", 2, NOW - 3 * HOUR, resetsAt),
    reading("five_hour", 2, NOW - HOUR, resetsAt),
    reading("five_hour", 32, NOW - MINUTE, resetsAt),
  ];
  assert.deepEqual(rounded(paceOf(readings, "five_hour", NOW)), { even: 80 });

  // The same last hour with three hours left: 70% left at 30% an hour does not last.
  const earlier = openedAgo(2 * HOUR);
  const busy = [reading("five_hour", 0, NOW - HOUR, earlier), reading("five_hour", 30, NOW - MINUTE, earlier)];
  const pace = paceOf(busy, "five_hour", NOW);
  assert.ok(pace?.fullAt !== undefined);
  assert.equal(Math.round((pace.fullAt - NOW) / MINUTE), 140);
});

test("with no reading from an hour ago, the pace falls back to the window's average", () => {
  // 60% in three hours is 20% an hour: the remaining 40% lasts exactly the two hours left.
  const resetsAt = openedAgo(3 * HOUR);
  const recent = [reading("five_hour", 50, NOW - 20 * MINUTE, resetsAt), reading("five_hour", 60, NOW - MINUTE, resetsAt)];
  assert.deepEqual(rounded(paceOf(recent, "five_hour", NOW)), { even: 60 }, "right at the reset is no warning");

  const faster = [reading("five_hour", 75, NOW - MINUTE, resetsAt)];
  assert.equal(paceOf(faster, "five_hour", NOW)?.fullAt, NOW + HOUR);
});

test("once use stops, the warning goes away", () => {
  const resetsAt = openedAgo(2 * HOUR);
  const readings = [reading("five_hour", 10, NOW - HOUR, resetsAt), reading("five_hour", 60, NOW, resetsAt)];
  assert.ok(paceOf(readings, "five_hour", NOW)?.fullAt !== undefined);
  // An hour without use leaves no pace to project.
  assert.equal(paceOf(readings, "five_hour", NOW + 61 * MINUTE)?.fullAt, undefined);
});

test("running out just before the reset is not worth a warning", () => {
  // 50% an hour with 50% left: full one hour from now.
  const base = (/** @type {number} */ resetsAt) => [reading("five_hour", 0, NOW - HOUR, resetsAt), reading("five_hour", 50, NOW, resetsAt)];
  assert.ok(paceOf(base(NOW + HOUR + 10 * MINUTE), "five_hour", NOW)?.fullAt !== undefined);
  assert.equal(paceOf(base(NOW + HOUR + 9 * MINUTE), "five_hour", NOW)?.fullAt, undefined);
});

test("readings from the window before do not count", () => {
  const resetsAt = openedAgo(2 * HOUR);
  const readings = [
    reading("five_hour", 90, NOW - 2.5 * HOUR, resetsAt - 5 * HOUR),
    reading("five_hour", 6, NOW - MINUTE, resetsAt),
  ];
  assert.deepEqual(rounded(paceOf(readings, "five_hour", NOW)), { even: 40 });
});

test("a limit that is used up has no time left to project", () => {
  const resetsAt = openedAgo(HOUR);
  assert.deepEqual(rounded(paceOf([reading("five_hour", 100, NOW - MINUTE, resetsAt)], "five_hour", NOW)), { even: 20 });
});

test("the weekly limit is judged by the last day", () => {
  const resetsAt = NOW + 2 * DAY;
  const readings = [reading("seven_day", 30, NOW - DAY, resetsAt), reading("seven_day", 70, NOW - MINUTE, resetsAt)];
  const pace = paceOf(readings, "seven_day", NOW);
  assert.ok(pace?.fullAt !== undefined);
  assert.equal(Math.round((pace.fullAt - NOW) / HOUR), 18, "30% left at 40% a day");
});

// --- what the key says ---

test("a warning replaces the countdown and names the time the limit runs out", () => {
  const resetsAt = NOW + 2 * HOUR;
  const readings = [reading("five_hour", 75, NOW - MINUTE, resetsAt)];
  const view = viewLimit(readings, "five_hour", NOW);
  assert.deepEqual(describeLimit("5h", view, rounded(paceOf(readings, "five_hour", NOW))), {
    title: "5h",
    percent: 75,
    even: 60,
    footer: "full 13:00",
    warn: true,
  });
});

test("without a warning the countdown stays and the tick is added", () => {
  const readings = [reading("five_hour", 20, NOW - MINUTE, NOW + 2 * HOUR)];
  const view = viewLimit(readings, "five_hour", NOW);
  assert.deepEqual(describeLimit("5h", view, rounded(paceOf(readings, "five_hour", NOW))), { title: "5h", percent: 20, even: 60, footer: "2h" });
});

test("a run-out days away is named with its day", () => {
  const view = /** @type {const} */ ({ status: "ok", percent: 70, resetsInMs: 2 * DAY, writtenAt: NOW, stale: false });
  const described = describeLimit("7d", view, { even: 71, fullAt: new Date(2026, 9, 9, 6, 30).getTime() });
  assert.equal(described.footer, "full Fri 06:30");
});

test("an old reading keeps its tick but does not warn", () => {
  const view = /** @type {const} */ ({ status: "ok", percent: 70, resetsInMs: HOUR, writtenAt: new Date(2026, 9, 8, 9, 5).getTime(), stale: true });
  assert.deepEqual(describeLimit("5h", view, { even: 80, fullAt: NOW + MINUTE }), { title: "5h", percent: 70, even: 80, footer: "as of 09:05" });
});

/** @param {string} svg */
const tickAt = (svg) => /<path d="M(\d+) 91V111"/.exec(svg)?.[1];

test("the tick sits along the bar where even use would be", () => {
  assert.equal(tickAt(renderQuotaKey({ title: "5h", percent: 20, footer: "2h", even: 50 })), "72");
  assert.equal(tickAt(renderQuotaKey({ title: "5h", percent: 20, footer: "2h", even: 0 })), "14", "kept off the rounded end");
  assert.equal(tickAt(renderQuotaKey({ title: "5h", percent: 20, footer: "2h", even: 100 })), "130");
  assert.equal(tickAt(renderQuotaKey({ title: "5h", percent: 20, footer: "2h" })), undefined);
});

test("a warning is drawn in the warning colour and still fits the key", () => {
  const calm = renderQuotaKey({ title: "7d", percent: 70, footer: "2d" });
  const warning = renderQuotaKey({ title: "7d", percent: 70, footer: "full Wed 18:00", warn: true });
  assert.ok(/font-size="20" fill="#C9D1D9">2d</.test(calm));
  assert.ok(/font-size="18" fill="#F0883E">full Wed 18:00</.test(warning), "a long footer is set smaller");
});
