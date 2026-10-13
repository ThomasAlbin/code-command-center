// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { assignSlots } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/slots.js";

const KEYS = ["k1", "k2", "k3"];

/**
 * @param {string} key
 * @param {number} priority
 * @param {number} recency
 */
const candidate = (key, priority, recency) => ({ key, priority, recency });

test("fills keys in reading order, most important and most recent first", () => {
  const { assignment, overflow } = assignSlots(
    new Map(),
    [candidate("old", 1, 10), candidate("new", 1, 30), candidate("urgent", 3, 20)],
    KEYS,
  );
  assert.deepEqual([...assignment], [["k1", "urgent"], ["k2", "new"], ["k3", "old"]]);
  assert.equal(overflow, 0);
});

test("a session keeps its key when others come and go", () => {
  const first = assignSlots(new Map(), [candidate("a", 1, 1), candidate("b", 1, 2), candidate("c", 1, 3)], KEYS);
  assert.equal(first.assignment.get("k3"), "a");

  // "c" (on k1) ends and a newer session appears: "a" and "b" stay where they are.
  const second = assignSlots(first.assignment, [candidate("a", 1, 1), candidate("b", 1, 2), candidate("d", 2, 9)], KEYS);
  assert.equal(second.assignment.get("k3"), "a");
  assert.equal(second.assignment.get("k2"), "b");
  assert.equal(second.assignment.get("k1"), "d");
});

test("a key stays empty when there are fewer sessions than keys", () => {
  const { assignment, overflow } = assignSlots(new Map(), [candidate("a", 1, 1)], KEYS);
  assert.deepEqual([...assignment], [["k1", "a"]]);
  assert.equal(overflow, 0);
});

test("no reshuffling to close a gap", () => {
  const first = assignSlots(new Map(), [candidate("a", 1, 3), candidate("b", 1, 2), candidate("c", 1, 1)], KEYS);
  const second = assignSlots(first.assignment, [candidate("b", 1, 2), candidate("c", 1, 1)], KEYS);
  assert.equal(second.assignment.has("k1"), false);
  assert.equal(second.assignment.get("k2"), "b");
  assert.equal(second.assignment.get("k3"), "c");
});

test("when full, a waiting session takes the key of the least important one", () => {
  const first = assignSlots(new Map(), [candidate("a", 2, 3), candidate("b", 1, 2), candidate("c", 1, 1)], KEYS);
  const second = assignSlots(
    first.assignment,
    [candidate("a", 2, 3), candidate("b", 1, 2), candidate("c", 1, 1), candidate("urgent", 3, 9)],
    KEYS,
  );
  assert.equal(second.assignment.get("k1"), "a");
  assert.equal(second.assignment.get("k2"), "b");
  assert.equal(second.assignment.get("k3"), "urgent");
  assert.equal(second.overflow, 1);
});

test("a session never loses its key to one that is no more important", () => {
  const first = assignSlots(new Map(), [candidate("a", 1, 1), candidate("b", 1, 2), candidate("c", 1, 3)], KEYS);
  const second = assignSlots(
    first.assignment,
    [candidate("a", 1, 1), candidate("b", 1, 2), candidate("c", 1, 3), candidate("newer", 1, 99)],
    KEYS,
  );
  assert.deepEqual([...second.assignment.values()].sort(), ["a", "b", "c"]);
  assert.equal(second.overflow, 1);
});

test("keys on a hidden page get their sessions back", () => {
  const sessions = [candidate("a", 1, 3), candidate("b", 1, 2), candidate("c", 1, 1)];
  const shown = assignSlots(new Map(), sessions, KEYS);
  const hidden = assignSlots(shown.assignment, sessions, []);
  const back = assignSlots(hidden.assignment, sessions, KEYS);
  assert.deepEqual([...back.assignment], [...shown.assignment]);
});

test("a session is never shown on two visible keys", () => {
  const previous = new Map([
    ["k1", "a"],
    ["k2", "a"],
  ]);
  const { assignment } = assignSlots(previous, [candidate("a", 1, 1), candidate("b", 1, 2)], KEYS);
  assert.equal(assignment.get("k1"), "a");
  assert.equal(assignment.get("k2"), "b");
});
