// @ts-check
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClaudeCli } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/claude-cli.js";
import { claudeAgentsJson } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/exec.js";

/**
 * A stand-in for Claude Code: a script named `claude` that prints what it
 * was started with.
 *
 * @param {string} directory
 * @param {string} body shell commands
 * @returns {string} the script
 */
function standIn(directory, body) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "claude");
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/**
 * A home folder with one Claude Code in the place the desktop app keeps it.
 *
 * @param {string} home
 * @param {string} version
 * @param {string} body
 */
function desktopCopy(home, version, body) {
  const directory = path.join(home, "Library", "Application Support", "Claude", "claude-code", version, "build", "claude.app", "Contents", "MacOS");
  return standIn(directory, body);
}

test("Claude Code is started with `agents --json`, its quiet setting and none of the plugin's environment", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "ccc-exec-"));
  const file = standIn(directory, `printf '%s|%s|%s|%s' "$CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC" "$*" "\${LEAKED-not passed on}" "$PATH"`);
  process.env.LEAKED = "from the plugin";
  try {
    assert.equal(await claudeAgentsJson(file), "1|agents --json|not passed on|/usr/bin:/bin:/usr/sbin:/sbin");
  } finally {
    delete process.env.LEAKED;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a program that is not called claude is never started", async () => {
  await assert.rejects(claudeAgentsJson("/bin/sh"));
  await assert.rejects(claudeAgentsJson("claude"), "a path that is not absolute");
});

test("a Mac without Claude Code has no sessions, which is not a failure", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccc-home-"));
  try {
    const cli = new ClaudeCli(home, async () => new Map());
    assert.deepEqual(await cli.listSessions(), []);
    assert.equal(cli.installed, false);
    assert.equal(cli.version, undefined);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a Claude Code that is there but cannot list sessions is a failure", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccc-home-"));
  try {
    desktopCopy(home, "2.1.300", "exit 1");
    const cli = new ClaudeCli(home, async () => new Map());
    assert.equal(await cli.listSessions(), null);
    assert.equal(cli.installed, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("the newest Claude Code that answers is the one in use", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccc-home-"));
  try {
    desktopCopy(home, "2.1.300", "exit 1");
    desktopCopy(home, "2.1.299", `echo '[{"pid":7,"status":"idle"}]'`);
    desktopCopy(home, "2.1.298", `echo '[]'`);
    const cli = new ClaudeCli(home, async () => new Map());
    assert.deepEqual((await cli.listSessions())?.map((session) => session.pid), [7]);
    assert.equal(cli.version, "2.1.299");
    assert.equal(cli.installed, true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
