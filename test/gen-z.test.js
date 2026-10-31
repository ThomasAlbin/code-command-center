// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { genZOf, SHIMMER_MS, shimmerPhase } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/gen-z.js";

test("Gen-Z mode is on only when the setting is true", () => {
  assert.equal(genZOf({ genZ: true }), true);
  for (const settings of [undefined, null, [], {}, { genZ: "yes" }, { genZ: 1 }, { holo: true }]) assert.equal(genZOf(settings), false);
});

test("the shimmer keeps one beat for every key, and reaches each a little after the one to its upper left", () => {
  const now = 10 * SHIMMER_MS;
  assert.equal(shimmerPhase(now, { column: 0, row: 0 }), 0);
  assert.equal(shimmerPhase(now, undefined), 0, "a key without a place starts with the first");
  const right = shimmerPhase(now, { column: 1, row: 0 });
  const below = shimmerPhase(now, { column: 0, row: 1 });
  assert.equal(right, below, "one step right is as far along as one step down");
  assert.ok(right > 0.5, "a little behind, so not yet there");
  assert.equal(shimmerPhase(now + SHIMMER_MS, { column: 3, row: 2 }), shimmerPhase(now, { column: 3, row: 2 }), "and the beat repeats");
});
