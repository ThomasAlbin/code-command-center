// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { parseAgents, sessionKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-agents.js";

// Shaped like real `claude agents --json` output, with made-up values.
const LISTING = JSON.stringify([
  {
    pid: 101,
    cwd: "/Users/dev/projects/alpha",
    kind: "interactive",
    startedAt: 1791274816999,
    sessionId: "11111111-1111-4111-8111-111111111111",
    name: "Alpha work",
    status: "idle",
  },
  {
    pid: 102,
    cwd: "/Users/dev/projects/beta",
    kind: "interactive",
    startedAt: 1791281487398,
    sessionId: "22222222-2222-4222-8222-222222222222",
    name: "Beta",
    status: "waiting",
    waitingFor: "permission prompt",
  },
  { cwd: "/Users/dev/projects/gamma", kind: "background", startedAt: 1791281487000, id: "ab12", state: "blocked" },
]);

test("reads the documented fields", () => {
  const sessions = parseAgents(LISTING);
  assert.ok(sessions);
  assert.equal(sessions.length, 3);
  assert.equal(sessions[0].pid, 101);
  assert.equal(sessions[0].status, "idle");
  assert.equal(sessions[1].waitingFor, "permission prompt");
  assert.equal(sessions[2].pid, undefined);
  assert.equal(sessions[2].state, "blocked");
});

test("returns null for output that is not a JSON array", () => {
  assert.equal(parseAgents(""), null);
  assert.equal(parseAgents("Not logged in"), null);
  assert.equal(parseAgents('{"pid": 1}'), null);
});

test("an empty list is a valid answer", () => {
  assert.deepEqual(parseAgents("[]"), []);
});

test("ignores entries and fields of the wrong type", () => {
  const sessions = parseAgents(JSON.stringify([null, "text", 7, { pid: "101", cwd: 5, status: "busy", extra: true }]));
  assert.ok(sessions);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].pid, undefined);
  assert.equal(sessions[0].cwd, undefined);
  assert.equal(sessions[0].status, "busy");
});

test("a session keeps its identity when its session id changes", () => {
  const before = { pid: 101, startedAt: 5, sessionId: "a" };
  const afterClear = { pid: 101, startedAt: 5, sessionId: "b" };
  assert.equal(sessionKey(before), sessionKey(afterClear));
});

test("a reused pid is a different session", () => {
  assert.notEqual(sessionKey({ pid: 101, startedAt: 5 }), sessionKey({ pid: 101, startedAt: 9 }));
});

test("sessions without a process fall back to their ids", () => {
  assert.equal(sessionKey({ sessionId: "a" }), "sid:a");
  assert.equal(sessionKey({ id: "ab12" }), "id:ab12");
  assert.equal(sessionKey({ cwd: "/tmp" }), undefined);
});
