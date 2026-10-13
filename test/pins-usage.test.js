// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { formatClock, formatCountdown } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/format.js";
import { listProjects, nextPin, pinOf } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/pins.js";
import {
  renderPinnedEmptyKey,
  renderQuotaKey,
  renderSessionKey,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";
import {
  EXPIRED_AFTER_MS,
  parseReading,
  STALE_AFTER_MS,
  viewLimit,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);

// --- choosing a session ---

test("a key's stored settings yield a pin only when they hold a folder", () => {
  assert.equal(pinOf({ pin: "/Users/dev/projects/alpha" }), "/Users/dev/projects/alpha");
  assert.equal(pinOf({}), undefined);
  assert.equal(pinOf({ pin: "" }), undefined);
  assert.equal(pinOf({ pin: "relative" }), undefined);
  assert.equal(pinOf({ pin: 5 }), undefined);
  assert.equal(pinOf(null), undefined);
  assert.equal(pinOf("text"), undefined);
});

test("projects on offer are the running ones, once each, in a stable order", () => {
  const projects = listProjects(["/w/zeta", "/w/alpha", undefined, "/w/zeta"]);
  assert.deepEqual(projects, [
    { id: "/w/alpha", label: "alpha", running: true },
    { id: "/w/zeta", label: "zeta", running: true },
  ]);
});

test("a key's own pin stays on offer while its project is not running", () => {
  assert.deepEqual(listProjects(["/w/alpha"], "/w/gone"), [
    { id: "/w/alpha", label: "alpha", running: true },
    { id: "/w/gone", label: "gone", running: false },
  ]);
});

test("holding a key steps through the projects and back to automatic", () => {
  const projects = listProjects(["/w/alpha", "/w/beta"]);
  const none = new Set();
  assert.equal(nextPin(projects, undefined, none), "/w/alpha");
  assert.equal(nextPin(projects, "/w/alpha", none), "/w/beta");
  assert.equal(nextPin(projects, "/w/beta", none), undefined);
});

test("holding skips projects that another key is reserved for", () => {
  const projects = listProjects(["/w/alpha", "/w/beta", "/w/gamma"]);
  assert.equal(nextPin(projects, undefined, new Set(["/w/alpha"])), "/w/beta");
  assert.equal(nextPin(projects, "/w/beta", new Set(["/w/alpha"])), "/w/gamma");
});

test("a pin whose project is gone restarts the cycle", () => {
  const projects = listProjects(["/w/alpha"], "/w/gone");
  assert.equal(nextPin(projects, "/w/gone", new Set()), "/w/alpha");
});

test("with nothing running, holding leaves the key automatic", () => {
  assert.equal(nextPin([], undefined, new Set()), undefined);
});

test("a reserved key carries a pin marker", () => {
  const pinned = renderSessionKey({ app: "desktop", state: "working", label: "alpha", pinned: true });
  const automatic = renderSessionKey({ app: "desktop", state: "working", label: "alpha" });
  assert.ok(pinned.includes('cx="17"'));
  assert.ok(!automatic.includes('cx="17"'));
});

test("a reserved key without a session shows its project, not a state", () => {
  const svg = renderPinnedEmptyKey("alpha", "desktop");
  assert.ok(svg.includes(">alpha</text>"));
  assert.ok(svg.includes('cx="17"'));
  assert.ok(svg.includes("#0D1117"));
});

// --- plan limits ---

/** @param {object} data */
const reading = (data) => /** @type {NonNullable<ReturnType<typeof parseReading>>} */ (parseReading(JSON.stringify(data)));

test("reads what the mod writes", () => {
  const parsed = parseReading(
    JSON.stringify({
      v: 1,
      writtenAt: NOW,
      limits: [
        { kind: "five_hour", percentUsed: 23.5, resetsAt: "2026-10-08T15:00:00.000Z" },
        { kind: "seven_day", percentUsed: 41.2, resetsAt: "2026-10-12T07:00:00.000Z" },
      ],
    }),
  );
  assert.ok(parsed);
  assert.equal(parsed.limits.length, 2);
  assert.equal(parsed.limits[0].resetsAt, Date.UTC(2026, 9, 8, 15));
});

test("accepts reset times as seconds or milliseconds as well", () => {
  const seconds = reading({ writtenAt: NOW, limits: [{ kind: "five_hour", percentUsed: 1, resetsAt: 1_791_000_000 }] });
  const millis = reading({ writtenAt: NOW, limits: [{ kind: "five_hour", percentUsed: 1, resetsAt: 1_791_000_000_000 }] });
  assert.equal(seconds.limits[0].resetsAt, 1_791_000_000_000);
  assert.equal(millis.limits[0].resetsAt, 1_791_000_000_000);
});

test("a half-written or foreign file is no reading", () => {
  assert.equal(parseReading('{"writtenAt": 17913'), null);
  assert.equal(parseReading("[]"), null);
  assert.equal(parseReading('{"limits": []}'), null);
  assert.equal(parseReading('{"writtenAt": 1, "limits": "none"}'), null);
});

test("entries of the wrong shape are dropped and percentages kept in range", () => {
  const parsed = reading({
    writtenAt: NOW,
    limits: [null, { kind: 5 }, { kind: "five_hour", percentUsed: 140 }, { kind: "seven_day", percentUsed: "12" }],
  });
  assert.deepEqual(parsed.limits, [{ kind: "five_hour", percentUsed: 100, resetsAt: undefined }]);
});

test("without a reading there is nothing to show", () => {
  assert.deepEqual(viewLimit([], "five_hour", NOW), { status: "none" });
});

test("the newest report of a limit wins, whichever session wrote it", () => {
  const older = reading({ writtenAt: NOW - 20 * MINUTE, limits: [{ kind: "five_hour", percentUsed: 30, resetsAt: NOW + 2 * HOUR }] });
  const newer = reading({ writtenAt: NOW - 5 * MINUTE, limits: [{ kind: "five_hour", percentUsed: 44, resetsAt: NOW + 2 * HOUR }] });
  const view = viewLimit([newer, older], "five_hour", NOW);
  assert.deepEqual(view, { status: "ok", percent: 44, resetsInMs: 2 * HOUR, writtenAt: NOW - 5 * MINUTE, stale: false });
});

test("a limit missing from the newest report falls back to the last report that had it", () => {
  const older = reading({ writtenAt: NOW - 30 * MINUTE, limits: [{ kind: "seven_day", percentUsed: 60, resetsAt: NOW + 50 * HOUR }] });
  const newer = reading({ writtenAt: NOW - MINUTE, limits: [{ kind: "five_hour", percentUsed: 5, resetsAt: NOW + 4 * HOUR }] });
  const view = viewLimit([older, newer], "seven_day", NOW);
  assert.equal(view.status, "ok");
  assert.equal(view.status === "ok" && view.percent, 60);
});

test("past its reset time a limit reads as reset", () => {
  const past = reading({ writtenAt: NOW - 3 * HOUR, limits: [{ kind: "five_hour", percentUsed: 97, resetsAt: NOW - MINUTE }] });
  assert.deepEqual(viewLimit([past], "five_hour", NOW), { status: "reset" });
});

test("an old reading is marked as such", () => {
  const old = reading({ writtenAt: NOW - STALE_AFTER_MS - 1, limits: [{ kind: "seven_day", percentUsed: 10, resetsAt: NOW + 90 * HOUR }] });
  const view = viewLimit([old], "seven_day", NOW);
  assert.equal(view.status === "ok" && view.stale, true);
});

test("a reading older than any window is ignored", () => {
  const ancient = reading({ writtenAt: NOW - EXPIRED_AFTER_MS - 1, limits: [{ kind: "seven_day", percentUsed: 10 }] });
  assert.deepEqual(viewLimit([ancient], "seven_day", NOW), { status: "none" });
});

test("time left reads naturally", () => {
  assert.equal(formatCountdown(30_000), "1m");
  assert.equal(formatCountdown(42 * MINUTE), "42m");
  assert.equal(formatCountdown(2 * HOUR), "2h");
  assert.equal(formatCountdown(2 * HOUR + 13 * MINUTE), "2h 13m");
  assert.equal(formatCountdown(76 * HOUR), "3d 4h");
  assert.equal(formatCountdown(48 * HOUR), "2d");
});

test("a time of day is shown in local time with two digits", () => {
  assert.equal(formatClock(new Date(2026, 9, 8, 9, 5).getTime()), "09:05");
  assert.equal(formatClock(new Date(2026, 9, 8, 14, 30).getTime()), "14:30");
});

test("a quota key shows the share used, a bar and the footer", () => {
  const svg = renderQuotaKey({ title: "5h", percent: 42.4, footer: "2h 13m" });
  assert.ok(svg.includes(">5h</text>"));
  assert.ok(svg.includes(">42%</text>"));
  assert.ok(svg.includes(">2h 13m</text>"));
  assert.ok(svg.includes('width="51"'), "the bar is 42% of 120 wide");
  assert.ok(!svg.includes("NaN") && !svg.includes("undefined"));
});

test("the bar changes colour as the limit gets close", () => {
  /** @param {number} percent */
  const colour = (percent) => /<rect x="12" y="96" width="\d+" height="10" rx="5" fill="(#[0-9A-F]{6})"\/>(?!<rect)/.exec(renderQuotaKey({ title: "7d", percent, footer: "" }))?.[1];
  assert.equal(colour(50), "#2EA043");
  assert.equal(colour(75), "#F0883E");
  assert.equal(colour(95), "#DA3633");
});

test("a quota key without a reading shows a dash and no bar", () => {
  const svg = renderQuotaKey({ title: "5h", footer: "no data" });
  assert.ok(svg.includes(">–</text>"));
  assert.equal((svg.match(/<rect /g) ?? []).length, 2, "background and empty track only");
});
