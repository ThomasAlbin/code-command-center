// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import { DevContainers } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/containers.js";
import { MonitorSet } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/monitor-set.js";
import { SessionMonitor } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/session-monitor.js";
import { UsageMonitor } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/usage-monitor.js";
import { dockerReadUsage } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/exec.js";
import { isUsageFileInContainer, usageFileIn } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-docker.js";
import { describeLimit, parseReading } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js";

/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/usage.js").Reading} Reading */

const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const CLAUDE = "/root/.vscode-server/extensions/anthropic.claude-code-2.1.289-linux-arm64/resources/native-binary/claude";
const TOP = `PID COMMAND\n1 /bin/sh\n7758 ${CLAUDE} --output-format stream-json\n`;
const LISTING = JSON.stringify([{ pid: 886, cwd: "/workspaces/app", kind: "interactive", startedAt: NOW - 60_000, name: "app", status: "busy" }]);

/** A stand-in for Docker that records what it is asked. */
function fakeDocker() {
  return {
    ps: "a1b2c3d4e5f6\t/Users/dev/projects/app\n",
    top: TOP,
    listing: LISTING,
    /** @type {string[]} */
    calls: [],
    failExec: false,
    /** @type {Array<string | undefined>} the user each listing was asked as */
    askedAs: [],
    /** @type {Array<string | undefined>} the user each reading was read as */
    readAs: [],
    /** A user name that this container does not know. */
    noSuchUser: "",
    /** @type {Record<string, string>} file inside the container → its content */
    files: {},
    async devContainers() {
      this.calls.push("ps");
      return this.ps;
    },
    /**
     * @param {string} id
     * @param {string} file
     * @param {string} [user]
     */
    async readUsage(id, file, user) {
      this.readAs.push(user);
      this.calls.push(`cat ${id} ${file}`);
      const content = this.files[file];
      if (content === undefined) throw new Error("No such file or directory");
      return content;
    },
    /** @param {string} id */
    async processes(id) {
      this.calls.push(`top ${id}`);
      return this.top;
    },
    /**
     * @param {string} id
     * @param {string} binary
     * @param {string} [user]
     */
    async claudeAgentsJson(id, binary, user) {
      this.askedAs.push(user);
      if (user !== undefined && user === this.noSuchUser) throw new Error(`unable to find user ${user}`);
      this.calls.push(`exec ${id} ${binary === CLAUDE ? "claude" : binary}`);
      if (this.failExec) throw new Error("exec failed");
      return this.listing;
    },
  };
}

// --- sessions in Dev Containers ---

test("sessions inside a Dev Container are listed with where the container came from", async () => {
  const docker = fakeDocker();
  const containers = new DevContainers(() => NOW, docker);
  const sessions = await containers.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].status, "busy");
  assert.deepEqual(sessions[0].container, { id: "a1b2c3d4e5f6", localFolder: "/Users/dev/projects/app" });
  assert.deepEqual(docker.calls, ["ps", "top a1b2c3d4e5f6", "exec a1b2c3d4e5f6 claude"]);
});

test("between scans only the session listing is repeated", async () => {
  const docker = fakeDocker();
  let now = NOW;
  const containers = new DevContainers(() => now, docker);
  await containers.listSessions();
  docker.calls.length = 0;

  now += 3_000;
  await containers.listSessions();
  assert.deepEqual(docker.calls, ["exec a1b2c3d4e5f6 claude"]);

  now += 10_000;
  docker.calls.length = 0;
  await containers.listSessions();
  assert.deepEqual(docker.calls, ["ps", "exec a1b2c3d4e5f6 claude"], "containers are looked up again, Claude Code's place is remembered");
});

test("a container without Claude Code is left alone", async () => {
  const docker = fakeDocker();
  docker.top = "PID COMMAND\n1 /bin/sh\n";
  const containers = new DevContainers(() => NOW, docker);
  assert.deepEqual(await containers.listSessions(), []);
  assert.ok(!docker.calls.some((call) => call.startsWith("exec")));
});

