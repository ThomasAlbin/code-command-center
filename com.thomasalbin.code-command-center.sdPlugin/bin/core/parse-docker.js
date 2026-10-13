// @ts-check

/** @typedef {import("./parse-agents.js").ContainerRef} ContainerRef */

const CONTAINER_ID = /^[0-9a-f]{12,64}$/;

/**
 * Claude Code as VS Code's extension installs it inside a container. Nothing
 * else is ever started in a container, so the shape is strict.
 */
const CLAUDE_IN_CONTAINER =
  /^\/[\w./-]+\/\.vscode-server(-insiders)?\/extensions\/anthropic\.claude-code-\d+\.\d+\.\d+-[\w-]+\/resources\/native-binary\/claude$/;

/**
 * A reading that the `deck-bridge` mod wrote inside a container. The plugin
 * reads such a file and no other, so the shape is strict here as well.
 */
const USAGE_IN_CONTAINER = /^\/[\w./-]+\/\.code-command-center\/usage\/[A-Za-z0-9_-]{1,80}\.json$/;
const SESSION_FILE_NAME = /^[A-Za-z0-9_-]{1,80}$/;
/** A user name as Linux allows them. */
const USER_NAME = /^[a-z_][a-z0-9_-]{0,31}$/;
/** No path on a Mac is longer. A container's label can be, since whoever starts a container writes it. */
const LONGEST_PATH = 1024;

/**
 * @param {string} text
 * @returns {boolean}
 */
export function isContainerId(text) {
  return CONTAINER_ID.test(text);
}

/**
 * @param {string} file path inside a container
 * @returns {boolean}
 */
export function isClaudeInContainer(file) {
  return CLAUDE_IN_CONTAINER.test(file) && !file.includes("..");
}

/**
 * @param {string} file path inside a container
 * @returns {boolean}
 */
export function isUsageFileInContainer(file) {
  return USAGE_IN_CONTAINER.test(file) && !file.includes("..");
}

/**
 * @param {string} text
 * @returns {boolean} whether it has the form of a user name
 */
export function isContainerUser(text) {
  return USER_NAME.test(text);
}

/**
 * The user a Claude Code in a container belongs to, read off the home folder
 * it is installed under: `/root`, or `/home/<name>`. Claude Code keeps each
 * user's sessions apart, so it has to be asked as that user to list them.
 *
 * @param {string} binary Claude Code inside the container
 * @returns {string | undefined} nothing for a home folder in another place
 */
export function userOf(binary) {
  if (!isClaudeInContainer(binary)) return undefined;
  const home = binary.slice(0, binary.indexOf("/.vscode-server"));
  if (home === "/root") return "root";
  const name = /^\/home\/([^/]+)$/.exec(home)?.[1];
  return name !== undefined && isContainerUser(name) ? name : undefined;
}

/**
 * Where the mod in a container writes the reading of one session: under the
 * home folder that holds the Claude Code extension, which is the home of the
 * user the session runs as.
 *
 * @param {string} binary Claude Code inside the container
 * @param {string | undefined} sessionId
 * @returns {string | undefined} nothing unless both have the expected form
 */
export function usageFileIn(binary, sessionId) {
  if (!isClaudeInContainer(binary) || sessionId === undefined || !SESSION_FILE_NAME.test(sessionId)) return undefined;
  const home = binary.slice(0, binary.indexOf("/.vscode-server"));
  const file = `${home}/.code-command-center/usage/${sessionId}.json`;
  return isUsageFileInContainer(file) ? file : undefined;
}

/**
 * @param {string} stdout one `<container id><tab><folder on the Mac>` line per running Dev Container
 * @returns {ContainerRef[]}
 */
export function parseDevContainers(stdout) {
  /** @type {ContainerRef[]} */
  const containers = [];
  for (const line of stdout.split("\n")) {
    const [id, localFolder] = line.trim().split("\t");
    if (id === undefined || localFolder === undefined) continue;
    if (!isContainerId(id) || !localFolder.startsWith("/") || localFolder.length > LONGEST_PATH) continue;
    containers.push({ id, localFolder });
  }
  return containers;
}

/**
 * Finds the Claude Code executable of a running session in a container's
 * process list.
 *
 * @param {string} stdout output of `docker top <id> -eo pid,args`
 * @returns {string | undefined}
 */
export function findClaudeBinary(stdout) {
  for (const line of stdout.split("\n")) {
    const found = line.trim().split(/\s+/).find(isClaudeInContainer);
    if (found !== undefined) return found;
  }
  return undefined;
}
