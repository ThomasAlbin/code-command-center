// @ts-check
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AntigravityCli, readQuota } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/antigravity-cli.js";
import { openApp } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/exec.js";
import {
  groupLabel,
  groupOf,
  groupsIn,
  hostOf,
  isAntigravityCli,
  parseQuota,
  parseStatus,
  pidOfFile,
  sessionOf,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/antigravity.js";
import { paceOf } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/pace.js";
import { renderQuotaKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";
import { viewLimit } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js";
import { parsePs } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-ps.js";
import { baseState } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js";

/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-ps.js").ProcessEntry} ProcessEntry */

const BRIDGE = fileURLToPath(new URL("../mod/antigravity-bridge/statusline.sh", import.meta.url));
const SOURCE = readFileSync(BRIDGE, "utf8");

// As the Antigravity CLI 1.4.7 hands it to its status line command, while a
// tool call waits for approval. Fields the bridge does not keep are filled in
// to show that they stay behind.
const PAYLOAD = {
  agent_state: "tool_use",
  tool_confirmation_pending: true,
  conversation_id: "f35cd412-ba89-4c2a-9647-21df39184c0b",
  conversation_title: "secret plans",
  cwd: "/Users/dev/projects/orbit",
  email: "dev@example.com",
  model: null,
  exceeds_200k_tokens: null,
  product: "antigravity",
  // As `/usage` showed them on a Pro plan: Gemini 4 Argon has a weekly limit of its own.
  quota: {
    "gemini-5h": { remaining_fraction: 0.5, reset_in_seconds: 3600, reset_time: "2026-10-28T23:00:00Z" },
    "gemini-weekly": { remaining_fraction: 1, reset_in_seconds: 600000, reset_time: "2026-11-04T21:17:00Z" },
    "3p-5h": { remaining_fraction: 1, reset_in_seconds: 3600, reset_time: "2026-10-28T23:00:00Z" },
    "3p-weekly": { remaining_fraction: 1, reset_in_seconds: 600000, reset_time: "2026-11-04T21:17:00Z" },
    "gemini-argon-wtu-weekly": { remaining_fraction: 0.8689939975738525, reset_in_seconds: 400000, reset_time: "2026-11-02T21:36:34Z" },
  },
  transcript_path: "/Users/dev/.gemini/antigravity-cli/brain/x/transcript.jsonl",
  version: "1.4.7",
  workspace: { current_dir: "/Users/dev/projects/orbit", project_dir: "/Users/dev/projects/orbit" },
};

/**
 * A home folder, and a stand-in for the CLI: a link named `agy` to the
 * shell, so that the bridge finds a parent process of that name.
 *
 * @param {(paths: { home: string, folder: string, cli: string, other: string }) => void} body
 * @param {{ folder?: boolean }} [options] `folder: false` leaves out the folder the bridge writes into
 */
function withBridge(body, { folder = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), "ccc-agy-"));
  try {
    const home = path.join(root, "home");
    const sessions = path.join(home, ".code-command-center", "antigravity");
    mkdirSync(folder ? sessions : home, { recursive: true });
    mkdirSync(path.join(root, "bin"));
    const cli = path.join(root, "bin", "agy");
    const other = path.join(root, "bin", "zsh");
    symlinkSync("/bin/sh", cli);
    symlinkSync("/bin/sh", other);
    body({ home, folder: sessions, cli, other });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Runs the bridge as the CLI runs it: as a child, with the state on stdin.
 *
 * @param {string} parent the program that starts it
 * @param {string} home
 * @param {string} input
 * @returns {{ status: number | null, out: string, pid: number }} `pid` is the parent's process id
 */
function runBridge(parent, home, input) {
  // `; :` keeps the shell from replacing itself with the bridge, so it stays the parent.
  const result = spawnSync(parent, ["-c", `"${BRIDGE}"; :`], { input, encoding: "utf8", env: { HOME: home, PATH: "/usr/bin:/bin" } });
  return { status: result.status, out: result.stdout + result.stderr, pid: result.pid ?? 0 };
}

/**
 * @param {string} folder
 * @returns {string[]}
 */
const filesIn = (folder) => (existsSync(folder) ? readdirSync(folder).sort() : []);

// --- the bridge ---

test("the bridge writes the state, the wait and the folder, one file per CLI process", () => {
  withBridge(({ home, folder, cli }) => {
    const { status, out, pid } = runBridge(cli, home, JSON.stringify(PAYLOAD));
    assert.equal(status, 0);
    assert.equal(out, "", "nothing is printed, so the CLI's own status line stays as it is");
    assert.deepEqual(filesIn(folder), [`${pid}.json`, "quota.json"]);
    const text = readFileSync(path.join(folder, `${pid}.json`), "utf8");
    assert.deepEqual(JSON.parse(text), { v: 1, state: "tool_use", waiting: true, cwd: "/Users/dev/projects/orbit" });
    for (const kept of ["dev@example.com", "secret plans", "transcript", "f35cd412", "gemini"]) assert.ok(!text.includes(kept), kept);
  });
});

test("each change of state writes over the file of its process", () => {
  withBridge(({ home, folder, cli }) => {
    const first = runBridge(cli, home, JSON.stringify(PAYLOAD));
    // Another process: the stand-in starts anew each time.
    const second = runBridge(cli, home, JSON.stringify({ ...PAYLOAD, agent_state: "idle", tool_confirmation_pending: undefined }));
    assert.deepEqual(filesIn(folder), [`${first.pid}.json`, `${second.pid}.json`, "quota.json"].sort());
    assert.deepEqual(JSON.parse(readFileSync(path.join(folder, `${second.pid}.json`), "utf8")), {
      v: 1,
      state: "idle",
      waiting: false,
      cwd: "/Users/dev/projects/orbit",
    });
  });
});

test("the bridge keeps the plan's limits in one file that every CLI writes", () => {
  withBridge(({ home, folder, cli }) => {
    runBridge(cli, home, JSON.stringify(PAYLOAD));
    const text = readFileSync(path.join(folder, "quota.json"), "utf8");
    assert.deepEqual(JSON.parse(text), { v: 1, quota: PAYLOAD.quota });
    for (const kept of ["dev@example.com", "secret plans", "transcript", "orbit"]) assert.ok(!text.includes(kept), kept);

    // A state without limits, as at the CLI's start, leaves the last ones in place.
    const { pid } = runBridge(cli, home, JSON.stringify({ ...PAYLOAD, quota: undefined }));
    assert.ok(existsSync(path.join(folder, `${pid}.json`)));
    assert.equal(readFileSync(path.join(folder, "quota.json"), "utf8"), text);
  });
});

test("the bridge writes nothing when it was not started by the Antigravity CLI", () => {
  withBridge(({ home, folder, other }) => {
    const { status, out } = runBridge(other, home, JSON.stringify(PAYLOAD));
    assert.equal(status, 0);
    assert.equal(out, "");
    assert.deepEqual(filesIn(folder), []);
  });
});

test("without its folder the bridge writes nothing and makes no folder", () => {
  withBridge(
    ({ home, folder, cli }) => {
      const { status, out } = runBridge(cli, home, JSON.stringify(PAYLOAD));
      assert.equal(status, 0);
      assert.equal(out, "");
      assert.equal(existsSync(folder), false);
      assert.equal(existsSync(path.join(home, ".code-command-center")), false);
    },
    { folder: false },
  );
});

test("what is not a state from the CLI is not written, and the bridge never fails", () => {
  withBridge(({ home, folder, cli }) => {
    for (const input of ["", "garbage", "[1, 2]", JSON.stringify({ cwd: "/x" }), JSON.stringify({ ...PAYLOAD, agent_state: 'idle","waiting":true,"x":"' })]) {
      const { status, out } = runBridge(cli, home, input);
      assert.equal(status, 0, input);
      assert.equal(out, "", input);
    }
    assert.deepEqual(filesIn(folder), []);
  });
});

test("an odd folder name is written as valid JSON", () => {
  withBridge(({ home, folder, cli }) => {
    const cwd = '/Users/dev/my "odd"\\folder é\nnext';
    const { pid } = runBridge(cli, home, JSON.stringify({ ...PAYLOAD, cwd }));
    const written = JSON.parse(readFileSync(path.join(folder, `${pid}.json`), "utf8"));
    assert.equal(written.cwd, '/Users/dev/my "odd"\\folder énext', "quotes and backslashes are kept, a line break is not");
  });
});

test("the Stream Deck plugin understands what the bridge writes", () => {
  withBridge(({ home, folder, cli }) => {
    const { pid } = runBridge(cli, home, JSON.stringify(PAYLOAD));
    const status = parseStatus(readFileSync(path.join(folder, `${pid}.json`), "utf8"));
    assert.ok(status);
    const session = sessionOf(pid, status, "com.apple.Terminal");
    assert.equal(baseState(session), "waiting");
    assert.equal(session.cwd, "/Users/dev/projects/orbit");
  });
});

// The promise the README makes about the bridge. A tripwire, not a lock, as
// for the mod: it reads the script as text.
test("the bridge starts only programs of macOS, the same few, and writes only into its folder", () => {
  const code = SOURCE.replace(/^\s*#.*$/gm, "");
  const programs = [...code.matchAll(/(?:^|[\s|(])(\/(?:usr\/)?bin\/[a-z]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(programs)].sort(), ["/bin/cat", "/bin/mv", "/bin/ps", "/bin/rm", "/usr/bin/plutil", "/usr/bin/sed", "/usr/bin/tr"]);
  assert.doesNotMatch(code, /\b(curl|wget|nc|osascript|open|eval|exec|source|python|node|perl|ruby)\b/);
  assert.match(code, /^DIR="\$HOME\/\.code-command-center\/antigravity"$/m);
  // Every file it writes or moves is in that folder.
  const redirects = [...code.matchAll(/>\s*([^\s;|&)]+)/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(redirects)].sort(), ['"$tmp"', "/dev/null"]);
  assert.match(code, /^ {2}tmp="\$DIR\/\.\$1\.\$\$\.tmp"$/m);
  assert.match(code, /\/bin\/mv -f "\$tmp" "\$DIR\/\$1"/);
  // The two files it puts there: the state of its CLI, and the limits.
  assert.deepEqual([...code.matchAll(/^\s*(?:'\{'\*'\}'\) )?put ("?[^\s"]+"?)/gm)].map((match) => match[1]), ['"$pid.json"', "quota.json"]);
  assert.deepEqual(readdirSync(path.dirname(BRIDGE)).filter((name) => name !== ".DS_Store"), ["statusline.sh"]);
});

// --- reading what the bridge wrote ---

test("a file of the bridge is named after its process", () => {
  assert.equal(pidOfFile("4099.json"), 4099);
  for (const name of ["0.json", ".4099.123.tmp", "4099.json.tmp", "abc.json", "-1.json", "12345678901.json", "4099"]) {
    assert.equal(pidOfFile(name), undefined, name);
  }
});

test("only what the bridge writes is read as a state", () => {
  assert.deepEqual(parseStatus('{"v":1,"state":"working","waiting":false,"cwd":"/x"}'), { state: "working", waiting: false, cwd: "/x" });
  assert.deepEqual(parseStatus('{"state":"idle","cwd":"relative"}'), { state: "idle", waiting: false, cwd: undefined });
  for (const text of ["", "{", "[]", "null", '{"state":""}', '{"state":7}', '{"waiting":true}']) assert.equal(parseStatus(text), null, text);
});

test("the CLI's states become the colours of a session key", () => {
  /** @param {string} state @param {boolean} [waiting] */
  const shown = (state, waiting = false) => baseState(sessionOf(1, { state, waiting }));
  assert.equal(shown("working"), "working");
  assert.equal(shown("tool_use"), "working");
  assert.equal(shown("reviewing"), "working");
  assert.equal(shown("tool_use", true), "waiting");
  assert.equal(shown("idle"), "idle");
  assert.equal(shown("initializing"), "idle", "starting up is not work");
  assert.equal(shown("authenticating"), "idle");
  assert.equal(shown("error"), "error");
  assert.equal(shown("compacting"), "working", "a state a later version adds is taken as work");
  assert.equal(sessionOf(1, { state: "tool_use", waiting: true }).waitingFor, "permission");
});

test("the CLI is known by the name it is started with or by its executable's", () => {
  for (const comm of ["agy", "/opt/homebrew/bin/agy", "/opt/homebrew/Caskroom/antigravity-cli/1.4.7,5900205422411776/antigravity"]) {
    assert.equal(isAntigravityCli(comm), true, comm);
  }
  for (const comm of ["/Applications/Antigravity.app/Contents/MacOS/Antigravity", "/bin/zsh", "agyx", "/usr/bin/antigravity-helper"]) {
    assert.equal(isAntigravityCli(comm), false, comm);
  }
});

const PS = [
  "  1     0 /sbin/launchd",
  "500     1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal",
  "501   500 login",
  "502   501 -zsh",
  "503   502 agy",
  "600     1 /Applications/Visual Studio Code.app/Contents/MacOS/Code",
  "601   600 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)",
  "602   601 /bin/zsh",
  "603   602 /opt/homebrew/bin/agy",
  "700     1 tmux",
  "701   700 -zsh",
  "702   701 agy",
  "800     1 /Applications/Unknown Terminal.app/Contents/MacOS/Unknown",
  "801   800 -zsh",
  "802   801 agy",
].join("\n");

test("the app whose terminal a CLI runs in is found among its parents", () => {
  const table = parsePs(PS);
  assert.equal(hostOf(503, table), "com.apple.Terminal");
  assert.equal(hostOf(603, table), "com.microsoft.VSCode", "VS Code's own terminal");
  assert.equal(hostOf(702, table), undefined, "under tmux the terminal is not a parent");
  assert.equal(hostOf(802, table), undefined, "a terminal that is not on the list");
  assert.equal(hostOf(999, table), undefined);
});

test("only the apps on the list are ever opened", async () => {
  // Refused before any program is started.
  await assert.rejects(openApp("com.example.not-on-the-list"), /not an app this plugin opens/);
});

/**
 * A folder of bridge files, and stand-ins for the process table and liveness.
 *
 * @param {(setup: { folder: string, cli: AntigravityCli, alive: Set<number>, table: Map<number, ProcessEntry>, tableReads: () => number }) => Promise<void>} body
 */
async function withFolder(body) {
  const folder = mkdtempSync(path.join(os.tmpdir(), "ccc-agy-sessions-"));
  const alive = new Set([503, 603]);
  const table = parsePs(PS);
  let reads = 0;
  const cli = new AntigravityCli(
    folder,
    async () => {
      reads += 1;
      return table;
    },
    (pid) => alive.has(pid),
  );
  try {
    await body({ folder, cli, alive, table, tableReads: () => reads });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * @param {string} folder
 * @param {number} pid
 * @param {object} status
 */
const write = (folder, pid, status) => writeFileSync(path.join(folder, `${pid}.json`), JSON.stringify({ v: 1, ...status }));

test("each file of a running CLI is a session, with the app its terminal is in", async () => {
  await withFolder(async ({ folder, cli }) => {
    write(folder, 503, { state: "tool_use", waiting: true, cwd: "/Users/dev/orbit" });
    write(folder, 603, { state: "idle", waiting: false, cwd: "/Users/dev/comet" });
    const sessions = (await cli.listSessions()).sort((a, b) => (a.pid ?? 0) - (b.pid ?? 0));
    assert.deepEqual(sessions, [
      { pid: 503, cwd: "/Users/dev/orbit", host: "com.apple.Terminal", status: "waiting", waitingFor: "permission" },
      { pid: 603, cwd: "/Users/dev/comet", host: "com.microsoft.VSCode", status: "idle" },
    ]);
  });
});

test("the file of a CLI that has quit is removed", async () => {
  await withFolder(async ({ folder, cli, alive }) => {
    write(folder, 503, { state: "idle" });
    write(folder, 603, { state: "idle" });
    alive.delete(603);
    assert.deepEqual((await cli.listSessions()).map((session) => session.pid), [503]);
    assert.deepEqual(filesIn(folder), ["503.json"]);
  });
});

test("the file of a process id that another program has taken over is removed", async () => {
  await withFolder(async ({ folder, cli, alive, table }) => {
    write(folder, 503, { state: "working" });
    table.set(503, { ppid: 1, comm: "/usr/bin/some-other-program" });
    alive.add(503);
    assert.deepEqual(await cli.listSessions(), []);
    assert.deepEqual(filesIn(folder), []);
  });
});

test("without a process table no file is removed for a process that is alive", async () => {
  await withFolder(async ({ folder, cli, table }) => {
    write(folder, 503, { state: "working" });
    table.clear(); // `ps` failed
    assert.deepEqual((await cli.listSessions()).map((session) => [session.pid, session.host]), [[503, undefined]]);
    assert.deepEqual(filesIn(folder), ["503.json"]);
  });
});

test("other files in the folder are left alone, and a link is never followed", async () => {
  await withFolder(async ({ folder, cli }) => {
    const outside = path.join(folder, "..", `ccc-outside-${process.pid}.json`);
    writeFileSync(outside, JSON.stringify({ state: "working" }));
    try {
      symlinkSync(outside, path.join(folder, "603.json"));
      writeFileSync(path.join(folder, "notes.txt"), "mine");
      writeFileSync(path.join(folder, ".503.77.tmp"), "half");
      writeFileSync(path.join(folder, "503.json"), "{ half written");
      assert.deepEqual(await cli.listSessions(), []);
      assert.deepEqual(filesIn(folder), [".503.77.tmp", "503.json", "603.json", "notes.txt"]);
      assert.ok(existsSync(outside));
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

test("with no file to read, no process table is read", async () => {
  await withFolder(async ({ folder, cli, tableReads }) => {
    assert.deepEqual(await cli.listSessions(), []);
    rmSync(folder, { recursive: true });
    assert.deepEqual(await cli.listSessions(), [], "a missing folder means no sessions");
    assert.equal(tableReads(), 0);
  });
});

// --- the plan's limits ---

const WRITTEN = Date.UTC(2026, 9, 28, 21, 0, 0);

test("each limit of the CLI is a limit of its window and group", () => {
  const reading = parseQuota(JSON.stringify({ v: 1, quota: PAYLOAD.quota }), WRITTEN);
  assert.ok(reading);
  assert.equal(reading.writtenAt, WRITTEN);
  const byKind = Object.fromEntries(reading.limits.map((limit) => [limit.kind, limit]));
  assert.deepEqual(Object.keys(byKind).sort(), ["five_hour:3p", "five_hour:gemini", "seven_day:3p", "seven_day:gemini", "seven_day:gemini-argon-wtu"]);
  assert.equal(byKind["five_hour:gemini"].percentUsed, 50);
  assert.equal(Math.round(byKind["seven_day:gemini-argon-wtu"].percentUsed * 10) / 10, 13.1);
  assert.equal(byKind["seven_day:gemini-argon-wtu"].resetsAt, Date.parse("2026-11-02T21:36:34Z"));
});

test("limits that are switched off, or of a window the keys do not know, are left out", () => {
  const reading = parseQuota(
    JSON.stringify({
      quota: {
        "gemini-5h": { remaining_fraction: 0.2, disabled: true },
        "gemini-daily": { remaining_fraction: 0.5 },
        "-5h": { remaining_fraction: 0.5 },
        "3p-weekly": { remaining_fraction: "half" },
        "flash-5h": { remaining_fraction: 1.5, reset_time: "soon" },
      },
    }),
    WRITTEN,
  );
  assert.deepEqual(reading?.limits, [{ kind: "five_hour:flash", percentUsed: 0, resetsAt: undefined }]);
  for (const text of ["", "[]", '{"quota":[]}', '{"v":1}']) assert.equal(parseQuota(text, WRITTEN), null, text);
});

test("a key shows the limit of the group chosen in its settings, Gemini until one is", () => {
  assert.equal(groupOf(undefined), "gemini");
  assert.equal(groupOf({}), "gemini");
  assert.equal(groupOf({ group: "gemini-argon-wtu" }), "gemini-argon-wtu");
  for (const group of ["", "../x", "A B", 5]) assert.equal(groupOf({ group }), "gemini", String(group));

  const reading = /** @type {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js").Reading} */ (
    parseQuota(JSON.stringify({ quota: PAYLOAD.quota }), WRITTEN)
  );
  const kinds = reading.limits.map((limit) => limit.kind);
  assert.deepEqual(groupsIn(kinds, "seven_day", "gemini"), [
    { id: "gemini", label: "Gemini" },
    { id: "3p", label: "3rd party" },
    { id: "gemini-argon-wtu", label: "Argon" },
  ]);
  assert.deepEqual(groupsIn(kinds, "five_hour", "gemini-argon-wtu").map((group) => group.id), ["gemini", "3p", "gemini-argon-wtu"], "a choice with no reading stays on offer");
  assert.equal(groupLabel("flash-lite"), "Flash");
});

test("the limit a key shows is its own group's, with its pace", () => {
  const now = Date.parse("2026-10-29T21:00:00Z");
  const earlier = /** @type {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js").Reading} */ (
    parseQuota(JSON.stringify({ quota: { "gemini-argon-wtu-weekly": { remaining_fraction: 0.95, reset_time: "2026-11-02T21:36:34Z" } } }), now - 2 * 86_400_000)
  );
  const latest = /** @type {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js").Reading} */ (
    parseQuota(JSON.stringify({ quota: PAYLOAD.quota }), now - 60_000)
  );
  const view = viewLimit([earlier, latest], "seven_day:gemini-argon-wtu", now);
  assert.equal(view.status === "ok" && Math.round(view.percent), 13);
  assert.equal(viewLimit([latest], "seven_day", now).status, "none", "Claude Code's own limits are another matter");
  const pace = paceOf([earlier, latest], "seven_day:gemini-argon-wtu", now);
  assert.ok(pace !== undefined, "the weekly window's rule serves");
  assert.ok(pace.even > 0 && pace.even < 100);
});

test("a quota key names its group in the corner", () => {
  const svg = renderQuotaKey({ title: "7d", tag: "Argon", percent: 13, footer: "4d 1h" });
  assert.ok(svg.includes(">7d<") && svg.includes(">Argon<") && svg.includes(">13%<"));
  assert.ok(!renderQuotaKey({ title: "7d", percent: 13, footer: "4d 1h" }).includes("Argon"), "Claude Code's keys have none");
});

test("the limits are read from their one file, as of when it was written", async () => {
  await withFolder(async ({ folder }) => {
    assert.deepEqual(readQuota(folder), new Map(), "no file yet");
    writeFileSync(path.join(folder, "quota.json"), JSON.stringify({ v: 1, quota: PAYLOAD.quota }));
    const reading = readQuota(folder).get("quota.json");
    assert.ok(reading);
    assert.ok(Math.abs(reading.writtenAt - Date.now()) < 60_000);
    assert.equal(reading.limits.length, 5);

    writeFileSync(path.join(folder, "quota.json"), "{ half");
    assert.deepEqual(readQuota(folder), new Map([["quota.json", null]]), "a file caught half written keeps the last reading");

    rmSync(path.join(folder, "quota.json"));
    symlinkSync(path.join(folder, "..", "elsewhere.json"), path.join(folder, "quota.json"));
    assert.deepEqual(readQuota(folder), new Map(), "a link is never followed");
  });
});