test("when the listing fails, Claude Code is looked for again next time", async () => {
  const docker = fakeDocker();
  const containers = new DevContainers(() => NOW, docker);
  await containers.listSessions();
  docker.failExec = true;
  assert.deepEqual(await containers.listSessions(), []);

  docker.failExec = false;
  docker.calls.length = 0;
  const sessions = await containers.listSessions();
  assert.equal(sessions.length, 1);
  assert.deepEqual(docker.calls, ["top a1b2c3d4e5f6", "exec a1b2c3d4e5f6 claude"]);
});

// VS Code often runs in a container as another user than the container's own,
// and Claude Code keeps each user's sessions apart.
const AS_VSCODE = "/home/vscode/.vscode-server/extensions/anthropic.claude-code-2.1.294-linux-x64/resources/native-binary/claude";

test("a container is asked as the user whose home folder holds its Claude Code", async () => {
  const docker = fakeDocker();
  const containers = new DevContainers(() => NOW, docker);
  await containers.listSessions();
  assert.deepEqual(docker.askedAs, ["root"]);

  const other = fakeDocker();
  other.top = `PID COMMAND\n42 ${AS_VSCODE}\n`;
  const elsewhere = new DevContainers(() => NOW, other);
  assert.equal((await elsewhere.listSessions()).length, 1);
  assert.deepEqual(other.askedAs, ["vscode"]);
});

test("where the folder's name is no user of the container, the container's own user is asked", async () => {
  const docker = fakeDocker();
  docker.top = `PID COMMAND\n42 ${AS_VSCODE}\n`;
  docker.noSuchUser = "vscode";
  const containers = new DevContainers(() => NOW, docker);
  assert.equal((await containers.listSessions()).length, 1);
  assert.deepEqual(docker.askedAs, ["vscode", undefined]);
});

test("a reading is read as the user the listing was answered as", async () => {
  const docker = fakeDocker();
  docker.top = `PID COMMAND\n42 ${AS_VSCODE}\n`;
  docker.listing = JSON.stringify([{ pid: 9, sessionId: "0f8fad5b-d9cb-469f-a165-70867728950e", status: "idle", startedAt: NOW - 60_000 }]);
  docker.files["/home/vscode/.code-command-center/usage/0f8fad5b-d9cb-469f-a165-70867728950e.json"] = JSON.stringify({
    v: 1,
    writtenAt: NOW,
    limits: [{ kind: "five_hour", percentUsed: 12, resetsAt: "2026-10-08T15:00:00.000Z" }],
  });
  const containers = new DevContainers(() => NOW, docker);
  assert.equal((await containers.readReadings()).size, 1);
  assert.deepEqual(docker.readAs, ["vscode"]);

  const fallback = fakeDocker();
  fallback.top = docker.top;
  fallback.listing = docker.listing;
  fallback.files = docker.files;
  fallback.noSuchUser = "vscode";
  assert.equal((await new DevContainers(() => NOW, fallback).readReadings()).size, 1);
  assert.deepEqual(fallback.readAs, [undefined]);
});

test("without Docker there are simply no container sessions", async () => {
  const docker = fakeDocker();
  docker.devContainers = async () => {
    throw new Error("docker is not installed");
  };
  const containers = new DevContainers(() => NOW, docker);
  assert.deepEqual(await containers.listSessions(), []);
});

// --- usage reported inside Dev Containers ---

const SESSION = "0f8fad5b-d9cb-469f-a165-70867728950e";
const USAGE_FILE = `/root/.code-command-center/usage/${SESSION}.json`;
const LISTING_WITH_ID = JSON.stringify([{ pid: 886, cwd: "/workspaces/app", kind: "interactive", startedAt: NOW - 60_000, sessionId: SESSION, status: "idle" }]);
/** @param {number} percent */
const written = (percent) => JSON.stringify({ v: 1, writtenAt: NOW - 1000, limits: [{ kind: "five_hour", percentUsed: percent, resetsAt: new Date(NOW + 3_600_000).toISOString() }] });

test("a session's reading in a container sits in the home folder that holds the Claude Code extension", () => {
  assert.equal(usageFileIn(CLAUDE, SESSION), USAGE_FILE);
  const elsewhere = "/home/vscode/.vscode-server/extensions/anthropic.claude-code-2.1.294-linux-x64/resources/native-binary/claude";
  assert.equal(usageFileIn(elsewhere, SESSION), `/home/vscode/.code-command-center/usage/${SESSION}.json`);
});

