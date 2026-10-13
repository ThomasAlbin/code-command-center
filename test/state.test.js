// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  acknowledge,
  advance,
  baseState,
  displayState,
  DONE_TTL_MS,
  elapsed,
  NUDGE_AFTER_MS,
  overdue,
  priority,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js";

test("maps what Claude Code reports to a base state", () => {
  assert.equal(baseState({ status: "busy" }), "working");
  assert.equal(baseState({ status: "waiting", waitingFor: "permission prompt" }), "waiting");
  assert.equal(baseState({ status: "idle" }), "idle");
});

test("a background session without a process uses its state", () => {
  assert.equal(baseState({ state: "working" }), "working");
  assert.equal(baseState({ state: "blocked" }), "waiting");
  assert.equal(baseState({ state: "done" }), "idle");
  assert.equal(baseState({ state: "stopped" }), "idle");
  assert.equal(baseState({ state: "failed" }), "error");
});

test("values this version does not know are unknown, not an error", () => {
  assert.equal(baseState({ status: "shell" }), "unknown");
  assert.equal(baseState({}), "unknown");
});

test("a session first seen idle is idle, not done", () => {
  const memo = advance(undefined, "idle", 1000);
  assert.equal(displayState(memo, 1000), "idle");
});

test("the first sighting takes the session's start as its last change", () => {
  assert.equal(advance(undefined, "idle", 1000, 400).lastChange, 400);
  assert.equal(advance(undefined, "idle", 1000).lastChange, 1000);
});

test("a session that finishes while watched is done until acknowledged", () => {
  let memo = advance(undefined, "working", 1000);
  memo = advance(memo, "idle", 2000);
  assert.equal(displayState(memo, 2000), "done");
  memo = acknowledge(memo);
  assert.equal(displayState(memo, 2001), "idle");
});

test("answering a prompt and finishing also counts as done", () => {
  let memo = advance(undefined, "waiting", 1000);
  memo = advance(memo, "idle", 2000);
  assert.equal(displayState(memo, 2000), "done");
});

test("done fades to idle after the time limit", () => {
  let memo = advance(undefined, "working", 0);
  memo = advance(memo, "idle", 1000);
  assert.equal(displayState(memo, 1000 + DONE_TTL_MS - 1), "done");
  assert.equal(displayState(memo, 1000 + DONE_TTL_MS), "idle");
});

test("starting work again clears done", () => {
  let memo = advance(undefined, "working", 0);
  memo = advance(memo, "idle", 1000);
  memo = advance(memo, "working", 2000);
  assert.equal(displayState(memo, 2000), "working");
  assert.equal(memo.doneSince, undefined);
});

test("an unchanged state keeps the same memo", () => {
  const memo = advance(undefined, "working", 0);
  assert.equal(advance(memo, "working", 5000), memo);
  assert.equal(acknowledge(memo), memo);
});

test("a working session counts the time since its turn was first seen", () => {
  let memo = advance(undefined, "idle", 0);
  assert.equal(elapsed(memo, 5000), undefined, "an idle session has no clock");
  memo = advance(memo, "working", 1000);
  assert.equal(elapsed(memo, 61_000), 60_000);
});

test("a session first seen at work counts from then, not from when it started", () => {
  const memo = advance(undefined, "working", 10_000, 400);
  assert.equal(elapsed(memo, 12_000), 2000);
});

test("a prompt in the middle of a turn does not restart the turn's clock", () => {
  let memo = advance(undefined, "idle", 0);
  memo = advance(memo, "working", 1000);
  memo = advance(memo, "waiting", 4000);
  assert.equal(elapsed(memo, 9000), 5000, "while waiting, the wait is what counts");
  memo = advance(memo, "working", 10_000);
  assert.equal(elapsed(memo, 11_000), 10_000, "back at work, the whole turn counts");
});

test("each wait is counted on its own, and going quiet stops the clocks", () => {
  let memo = advance(undefined, "waiting", 1000);
  memo = advance(memo, "working", 2000);
  memo = advance(memo, "waiting", 3000);
  assert.equal(elapsed(memo, 3500), 500);
  memo = advance(memo, "idle", 4000);
  assert.deepEqual(memo, { base: "idle", lastChange: 4000, doneSince: 4000 });
});

test("a session left waiting becomes overdue until the user looks", () => {
  let memo = advance(undefined, "waiting", 0);
  assert.equal(overdue(memo, NUDGE_AFTER_MS - 1), false);
  assert.equal(overdue(memo, NUDGE_AFTER_MS), true);

  memo = acknowledge(memo);
  assert.equal(overdue(memo, NUDGE_AFTER_MS * 3), false, "looked at: it stays quiet");
  assert.equal(elapsed(memo, 7000), 7000, "but keeps counting");
  assert.equal(acknowledge(memo), memo);

  memo = advance(advance(memo, "working", 8000), "waiting", 9000);
  assert.equal(overdue(memo, 9000 + NUDGE_AFTER_MS), true, "the next wait can become overdue again");
});

test("only a waiting session can be overdue", () => {
  const memo = advance(undefined, "working", 0);
  assert.equal(overdue(memo, NUDGE_AFTER_MS * 10), false);
});

test("waiting outranks working and done, which outrank idle", () => {
  assert.ok(priority("waiting") > priority("working"));
  assert.equal(priority("working"), priority("done"));
  assert.ok(priority("done") > priority("idle"));
  assert.ok(priority("idle") > priority("unknown"));
});
