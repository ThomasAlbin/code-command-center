// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { SessionMonitor } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/session-monitor.js";
import { parsePs } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-ps.js";
import { displayState } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js";

/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-agents.js").SessionInfo} SessionInfo */

const PS = parsePs(`
  500     1 /Applications/Claude.app/Contents/MacOS/Claude
  101   500 /Users/dev/Library/Application Support/Claude/claude-code/2.1.293/abc/claude.app/Contents/MacOS/claude
  600     1 /Applications/Visual Studio Code.app/Contents/MacOS/Electron
  102   600 /Users/dev/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
`);

const START = 1_000_000;

/**
 * @param {number} pid
 * @param {string} status
 * @returns {SessionInfo}
 */
const session = (pid, status) => ({ pid, status, startedAt: START - 60_000, cwd: `/work/p${pid}` });

/**
 * A monitor whose listings are scripted. It is never started, so no timers run.
 * @param {Array<SessionInfo[] | null>} listings one per refresh; the last one repeats
 */
function scripted(listings) {
  const state = { now: START, psCalls: 0, changes: 0, alive: new Set([101, 102]) };
  const monitor = new SessionMonitor({
    listSessions: async () => (listings.length > 1 ? /** @type {SessionInfo[] | null} */ (listings.shift()) : listings[0]),
    readProcessTable: async () => {
      state.psCalls += 1;
      return PS;
    },
    isAlive: (pid) => state.alive.has(pid),
    watch: () => ({ close() {} }),
    now: () => state.now,
  });
  monitor.onChange(() => {
    state.changes += 1;
  });
  return { monitor, state };
}

test("each session is attributed to its app", async () => {
  const { monitor } = scripted([[session(101, "busy"), session(102, "idle")]]);
  await monitor.refreshNow();
  assert.deepEqual(
    monitor.sessions.map((tracked) => [tracked.info.pid, tracked.client, tracked.memo.base]),
    [
      [101, "desktop", "working"],
      [102, "vscode", "idle"],
    ],
  );
});

test("the process table is read only when a new session appears", async () => {
  const { monitor, state } = scripted([[session(101, "busy")], [session(101, "idle")], [session(101, "idle"), session(102, "busy")]]);
  await monitor.refreshNow();
  await monitor.refreshNow();
  assert.equal(state.psCalls, 1);
  await monitor.refreshNow();
  assert.equal(state.psCalls, 2);
});

test("a session seen finishing is done until it is acknowledged", async () => {
  const { monitor, state } = scripted([[session(101, "busy")], [session(101, "idle")]]);
  await monitor.refreshNow();
  await monitor.refreshNow();
  const [tracked] = monitor.sessions;
  assert.equal(displayState(tracked.memo, state.now), "done");

  const before = state.changes;
  monitor.acknowledge(tracked.key);
  assert.equal(displayState(monitor.sessions[0].memo, state.now), "idle");
  assert.equal(state.changes, before + 1);
});

test("a process that just started is not shown until it has lasted", async () => {
  const young = { pid: 101, status: "busy", startedAt: START - 500 };
  const { monitor, state } = scripted([[young]]);
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 0);
  state.now += 2_000;
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 1);
});

test("a live session missing from one listing is kept, from two it is dropped", async () => {
  const { monitor } = scripted([[session(101, "busy")], [], []]);
  await monitor.refreshNow();
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 1);
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 0);
});

test("a session whose process is gone is dropped at once", async () => {
  const { monitor, state } = scripted([[session(101, "busy")], []]);
  await monitor.refreshNow();
  state.alive.delete(101);
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 0);
});

test("listing has to fail three times in a row before the keys give up", async () => {
  const { monitor, state } = scripted([[session(101, "busy")], null, null, null, [session(101, "busy")]]);
  await monitor.refreshNow();
  await monitor.refreshNow();
  await monitor.refreshNow();
  assert.equal(monitor.healthy, true);
  assert.equal(monitor.sessions.length, 1, "the last good picture stays");

  const before = state.changes;
  await monitor.refreshNow();
  assert.equal(monitor.healthy, false);
  assert.equal(state.changes, before + 1);

  await monitor.refreshNow();
  assert.equal(monitor.healthy, true);
});

test("overlapping refreshes share one listing", async () => {
  let calls = 0;
  const monitor = new SessionMonitor({
    listSessions: async () => {
      calls += 1;
      return [];
    },
    readProcessTable: async () => PS,
    isAlive: () => true,
    watch: () => ({ close() {} }),
    now: () => START,
  });
  await Promise.all([monitor.refreshNow(), monitor.refreshNow(), monitor.refreshNow()]);
  assert.equal(calls, 1);
});

test("a start time in the future is a clock difference, not a reason to hide a session", async () => {
  const ahead = { pid: 101, status: "busy", startedAt: START + 30_000 };
  const { monitor } = scripted([[ahead]]);
  await monitor.refreshNow();
  assert.equal(monitor.sessions.length, 1);
});