test("only a reading of the mod can be named inside a container", async () => {
  assert.equal(usageFileIn(CLAUDE, undefined), undefined);
  assert.equal(usageFileIn(CLAUDE, "../../etc/passwd"), undefined);
  assert.equal(usageFileIn("/usr/bin/claude", SESSION), undefined, "not Claude Code as the extension installs it");
  assert.equal(isUsageFileInContainer(USAGE_FILE), true);
  for (const file of ["/root/.claude/.credentials.json", "/etc/passwd", `/root/.code-command-center/usage/../${SESSION}.json`, "/root/.code-command-center/usage/a b.json", `${USAGE_FILE} /etc/passwd`]) {
    assert.equal(isUsageFileInContainer(file), false, file);
    // Refused before any program is started.
    await assert.rejects(dockerReadUsage("a1b2c3d4e5f6", file), /not a usage reading/);
  }
  await assert.rejects(dockerReadUsage("not a container", USAGE_FILE), /not a container id/);
});

test("the reading of each container session is fetched", async () => {
  const docker = fakeDocker();
  docker.listing = LISTING_WITH_ID;
  docker.files[USAGE_FILE] = written(37);
  const containers = new DevContainers(() => NOW, docker);
  const readings = await containers.readReadings();
  assert.deepEqual([...readings.keys()], [`a1b2c3d4e5f6:${SESSION}`]);
  assert.equal(readings.get(`a1b2c3d4e5f6:${SESSION}`)?.limits[0].percentUsed, 37);
  assert.deepEqual(docker.calls, ["ps", "top a1b2c3d4e5f6", "exec a1b2c3d4e5f6 claude", `cat a1b2c3d4e5f6 ${USAGE_FILE}`]);
});

test("a listing made a moment ago is used again for reading the usage", async () => {
  const docker = fakeDocker();
  docker.listing = LISTING_WITH_ID;
  docker.files[USAGE_FILE] = written(37);
  let now = NOW;
  const containers = new DevContainers(() => now, docker);
  await containers.listSessions();
  docker.calls.length = 0;

  now += 3_000;
  await containers.readReadings();
  assert.deepEqual(docker.calls, [`cat a1b2c3d4e5f6 ${USAGE_FILE}`]);

  now += 10_000;
  docker.calls.length = 0;
  await containers.readReadings();
  assert.deepEqual(docker.calls, ["ps", "exec a1b2c3d4e5f6 claude", `cat a1b2c3d4e5f6 ${USAGE_FILE}`], "an old listing is made again first");
});

test("a container without the mod, or with a broken file, yields no reading", async () => {
  const docker = fakeDocker();
  docker.listing = LISTING_WITH_ID;
  const containers = new DevContainers(() => NOW, docker);
  assert.equal((await containers.readReadings()).size, 0, "no file");
  docker.files[USAGE_FILE] = '{"writtenAt": 17';
  assert.equal((await containers.readReadings()).size, 0, "half written");
});

test("a session without a reading is asked again only after a minute", async () => {
  const docker = fakeDocker();
  docker.listing = LISTING_WITH_ID;
  let now = NOW;
  const containers = new DevContainers(() => now, docker);
  await containers.readReadings();
  const asked = () => docker.calls.filter((call) => call.startsWith("cat")).length;
  assert.equal(asked(), 1);

  now += 20_000;
  await containers.readReadings();
  assert.equal(asked(), 1, "most containers have no mod, so they are not asked every time");

  // The mod is installed and the session takes a turn.
  docker.files[USAGE_FILE] = written(12);
  now += 41_000;
  assert.equal((await containers.readReadings()).size, 1);
  assert.equal(asked(), 2);

  now += 20_000;
  await containers.readReadings();
  assert.equal(asked(), 3, "a session that has a reading is read every time");
});

test("a session that reports no id is not asked for a reading", async () => {
  const docker = fakeDocker();
  const containers = new DevContainers(() => NOW, docker);
  assert.equal((await containers.readReadings()).size, 0);
  assert.ok(!docker.calls.some((call) => call.startsWith("cat")));
});

