// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { fitLabel, folderLabel, reasonWord, tidy } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/format.js";
import { parseDevContainers } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-docker.js";
import { renderSessionKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";

// Folder names and container labels come from outside the plugin. Whoever
// starts a container writes its label, so it can be any length and hold
// any character.

/** Characters an image may not hold, written by number so that this file holds none of them. */
const NUL = String.fromCharCode(0);
const ESCAPE = String.fromCharCode(27);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);
const HALF_A_PAIR = String.fromCharCode(0xd83d);

test("characters that do not belong on a key are taken out of a label", () => {
  assert.equal(tidy(`my${NUL}app`), "my app");
  assert.equal(tidy(`a\tb\nc${ESCAPE}[31m`), "a b c [31m");
  assert.equal(tidy(`one${LINE_SEPARATOR}two`), "one two");
  assert.equal(tidy(`safe${RIGHT_TO_LEFT_OVERRIDE}gpj.exe`), "safe gpj.exe");
  assert.equal(tidy(`broken${HALF_A_PAIR}`), "broken");
  assert.equal(tidy("  plain   name  "), "plain name");
});

test("ordinary names pass unchanged, also in other scripts and with emoji", () => {
  for (const name of ["big-data-analyzer", "Übergröße", "日本語のフォルダ", "notes 📓", "a.b_c-d"]) assert.equal(tidy(name), name);
});

test("a label is cut to what a key could ever show", () => {
  assert.equal([...tidy("x".repeat(500))].length, 64);
  assert.equal([...tidy("📓".repeat(500))].length, 64, "counted in characters, so no pair is cut in half");
  assert.equal(folderLabel(`/projects/${"y".repeat(5000)}`).length, 64);
});

test("fitting a label of any length takes no time to speak of", () => {
  const huge = "w".repeat(8_000_000);
  const started = Date.now();
  const fitted = fitLabel(huge);
  const label = folderLabel(`/${huge}`);
  const word = reasonWord(huge);
  assert.ok(Date.now() - started < 1_000, "eight million characters are not fitted one by one");
  assert.ok(fitted.lines.length <= 2 && fitted.lines.every((line) => line.length <= 64));
  assert.ok(label.length <= 64 && word.length <= 64);
});

test("a key drawn from a hostile name is still a well-formed image", () => {
  const svg = renderSessionKey({ app: "vscode", state: "waiting", label: folderLabel(`/x/<a>&${NUL}${ESCAPE}"q"`), reason: reasonWord(`per${NUL}mission`) });
  assert.ok(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(svg), "no control character");
  assert.ok(svg.includes("&lt;a&gt;&amp;"));
  assert.ok(!svg.includes("<a>"));
});

test("a container whose label is longer than any path on a Mac is left out", () => {
  const long = `/${"z".repeat(2000)}`;
  const listed = parseDevContainers(`a1b2c3d4e5f6\t/Users/dev/projects/app\n0123456789ab\t${long}\n`);
  assert.deepEqual(listed, [{ id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" }]);
});
