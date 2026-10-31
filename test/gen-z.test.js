// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { genZOf, placeOf, SHIMMER_MS, shimmerPhase } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/gen-z.js";

test("Gen-Z mode is on only when the setting is true", () => {
  assert.equal(genZOf({ genZ: true }), true);
  for (const settings of [undefined, null, [], {}, { genZ: "yes" }, { genZ: 1 }]) assert.equal(genZOf(settings), false);
});

test("every key is at the same point of the shimmer, which repeats", () => {
  const now = 10 * SHIMMER_MS;
  assert.equal(shimmerPhase(now), 0);
  assert.equal(shimmerPhase(now + SHIMMER_MS / 4), 0.25);
  assert.equal(shimmerPhase(now + SHIMMER_MS), shimmerPhase(now));
});

test("a key's place is where it sits on a deck of known size, or on an MK.2", () => {
  assert.deepEqual(placeOf({ column: 2, row: 1 }, { columns: 8, rows: 4 }), { column: 2, row: 1, columns: 8, rows: 4 });
  assert.deepEqual(placeOf({ column: 2, row: 1 }), { column: 2, row: 1, columns: 5, rows: 3 });
  assert.equal(placeOf(undefined), undefined, "a key in a multi-action shimmers on its own");
});
