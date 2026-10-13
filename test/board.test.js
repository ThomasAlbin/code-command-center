// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { Board } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/board.js";
import { CLAUDE_DESKTOP, VS_CODE } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/focus.js";
import { LOGOS } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/logos.js";

/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/app/session-monitor.js").TrackedSession} TrackedSession */
/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/focus.js").FocusTarget} FocusTarget */
/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js").BaseState} BaseState */
/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js").Memo} Memo */

const NOW = 1_000_000;
const MINUTE = 60_000;

/**
 * A session in the folder `/work/<name>`.
 * @param {string} name
 * @param {"desktop" | "vscode" | "other"} client
 * @param {BaseState} base
 * @param {number} [lastChange]
 * @param {Partial<SessionInfo>} [info]
 * @param {Partial<Memo>} [clocks] since when it has been working or waiting
 * @returns {TrackedSession}
 */
const tracked = (name, client, base, lastChange = NOW, info = {}, clocks = {}) => ({
  key: info.sessionId ?? name,
  client,
  info: { cwd: `/work/${name}`, ...info },
  memo: { base, lastChange, ...clocks },
  missed: 0,
});

/** @param {TrackedSession[]} sessions */
function fakeMonitor(sessions) {
  /** @type {Set<() => void>} */
  const listeners = new Set();
  return {
    sessions,
    healthy: true,
    /** @type {Array<{ desktop: number, vscode: number }>} */
    watched: [],
    /** @type {string[]} */
    acknowledged: [],
    /** @param {() => void} listener */
    onChange(listener) {
      listeners.add(listener);
    },
    /** @param {{ desktop: number, vscode: number }} visible */
    watch(visible) {
      this.watched.push({ ...visible });
    },
    /** @param {string} key */
    acknowledge(key) {
      this.acknowledged.push(key);
    },
    emit() {
      for (const listener of listeners) listener();
    },
  };
}

/**
 * @param {string} id
 * @param {number} row
 * @param {number} column
 */
function fakeKey(id, row, column) {
  /** @type {string[]} */
  const images = [];
  return {
    id,
    coordinates: { row, column },
    device: { id: "deck" },
    images,
    /** @param {string} [image] */
    async setImage(image) {
      images.push(decodeURIComponent(image ?? ""));
    },
    /** @returns {string} what the key shows now */
    get shown() {
      return images[images.length - 1];
    },
  };
}

/**
 * @param {TrackedSession[]} sessions
 * @param {{ now: number }} [clock] the time the board sees; a test can move it on
 */
function setUp(sessions, clock = { now: NOW }) {
  const monitor = fakeMonitor(sessions);
  /** @type {FocusTarget[]} */
  const focused = [];
  const board = new Board({
    monitor,
    bringToFront: async (target) => {
      focused.push(target);
    },
    now: () => clock.now,
  });
  return { monitor, board, focused };
}

/** The pin marker drawn on a reserved key. */
const PIN = 'cx="17"';

test("keys fill in reading order with the sessions of their own app", () => {
  const { board } = setUp([tracked("alpha", "desktop", "working", 2), tracked("beta", "vscode", "idle"), tracked("gamma", "desktop", "idle", 1)]);
  const keys = [fakeKey("b", 1, 1), fakeKey("a", 1, 0), fakeKey("c", 1, 2)];
  for (const key of keys) board.keyAppeared("desktop", key);
  const code = fakeKey("v", 2, 0);
  board.keyAppeared("vscode", code);
  board.render();

  const [b, a, c] = keys;
  assert.ok(a.shown.includes(">alpha<"), "the working session comes first");
  assert.ok(b.shown.includes(">gamma<"));
  assert.ok(c.shown.includes(">Claude<"), "a key without a session names its app");
  assert.ok(code.shown.includes(">beta<"));
});

