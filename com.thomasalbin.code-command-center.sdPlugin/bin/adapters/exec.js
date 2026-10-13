// @ts-check
import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import path from "node:path";
import { CLAUDE_DESKTOP, isSessionId } from "../core/focus.js";
import { isClaudeInContainer, isContainerId, isContainerUser, isUsageFileInContainer } from "../core/parse-docker.js";
import { isDevContainerAddress } from "../core/vscode-windows.js";

// The only place this plugin starts other programs. It can start five, each
// with a fixed shape of arguments:
//
//   Claude Code   agents --json                        list sessions on this Mac
//   ps            -axo pid=,ppid=,comm=                see which app owns a session
//   open          -b <Claude or VS Code> [folder]      bring an app to the front
//                 -b <Claude> claude://resume?session=<id>   have Claude show a session it runs
//   docker        ps | top | exec ... agents --json    list sessions in Dev Containers
//                 exec ... /bin/cat <reading>          read the usage a session there reported
//                 (both as the user the Claude Code there belongs to, where its home folder shows who that is)
//   code          --folder-uri <Dev Container address> bring a container's window forward
//
// What these programs do in turn is theirs. Claude Code, each time it is
// started for a listing, looks up its own sign-in in the Keychain (it runs
// `/usr/bin/security`) and runs `git` and `ps`. It would also open a
// connection to Anthropic; QUIET below is its own setting against that.

const PS = "/bin/ps";
const OPEN = "/usr/bin/open";
const APPS = new Set(["com.anthropic.claudefordesktop", "com.microsoft.VSCode"]);
const DOCKER_LOCATIONS = [
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
  "/Applications/Docker.app/Contents/Resources/bin/docker",
];
const CODE_LOCATIONS = ["/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"];

/** Children get a minimal environment; none of these calls needs more than HOME. */
const ENV = { HOME: process.env.HOME ?? "", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
/**
 * Claude Code's documented setting against traffic it does not need. A
 * listing needs none, yet without the setting every start of Claude Code
 * opens a connection to Anthropic.
 */
const QUIET = "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC";

/**
 * @param {string} file
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {Record<string, string>} [env]
 * @returns {Promise<string>} stdout
 */
function run(file, args, timeoutMs, env = ENV) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

/**
 * @param {string[]} locations
 * @returns {string | undefined} the first that exists and can be run
 */
function firstExecutable(locations) {
  return locations.find((file) => {
    try {
      accessSync(file, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * Lists Claude Code sessions. The arguments are exactly `agents --json`:
 * that call needs no login and sends nothing into a session, which is not
 * true of others.
 *
 * @param {string} binary a Claude Code executable found by `claude-cli.js`
 * @returns {Promise<string>}
 */
export function claudeAgentsJson(binary) {
  if (!path.isAbsolute(binary) || path.basename(binary) !== "claude") {
    return Promise.reject(new Error("not a Claude Code executable"));
  }
  return run(binary, ["agents", "--json"], 5000, { ...ENV, [QUIET]: "1" });
}

/**
 * @returns {Promise<string>} pid, parent pid and executable of every process
 */
export function processTable() {
  return run(PS, ["-axo", "pid=,ppid=,comm="], 3000);
}

/**
 * Brings Claude or VS Code to the front, optionally on a folder.
 *
 * @param {string} bundleId
 * @param {string} [folder]
 * @returns {Promise<void>}
 */
export async function openApp(bundleId, folder) {
  if (!APPS.has(bundleId)) throw new Error("not an app this plugin opens");
  const args = ["-b", bundleId];
  if (folder !== undefined) {
    if (!path.isAbsolute(folder)) throw new Error("folder must be an absolute path");
    args.push(folder);
  }
  await run(OPEN, args, 5000);
}

/**
 * Brings the Claude app to the front on one of the Claude Code sessions it
 * runs. The link carries the session's id and nothing else.
 *
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function openClaudeSession(sessionId) {
  if (!isSessionId(sessionId)) throw new Error("not a session id");
  await run(OPEN, ["-b", CLAUDE_DESKTOP, `claude://resume?session=${sessionId}`], 5000);
}

/**
 * @param {string[]} args
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
function docker(args, timeoutMs) {
  const file = firstExecutable(DOCKER_LOCATIONS);
  if (file === undefined) return Promise.reject(new Error("docker is not installed"));
  return run(file, args, timeoutMs);
}

/**
 * @returns {Promise<string>} one `<container id><tab><folder on this Mac>` line per running Dev Container
 */
export function dockerDevContainers() {
  const format = '{{.ID}}\t{{.Label "devcontainer.local_folder"}}';
  return docker(["ps", "--filter", "label=devcontainer.local_folder", "--format", format], 5000);
}

/**
 * @param {string} containerId
 * @returns {Promise<string>} pid and command line of every process in the container
 */
export function dockerProcesses(containerId) {
  if (!isContainerId(containerId)) return Promise.reject(new Error("not a container id"));
  return docker(["top", containerId, "-eo", "pid,args"], 5000);
}

/**
 * Lists the Claude Code sessions inside a Dev Container, with the same call
 * and the same setting as on the Mac. The Claude Code that is started is the
 * one VS Code's extension installed there, and no other program.
 *
 * @param {string} containerId
 * @param {string} binary Claude Code inside the container
 * @param {string} [user] the user to ask as; the container's own when left out
 * @returns {Promise<string>}
 */
export function dockerClaudeAgentsJson(containerId, binary, user) {
  if (!isContainerId(containerId)) return Promise.reject(new Error("not a container id"));
  if (!isClaudeInContainer(binary)) return Promise.reject(new Error("not Claude Code in a container"));
  if (user !== undefined && !isContainerUser(user)) return Promise.reject(new Error("not a user name"));
  return docker(["exec", ...as(user), "-e", `${QUIET}=1`, containerId, binary, "agents", "--json"], 8000);
}

/**
 * Reads the usage reading that the `deck-bridge` mod wrote for one session
 * inside a Dev Container. The file's place is fixed by pattern; nothing else
 * in a container is ever read.
 *
 * @param {string} containerId
 * @param {string} file the reading inside the container
 * @param {string} [user] the user to read as; the container's own when left out
 * @returns {Promise<string>}
 */
export function dockerReadUsage(containerId, file, user) {
  if (!isContainerId(containerId)) return Promise.reject(new Error("not a container id"));
  if (!isUsageFileInContainer(file)) return Promise.reject(new Error("not a usage reading in a container"));
  if (user !== undefined && !isContainerUser(user)) return Promise.reject(new Error("not a user name"));
  return docker(["exec", ...as(user), containerId, "/bin/cat", file], 5000);
}

/**
 * @param {string | undefined} user
 * @returns {string[]} the arguments that make `docker exec` run as that user
 */
function as(user) {
  return user === undefined ? [] : ["-u", user];
}

/**
 * Asks VS Code to bring the window of a Dev Container forward.
 *
 * @param {string} address a `vscode-remote://dev-container…` folder address
 * @returns {Promise<void>}
 */
export async function codeOpenDevContainer(address) {
  if (!isDevContainerAddress(address)) throw new Error("not a Dev Container address");
  const file = firstExecutable(CODE_LOCATIONS);
  if (file === undefined) throw new Error("VS Code is not installed");
  await run(file, ["--folder-uri", address], 10_000);
}
