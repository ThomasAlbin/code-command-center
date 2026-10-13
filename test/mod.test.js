// @ts-check
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileFor, snapshot } from "../mod/deck-bridge/hooks/snapshot.js";
import { parseReading, viewLimit } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js";

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const REGISTER = readFileSync(new URL("../mod/deck-bridge/hooks/register.js", import.meta.url), "utf8");
const SNAPSHOT = readFileSync(new URL("../mod/deck-bridge/hooks/snapshot.js", import.meta.url), "utf8");

/** @param {string} source */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// As `session.measure` reports them in Claude Code 2.1.293.
const RATE_LIMITS = [
  { kind: "five_hour", percentUsed: 23.5, resetsAt: "2026-10-08T15:00:00.000Z" },
  { kind: "seven_day", percentUsed: 41.2, resetsAt: "2026-10-12T07:00:00.000Z" },
];

test("the mod writes the two limits and when it wrote them, nothing else", () => {
  const text = snapshot(NOW, RATE_LIMITS);
  assert.ok(text);
  assert.deepEqual(JSON.parse(text), { v: 1, writtenAt: NOW, limits: RATE_LIMITS });
});

test("limits the keys do not show are left out", () => {
  const text = snapshot(NOW, [...RATE_LIMITS, { kind: "spend_limit", percentUsed: 80, used_usd: 314.12 }]);
  assert.ok(text);
  assert.deepEqual(JSON.parse(text).limits, RATE_LIMITS);
  assert.ok(!text.includes("314"));
});

test("with no limit to report nothing is written, so an earlier reading survives", () => {
  assert.equal(snapshot(NOW, []), undefined);
  assert.equal(snapshot(NOW, undefined), undefined);
  assert.equal(snapshot(NOW, [null, "text", { kind: "five_hour" }, { kind: 5, percentUsed: 1 }]), undefined);
});

test("each session writes its own file in the monitor's folder", () => {
  assert.equal(
    fileFor("/Users/dev", "0f8fad5b-d9cb-469f-a165-70867728950e"),
    "/Users/dev/.code-command-center/usage/0f8fad5b-d9cb-469f-a165-70867728950e.json",
  );
});

test("a session id cannot steer the file anywhere else", () => {
  const file = fileFor("/Users/dev", "../../.ssh/authorized_keys");
  assert.ok(file.startsWith("/Users/dev/.code-command-center/usage/"));
  assert.ok(!file.slice("/Users/dev/.code-command-center/usage/".length).includes("/"));
  assert.ok(!file.includes(".."));
  assert.ok(fileFor("/Users/dev", "").endsWith("/session.json"));
});

test("the Stream Deck plugin understands what the mod writes", () => {
  const reading = parseReading(/** @type {string} */ (snapshot(NOW, RATE_LIMITS)));
  assert.ok(reading);
  const view = viewLimit([reading], "five_hour", NOW);
  assert.deepEqual(view, { status: "ok", percent: 23.5, resetsInMs: 3 * 3_600_000, writtenAt: NOW, stale: false });
});

// The promise the README makes: one hook, four calls. These tests read the
// mod's source as text, so they catch a change made in the open: whoever adds
// a hook or a call has to change them along with it, and the README. They
// are a tripwire, not a lock; code written to get past a reading like this
// could. That is why the mod is two short files that can be read whole.
test("the mod hooks one event and makes four calls into Claude Code", () => {
  const source = code(REGISTER);
  const events = [...source.matchAll(/\bon\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  assert.deepEqual(events, ["session.measure"]);
  assert.equal((source.match(/\bon\s*\(/g) ?? []).length, events.length, "every hook names its event in plain text");

  const calls = [...source.matchAll(/\$\.([a-z]+\.[A-Za-z]+)\(/g)].map((match) => match[1]).sort();
  assert.deepEqual(calls, ["clock.now", "env.get", "fs.write", "session.id"]);
  // The engine interface is named once as the hook's parameter and once per
  // call. Any other mention, such as handing it on or reaching into it by
  // another spelling, changes the count.
  assert.equal((source.match(/\$/g) ?? []).length, calls.length + 1);
  assert.deepEqual([...source.matchAll(/\$\.env\.get\(([^)]*)\)/g)].map((match) => match[1]), ['"HOME"']);
  assert.ok(/return next\(e\);/.test(source), "the event is passed on unchanged");
  assert.equal((source.match(/\bnext\s*\(/g) ?? []).length, 1, "once, and never rewritten");
  assert.ok(!/\bimport\s*\(|\brequire\b|\beval\b|\bFunction\b|globalThis|\bprocess\b|fetch|http/.test(source), "nothing is loaded at run time");
});

test("the mod is the two files named in its list of modules, and nothing else", () => {
  const folder = new URL("../mod/deck-bridge/", import.meta.url);
  const hooks = JSON.parse(readFileSync(new URL("hooks/hooks.json", folder), "utf8"));
  assert.deepEqual(hooks, { modules: ["./register.js"] });
  assert.deepEqual(readdirSync(new URL("hooks/", folder)).filter((name) => name !== ".DS_Store").sort(), ["hooks.json", "register.js", "snapshot.js"]);
  assert.deepEqual(readdirSync(folder).filter((name) => name !== ".DS_Store").sort(), [".claude-plugin", "hooks"]);
  assert.deepEqual(readdirSync(new URL(".claude-plugin/", folder)).filter((name) => name !== ".DS_Store"), ["plugin.json"]);
  const manifest = JSON.parse(readFileSync(new URL(".claude-plugin/plugin.json", folder), "utf8"));
  assert.deepEqual(Object.keys(manifest).sort(), ["description", "license", "name", "version"], "no further hooks, commands or servers are declared");
});

test("the mod's helpers cannot reach Claude Code or the network", () => {
  const source = code(SNAPSHOT);
  assert.ok(!/\$\s*\./.test(source) && !/[(,]\s*\$\s*[,)]/.test(source), "no access to the engine interface");
  assert.ok(!/\bimport\b/.test(source), "no imports");
  assert.ok(!/fetch|http|process|require/.test(source));
  assert.deepEqual([...code(REGISTER).matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]), ["./snapshot.js"]);
});