test("every key carries the logo of the app it is for, with or without a session", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle"), tracked("beta", "vscode", "working")]);
  const keys = { claude: fakeKey("a", 0, 0), spare: fakeKey("b", 0, 1), code: fakeKey("v", 1, 0), reserved: fakeKey("r", 1, 1) };
  board.keyAppeared("desktop", keys.claude);
  board.keyAppeared("desktop", keys.spare);
  board.keyAppeared("vscode", keys.code);
  board.keyAppeared("vscode", keys.reserved, { pin: "/work/sleeping" });
  board.render();
  for (const key of [keys.claude, keys.spare]) assert.ok(key.shown.includes(LOGOS.desktop.d) && !key.shown.includes(LOGOS.vscode.d));
  for (const key of [keys.code, keys.reserved]) assert.ok(key.shown.includes(LOGOS.vscode.d) && !key.shown.includes(LOGOS.desktop.d));
});

test("nothing is handed out until the whole page has appeared", async () => {
  const { board } = setUp([tracked("alpha", "desktop", "working")]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  assert.equal(key.images.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(key.images.length, 1, "the page is drawn by itself shortly after");
  board.keyDisappeared("a");
});

test("sessions started from a terminal are on no key", () => {
  const { board } = setUp([tracked("cli", "other", "working")]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  assert.ok(key.shown.includes(">Claude<"));
});

test("a key is redrawn only when what it shows changes", () => {
  const { board, monitor } = setUp([tracked("alpha", "desktop", "working")]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  monitor.emit();
  monitor.emit();
  assert.equal(key.images.length, 1);

  monitor.sessions = [tracked("alpha", "desktop", "waiting")];
  monitor.emit();
  assert.equal(key.images.length, 2);
  assert.ok(key.shown.includes("#F0883E"));
});

test("keys say so when sessions cannot be listed", () => {
  const { board, monitor } = setUp([tracked("alpha", "desktop", "working")]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  monitor.healthy = false;
  monitor.emit();
  assert.ok(key.shown.includes(">?<"));
  assert.ok(!key.shown.includes("alpha"));
});

test("a session in a Dev Container stays on its key while the Mac's sessions cannot be listed", () => {
  const container = { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" };
  const { board, monitor } = setUp([
    tracked("alpha", "desktop", "working"),
    tracked("beta", "vscode", "working"),
    tracked("app", "vscode", "waiting", NOW, { container, sessionId: "in-container" }),
  ]);
  const desktop = fakeKey("d", 0, 0);
  const editor = [fakeKey("v1", 1, 0), fakeKey("v2", 1, 1), fakeKey("v3", 1, 2)];
  board.keyAppeared("desktop", desktop);
  for (const key of editor) board.keyAppeared("vscode", key);
  board.render();
  assert.equal(editor.filter((key) => key.shown.includes(">beta<")).length, 1);

  monitor.healthy = false;
  monitor.emit();
  assert.ok(desktop.shown.includes(">?<"));
  assert.equal(editor.filter((key) => key.shown.includes(">app<")).length, 1, "Dev Containers are listed on their own");
  assert.equal(editor.filter((key) => key.shown.includes(">?<")).length, 2, "the Mac's own session and the free key are not known");
  assert.ok(!editor.some((key) => key.shown.includes("beta")));
});

test("sessions without a key are counted on the last key", () => {
  const { board } = setUp([tracked("a", "desktop", "idle", 3), tracked("b", "desktop", "idle", 2), tracked("c", "desktop", "idle", 1)]);
  const [first, last] = [fakeKey("k1", 0, 0), fakeKey("k2", 0, 1)];
  board.keyAppeared("desktop", first);
  board.keyAppeared("desktop", last);
  board.render();
  assert.ok(!first.shown.includes(">+"));
  assert.ok(last.shown.includes(">+1<"));
});

test("pressing a desktop key brings Claude forward and marks the session as seen", async () => {
  const { board, monitor, focused } = setUp([tracked("alpha", "desktop", "idle")]);
  board.keyAppeared("desktop", fakeKey("a", 0, 0));
  board.render();
  await board.keyPressed("a");
  assert.deepEqual(focused, [{ bundleId: CLAUDE_DESKTOP }]);
  assert.deepEqual(monitor.acknowledged, ["alpha"]);
});

test("pressing a desktop key asks Claude for the session on it", async () => {
  const sessionId = "0f8fad5b-d9cb-469f-a165-70867728950e";
  const { board, focused } = setUp([tracked("alpha", "desktop", "idle", NOW, { pid: 4242, kind: "interactive", sessionId })]);
  board.keyAppeared("desktop", fakeKey("a", 0, 0));
  board.render();
  await board.keyPressed("a");
  assert.deepEqual(focused, [{ bundleId: CLAUDE_DESKTOP, session: sessionId }]);
});

test("pressing a VS Code key brings that session's folder forward", async () => {
  const { board, focused } = setUp([tracked("alpha", "vscode", "working")]);
  board.keyAppeared("vscode", fakeKey("a", 0, 0));
  board.render();
  await board.keyPressed("a");
  assert.deepEqual(focused, [{ bundleId: VS_CODE, folder: "/work/alpha" }]);
});

test("pressing the key of a Dev Container session brings the container's window forward", async () => {
  const container = { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" };
  const { board, focused } = setUp([tracked("app", "vscode", "idle", NOW, { cwd: "/workspaces/app", container })]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("vscode", key);
  board.render();
  assert.ok(key.shown.includes(">app<"), "labelled with the folder on the Mac");

  await board.keyPressed("a");
  assert.deepEqual(focused, [
    { bundleId: VS_CODE, devContainer: { localFolder: "/Users/dev/projects/app", path: "/workspaces/app" } },
  ]);
});

test("pressing an empty key brings its app forward", async () => {
  const { board, monitor, focused } = setUp([]);
  board.keyAppeared("vscode", fakeKey("a", 0, 0));
  board.render();
  await board.keyPressed("a");
  assert.deepEqual(focused, [{ bundleId: VS_CODE }]);
  assert.deepEqual(monitor.acknowledged, []);
});

test("each source of sessions is asked only while a key that can show it is visible", () => {
  const { board, monitor } = setUp([]);
  board.keyAppeared("desktop", fakeKey("a", 0, 0));
  board.keyAppeared("vscode", fakeKey("v", 1, 0));
  board.keyDisappeared("v");
  board.keyDisappeared("a");
  assert.deepEqual(monitor.watched, [
    { desktop: 1, vscode: 0 },
    { desktop: 1, vscode: 1 },
    { desktop: 1, vscode: 0 },
    { desktop: 0, vscode: 0 },
  ]);
});

test("a session returns to the same key after the page was hidden", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle", 2), tracked("beta", "desktop", "idle", 1)]);
  board.keyAppeared("desktop", fakeKey("a1", 0, 0));
  board.keyAppeared("desktop", fakeKey("b1", 0, 1));
  board.render();
  board.keyDisappeared("a1");
  board.keyDisappeared("b1");

  // Stream Deck may hand out new ids when the page comes back, in any order.
  const [second, first] = [fakeKey("b2", 0, 1), fakeKey("a2", 0, 0)];
  board.keyAppeared("desktop", second);
  board.keyAppeared("desktop", first);
  board.render();
  assert.ok(first.shown.includes(">alpha<"));
  assert.ok(second.shown.includes(">beta<"));
});

// --- choosing which session a key shows ---

test("a reserved key shows its project wherever it sits", () => {
  const { board } = setUp([tracked("alpha", "desktop", "working", 3), tracked("beta", "desktop", "idle", 2), tracked("gamma", "desktop", "idle", 1)]);
  const [first, second] = [fakeKey("k1", 0, 0), fakeKey("k2", 0, 1)];
  board.keyAppeared("desktop", first, { pin: "/work/gamma" });
  board.keyAppeared("desktop", second);
  board.render();

  assert.ok(first.shown.includes(">gamma<") && first.shown.includes(PIN));
  assert.ok(second.shown.includes(">alpha<") && !second.shown.includes(PIN), "the automatic key takes the best of the rest");
  assert.ok(second.shown.includes(">+1<"), "beta has no key");
});

test("a reserved key keeps its project's name while nothing runs there", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle")]);
  const key = fakeKey("k1", 0, 0);
  board.keyAppeared("desktop", key, { pin: "/work/sleeping" });
  board.render();
  assert.ok(key.shown.includes(">sleeping<") && key.shown.includes(PIN));
  assert.ok(!key.shown.includes("alpha"), "it does not borrow another project's session");
});

test("a session on a reserved key is not shown again on an automatic key", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle")]);
  const [reserved, automatic] = [fakeKey("k1", 0, 1), fakeKey("k2", 0, 0)];
  board.keyAppeared("desktop", reserved, { pin: "/work/alpha" });
  board.keyAppeared("desktop", automatic);
  board.render();
  assert.ok(reserved.shown.includes(">alpha<"));
  assert.ok(automatic.shown.includes(">Claude<"));
});

test("with two sessions in one project the reserved key shows the one that needs attention", () => {
  const quiet = tracked("alpha", "desktop", "idle", 1, { sessionId: "quiet" });
  const asking = tracked("alpha", "desktop", "waiting", 2, { sessionId: "asking" });
  const { board } = setUp([quiet, asking]);
  const [reserved, automatic] = [fakeKey("k1", 0, 0), fakeKey("k2", 0, 1)];
  board.keyAppeared("desktop", reserved, { pin: "/work/alpha" });
  board.keyAppeared("desktop", automatic);
  board.render();
  assert.ok(reserved.shown.includes("#F0883E"), "waiting");
  assert.ok(automatic.shown.includes("#12361F"), "the idle one goes to the automatic key");
});

test("choosing a project in the key's settings takes effect at once", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle", 2), tracked("beta", "desktop", "idle", 1)]);
  const key = fakeKey("k1", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  assert.ok(key.shown.includes(">alpha<"));

  board.settingsChanged("k1", { pin: "/work/beta" });
  assert.ok(key.shown.includes(">beta<") && key.shown.includes(PIN));
  board.settingsChanged("k1", {});
  assert.ok(key.shown.includes(">alpha<") && !key.shown.includes(PIN));
});

test("holding a key steps through the running projects and back to automatic", () => {
  const { board } = setUp([tracked("beta", "desktop", "idle", 2), tracked("alpha", "desktop", "idle", 1)]);
  const key = fakeKey("k1", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();

  assert.deepEqual(board.keyHeld("k1"), { pin: "/work/alpha" });
  assert.ok(key.shown.includes(">alpha<") && key.shown.includes(PIN));
  assert.deepEqual(board.keyHeld("k1"), { pin: "/work/beta" });
  assert.ok(key.shown.includes(">beta<"));
  assert.deepEqual(board.keyHeld("k1"), { pin: undefined });
  assert.ok(!key.shown.includes(PIN));
  assert.equal(board.keyHeld("gone"), undefined);
});

test("holding skips a project another key is reserved for", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle"), tracked("beta", "desktop", "idle")]);
  board.keyAppeared("desktop", fakeKey("k1", 0, 0), { pin: "/work/alpha" });
  board.keyAppeared("desktop", fakeKey("k2", 0, 1));
  board.render();
  assert.deepEqual(board.keyHeld("k2"), { pin: "/work/beta" });
  assert.deepEqual(board.keyHeld("k2"), { pin: undefined });
});

test("the settings panel is offered the running projects of the key's app and its own choice", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle"), tracked("code", "vscode", "idle")]);
  board.keyAppeared("desktop", fakeKey("k1", 0, 0), { pin: "/work/sleeping" });
  board.render();
  assert.deepEqual(board.choices("k1"), {
    pin: "/work/sleeping",
    projects: [
      { id: "/work/alpha", label: "alpha", running: true },
      { id: "/work/sleeping", label: "sleeping", running: false },
    ],
  });
  assert.deepEqual(board.choices("gone"), { projects: [], pin: "" });
});

test("pressing a reserved VS Code key without a session opens its project", async () => {
  const { board, focused } = setUp([]);
  board.keyAppeared("vscode", fakeKey("k1", 0, 0), { pin: "/work/app" });
  board.render();
  await board.keyPressed("k1");
  assert.deepEqual(focused, [{ bundleId: VS_CODE, folder: "/work/app", devContainer: { localFolder: "/work/app" } }]);
});

test("settings that are not a project leave the key automatic", () => {
  const { board } = setUp([tracked("alpha", "desktop", "idle")]);
  const key = fakeKey("k1", 0, 0);
  board.keyAppeared("desktop", key, { pin: 42, other: "x" });
  board.render();
  assert.ok(key.shown.includes(">alpha<") && !key.shown.includes(PIN));
});

// --- time on the keys ---

/** The frame drawn on a key that has waited too long. */
const FRAME = '<rect x="3" y="3"';

test("a working key shows how long its turn has been running", () => {
  const { board } = setUp([tracked("alpha", "desktop", "working", NOW, {}, { turnSince: NOW - 12 * MINUTE })]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  assert.ok(key.shown.includes(">12m<"));
});

test("a key shows no time for a session that is idle or only just started its turn", () => {
  const { board } = setUp([
    tracked("alpha", "desktop", "working", 2, {}, { turnSince: NOW - 20_000 }),
    tracked("beta", "desktop", "idle", 1),
  ]);
  const [first, second] = [fakeKey("a", 0, 0), fakeKey("b", 0, 1)];
  board.keyAppeared("desktop", first);
  board.keyAppeared("desktop", second);
  board.render();
  assert.equal((first.shown.match(/<text /g) ?? []).length, 1, "the label only");
  assert.equal((second.shown.match(/<text /g) ?? []).length, 1);
});

test("a waiting key shows how long it has waited and what for", () => {
  const waiting = tracked("alpha", "desktop", "waiting", NOW, { waitingFor: "permission prompt" }, { turnSince: NOW - 10 * MINUTE, waitingSince: NOW - 3 * MINUTE });
  const { board } = setUp([waiting]);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  assert.ok(key.shown.includes(">3m<"), "the wait, not the whole turn");
  assert.ok(key.shown.includes(">permission<"));
  assert.ok(!key.shown.includes(FRAME), "not left alone for long yet");
});

test("a key left waiting for five minutes pulses until the session is looked at", () => {
  const clock = { now: NOW };
  const waiting = tracked("alpha", "desktop", "waiting", NOW, {}, { waitingSince: NOW - 6 * MINUTE });
  const { board, monitor } = setUp([waiting], clock);
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  const calm = key.shown;
  assert.ok(calm.includes(FRAME) && calm.includes("#F0883E"));

  clock.now += 1000;
  board.render();
  assert.ok(key.shown.includes(FRAME) && key.shown.includes('fill="#FFD9A6"'), "the bright half of the pulse");
  clock.now += 1000;
  board.render();
  assert.equal(key.shown, calm);

  // What the monitor does when the key is pressed.
  monitor.sessions = [{ ...waiting, memo: { ...waiting.memo, seen: true } }];
  monitor.emit();
  assert.ok(!key.shown.includes(FRAME) && key.shown.includes("#F0883E"));
  assert.ok(key.shown.includes(">6m<"), "it keeps counting");
});

test("a pulsing key redraws by itself", async () => {
  const waiting = tracked("alpha", "desktop", "waiting", NOW, {}, { waitingSince: Date.now() - 6 * MINUTE });
  const { board } = setUp([waiting], { get now() { return Date.now(); } });
  const key = fakeKey("a", 0, 0);
  board.keyAppeared("desktop", key);
  board.render();
  assert.equal(key.images.length, 1);

  await new Promise((resolve) => setTimeout(resolve, 1150));
  assert.ok(key.images.length >= 2, "the other half of the pulse arrived without any event");
  board.keyDisappeared("a");
});