test("container sessions count as VS Code sessions and never consult the Mac's processes", async () => {
  const docker = fakeDocker();
  const containers = new DevContainers(() => NOW, docker);
  let tableReads = 0;
  const monitor = new SessionMonitor({
    listSessions: () => containers.listSessions(),
    readProcessTable: async () => {
      tableReads += 1;
      return new Map();
    },
    isAlive: () => true,
    watch: () => ({ close() {} }),
    now: () => NOW,
    classify: () => "vscode",
    poll: { activeMs: 2_500, idleMs: 3_500 },
  });
  await monitor.refreshNow();
  await monitor.refreshNow();
  assert.deepEqual(
    monitor.sessions.map((tracked) => [tracked.client, tracked.memo.base, tracked.key.startsWith("ctr:a1b2c3d4e5f6:")]),
    [["vscode", "working", true]],
  );
  assert.equal(tableReads, 1, "only for the first sighting, and the answer is not used");
});

// --- several sources as one ---

/** @param {SessionInfo[]} listed */
function monitorOf(listed) {
  const state = { running: false };
  const monitor = new SessionMonitor({
    listSessions: async () => listed,
    readProcessTable: async () => new Map(),
    isAlive: () => true,
    watch: () => {
      state.running = true;
      return {
        close() {
          state.running = false;
        },
      };
    },
    now: () => NOW,
    classify: () => "vscode",
  });
  return { monitor, state };
}

test("both sources are presented as one list", async () => {
  const mac = monitorOf([{ pid: 1, startedAt: 1, status: "idle" }]);
  const containers = monitorOf([{ pid: 1, startedAt: 1, status: "busy", container: { id: "a1b2c3d4e5f6", localFolder: "/x" } }]);
  const set = new MonitorSet(mac.monitor, containers.monitor);
  let changes = 0;
  set.onChange(() => {
    changes += 1;
  });
  await mac.monitor.refreshNow();
  await containers.monitor.refreshNow();
  assert.equal(set.sessions.length, 2);
  assert.equal(changes, 2);
  assert.equal(set.healthy, true);
});

test("containers are only asked while a VS Code key is visible", () => {
  const mac = monitorOf([]);
  const containers = monitorOf([]);
  const set = new MonitorSet(mac.monitor, containers.monitor);

  set.watch({ desktop: 1, vscode: 0 });
  assert.deepEqual([mac.state.running, containers.state.running], [true, false]);
  set.watch({ desktop: 0, vscode: 1 });
  assert.deepEqual([mac.state.running, containers.state.running], [true, true], "VS Code can also run sessions on the Mac");
  set.watch({ desktop: 0, vscode: 0 });
  assert.deepEqual([mac.state.running, containers.state.running], [false, false]);
});

// --- plan usage ---

/**
 * @param {number} percent
 * @param {number} writtenAt
 * @returns {Reading}
 */
const fiveHour = (percent, writtenAt) =>
  /** @type {Reading} */ (parseReading(JSON.stringify({ writtenAt, limits: [{ kind: "five_hour", percentUsed: percent, resetsAt: NOW + 3_600_000 }] })));

/** @param {Map<string, Reading | null>} files */
function usageOf(files) {
  const state = { watching: false, prepared: 0, changes: 0 };
  const usage = new UsageMonitor({
    read: () => files,
    watch: () => {
      state.watching = true;
      return {
        close() {
          state.watching = false;
        },
      };
    },
    prepare: () => {
      state.prepared += 1;
    },
    now: () => NOW,
  });
  usage.onChange(() => {
    state.changes += 1;
  });
  return { usage, state };
}

test("the first quota key starts the watching and the last one stops it", () => {
  const { usage, state } = usageOf(new Map([["a.json", fiveHour(40, NOW - 1000)]]));
  usage.acquire();
  usage.acquire();
  assert.equal(state.watching, true);
  assert.equal(state.prepared, 1);
  const view = usage.view("five_hour");
  assert.equal(view.status === "ok" && view.percent, 40);

  usage.release();
  assert.equal(state.watching, true);
  usage.release();
  assert.equal(state.watching, false);
});

