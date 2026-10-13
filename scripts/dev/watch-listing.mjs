// Shows what Claude Code does when the plugin asks it for the list of
// sessions: which programs it starts in turn, and which internet connections
// it opens. Claude Code is started the way the plugin starts it, with
// `agents --json`, several times with the plugin's setting against needless
// traffic and several times without, and this reports what the Mac's own
// `ps` and `lsof` saw meanwhile. It changes nothing and needs no admin
// rights. A development aid.
//
//   node scripts/dev/watch-listing.mjs [runs]
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { findBinaries } from "../../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/claude-cli.js";

const QUIET = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";
/** The environment `bin/adapters/exec.js` gives Claude Code, without the setting. */
const ENV = { HOME: os.homedir(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
const LOOK_EVERY_MS = 8;
const runs = Number(process.argv[2] ?? 10);

/**
 * @param {string} file
 * @param {string[]} args
 * @returns {Promise<string>} stdout; empty if the program failed
 */
function output(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }, (_error, stdout) => resolve(stdout ?? ""));
  });
}

/**
 * Starts one listing and looks at the process list and at the listing's
 * sockets until it ends.
 *
 * @param {string} binary
 * @param {Record<string, string>} env
 * @returns {Promise<{ programs: string[], connections: string[], ok: boolean }>}
 */
async function watchOne(binary, env) {
  const child = spawn(binary, ["agents", "--json"], { env, stdio: ["ignore", "pipe", "ignore"] });
  const pid = /** @type {number} */ (child.pid);
  let listed = "";
  child.stdout.on("data", (data) => (listed += data));
  let over = false;
  child.on("exit", () => (over = true));

  /** @type {Map<number, string>} every process below the listing, by process id */
  const below = new Map();
  /** @type {Set<string>} */
  const connections = new Set();
  /** @type {Promise<void>[]} */
  const looks = [];
  while (!over) {
    looks.push(
      output("/bin/ps", ["-axo", "pid=,ppid=,comm="]).then((table) => {
        const family = new Set([pid, ...below.keys()]);
        // Twice, so that a child of a child is found in the same look.
        for (let pass = 0; pass < 2; pass++) {
          for (const line of table.split("\n")) {
            const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
            if (match === null || !family.has(Number(match[2])) || Number(match[1]) === pid) continue;
            family.add(Number(match[1]));
            const name = path.basename(match[3].trim().replace(/^\((.*)\)$/, "$1"));
            // A process is named after its parent for an instant, until its own program has loaded.
            if (name !== "" && name !== "<defunct>" && (name !== "claude" || !below.has(Number(match[1])))) below.set(Number(match[1]), name);
          }
        }
      }),
      output("/usr/sbin/lsof", ["-nP", "-a", "-p", String(pid), "-i"]).then((text) => {
        for (const line of text.split("\n").slice(1)) {
          const match = /\s(TCP|UDP)\s+\S*->(\S+)/.exec(line);
          if (match !== null) connections.add(match[2]);
        }
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS));
  }
  await Promise.all(looks);
  let ok = false;
  try {
    ok = Array.isArray(JSON.parse(listed));
  } catch {
    // not a list
  }
  return { programs: [...below.values()].filter((name) => name !== "claude"), connections: [...connections], ok };
}

/**
 * @param {string} title
 * @param {string} binary
 * @param {Record<string, string>} env
 */
async function report(title, binary, env) {
  /** @type {Map<string, { runs: number, times: number }>} */
  const programs = new Map();
  /** @type {Map<string, number>} */
  const connections = new Map();
  let worked = 0;
  for (let run = 0; run < runs; run++) {
    const seen = await watchOne(binary, env);
    if (seen.ok) worked += 1;
    for (const name of new Set(seen.programs)) {
      const entry = programs.get(name) ?? { runs: 0, times: 0 };
      entry.runs += 1;
      entry.times += seen.programs.filter((other) => other === name).length;
      programs.set(name, entry);
    }
    for (const address of seen.connections) connections.set(address, (connections.get(address) ?? 0) + 1);
  }
  console.log(`\n${title}: ${runs} listings, ${worked} of them returned the list`);
  const started = [...programs].map(([name, { runs: inRuns, times }]) => `${name} (in ${inRuns} of ${runs}, ${times} times in all)`);
  console.log(`  programs it started:   ${started.length === 0 ? "none seen" : started.join(", ")}`);
  const reached = [...connections].map(([address, inRuns]) => `${address} (in ${inRuns} of ${runs})`);
  console.log(`  internet connections:  ${reached.length === 0 ? "none seen" : reached.join(", ")}`);
}

const [newest] = findBinaries(os.homedir());
if (newest === undefined) {
  console.error("No Claude Code was found on this Mac.");
  process.exit(1);
}
console.log(`Claude Code ${newest.version.join(".")}`);
console.log(newest.file);
await report(`As the plugin starts it, with ${QUIET}=1`, newest.file, { ...ENV, [QUIET]: "1" });
await report("Without that setting", newest.file, ENV);
console.log(`\nThis looks every ${LOOK_EVERY_MS} ms, so something that came and went between two looks is not listed.`);