test("a file caught half written keeps its previous reading", () => {
  /** @type {Map<string, Reading | null>} */
  const files = new Map([["a.json", fiveHour(40, NOW - 1000)]]);
  const { usage } = usageOf(files);
  usage.acquire();

  files.set("a.json", null);
  usage.refresh();
  const kept = usage.view("five_hour");
  assert.equal(kept.status === "ok" && kept.percent, 40);

  files.delete("a.json");
  usage.refresh();
  assert.equal(usage.view("five_hour").status, "none", "a removed file is forgotten");
  usage.release();
});

test("a session's earlier readings are kept, so the pace of the last hour is known", () => {
  /** @type {Map<string, Reading | null>} */
  const files = new Map([["a.json", fiveHour(10, NOW - 70 * 60_000)]]);
  const { usage } = usageOf(files);
  usage.acquire();
  assert.equal(usage.pace("five_hour")?.fullAt, undefined, "one reading shows no use");

  // The session writes over its file; the reading from 70 minutes ago is gone from disk.
  files.set("a.json", fiveHour(70, NOW - 1000));
  usage.refresh();
  const pace = usage.pace("five_hour");
  assert.ok(pace?.fullAt !== undefined, "60% in 70 minutes does not last the hour that is left");
  assert.equal(Math.round((pace.fullAt - NOW) / 60_000), 35);
  usage.release();
});

test("readings from Dev Containers count like those on the Mac: the newest wins", async () => {
  /** @type {Map<string, Reading>} */
  let elsewhere = new Map([["ctr:one", fiveHour(55, NOW - 500)]]);
  const state = { changes: 0, fetches: 0 };
  const usage = new UsageMonitor({
    read: () => new Map([["a.json", fiveHour(40, NOW - 60_000)]]),
    watch: () => ({ close() {} }),
    prepare: () => {},
    now: () => NOW,
    readElsewhere: async () => {
      state.fetches += 1;
      return elsewhere;
    },
  });
  usage.onChange(() => {
    state.changes += 1;
  });

  await usage.fetchElsewhere();
  assert.equal(state.fetches, 0, "nothing is fetched while no quota key is visible");

  usage.acquire();
  await usage.fetchElsewhere();
  const view = usage.view("five_hour");
  assert.equal(view.status === "ok" && view.percent, 55, "the container's reading is newer");

  const before = state.changes;
  await usage.fetchElsewhere();
  assert.equal(state.changes, before, "an unchanged reading does not redraw the keys");

  elsewhere = new Map();
  await usage.fetchElsewhere();
  const back = usage.view("five_hour");
  assert.equal(back.status === "ok" && back.percent, 40, "a session that is gone no longer counts");
  usage.release();
});

test("a failed fetch keeps what was fetched before", async () => {
  let fail = false;
  const usage = new UsageMonitor({
    read: () => new Map(),
    watch: () => ({ close() {} }),
    prepare: () => {},
    now: () => NOW,
    readElsewhere: async () => {
      if (fail) throw new Error("docker is not running");
      return new Map([["ctr:one", fiveHour(55, NOW - 500)]]);
    },
  });
  usage.acquire();
  await usage.fetchElsewhere();
  fail = true;
  await usage.fetchElsewhere();
  const view = usage.view("five_hour");
  assert.equal(view.status === "ok" && view.percent, 55);
  usage.release();
});

test("what a quota key says for each kind of reading", () => {
  assert.deepEqual(describeLimit("5h", { status: "none" }), { title: "5h", footer: "no data" });
  assert.deepEqual(describeLimit("5h", { status: "reset" }), { title: "5h", percent: 0, footer: "reset" });
  assert.deepEqual(
    describeLimit("7d", { status: "ok", percent: 41.2, resetsInMs: 76 * 3_600_000, writtenAt: NOW, stale: false }),
    { title: "7d", percent: 41.2, footer: "3d 4h" },
  );
  const old = new Date(2026, 9, 8, 9, 5).getTime();
  assert.deepEqual(describeLimit("7d", { status: "ok", percent: 41.2, resetsInMs: 3_600_000, writtenAt: old, stale: true }), {
    title: "7d",
    percent: 41.2,
    footer: "as of 09:05",
  });
});
