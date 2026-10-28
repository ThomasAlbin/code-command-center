// @ts-check

/** @typedef {import("./parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("./parse-ps.js").ProcessEntry} ProcessEntry */
/** @typedef {import("./usage.js").Limit} Limit */
/** @typedef {import("./usage.js").LimitView} LimitView */
/** @typedef {import("./usage.js").Reading} Reading */

// The Antigravity CLI has no command that lists its sessions. Instead, the
// bridge in `mod/antigravity-bridge/` runs as the CLI's status line command
// and writes one small file per CLI process, named after its process id. This
// reads those files and judges the processes they name.

/**
 * What the bridge wrote for one CLI process.
 * @typedef {object} AgyStatus
 * @property {string} state the CLI's `agent_state`, such as `working` or `idle`
 * @property {boolean} waiting a tool call waits for the user's approval
 * @property {string} [cwd] the folder the CLI was started in
 */

/** A file of the bridge is named after the process id of its CLI. */
const STATUS_FILE = /^([1-9]\d{0,9})\.json$/;
/** How far up the parent chain to look for the app that holds a CLI's terminal. */
const MAX_DEPTH = 12;

/**
 * The apps whose terminal a CLI can run in, and that a key press brings
 * forward. A fixed list: the plugin opens no app that is not on it.
 */
export const TERMINALS = [
  { folder: "/Terminal.app/", bundleId: "com.apple.Terminal" },
  { folder: "/iTerm.app/", bundleId: "com.googlecode.iterm2" },
  { folder: "/Ghostty.app/", bundleId: "com.mitchellh.ghostty" },
  { folder: "/Warp.app/", bundleId: "dev.warp.Warp-Stable" },
  { folder: "/WezTerm.app/", bundleId: "com.github.wez.wezterm" },
  { folder: "/kitty.app/", bundleId: "net.kovidgoyal.kitty" },
  { folder: "/Alacritty.app/", bundleId: "org.alacritty" },
  { folder: "/Visual Studio Code.app/", bundleId: "com.microsoft.VSCode" },
  { folder: "/Antigravity IDE.app/", bundleId: "com.google.antigravity-ide" },
  { folder: "/Antigravity.app/", bundleId: "com.google.antigravity" },
];

/**
 * @param {string} name a file name in the bridge's folder
 * @returns {number | undefined} the process id it is named after
 */
export function pidOfFile(name) {
  const match = STATUS_FILE.exec(name);
  return match === null ? undefined : Number(match[1]);
}

/**
 * @param {string} text what the bridge wrote
 * @returns {AgyStatus | null} `null` when it is not a file of the bridge
 */
export function parseStatus(text) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return null;
  const { state, waiting, cwd } = /** @type {Record<string, unknown>} */ (data);
  if (typeof state !== "string" || state === "") return null;
  return { state, waiting: waiting === true, cwd: typeof cwd === "string" && cwd.startsWith("/") ? cwd : undefined };
}

/**
 * Whether a process is the Antigravity CLI: `agy` as it is started from a
 * shell, or `antigravity` as its executable is called.
 *
 * @param {string} comm executable, as `ps` shows it
 * @returns {boolean}
 */
export function isAntigravityCli(comm) {
  const name = comm.slice(comm.lastIndexOf("/") + 1);
  return name === "agy" || name === "antigravity";
}

/**
 * The app whose terminal a CLI runs in, judged by its parent processes.
 *
 * @param {number} pid the CLI's process
 * @param {ReadonlyMap<number, ProcessEntry>} table
 * @returns {string | undefined} its bundle id; nothing for a terminal that is not on the list, or under tmux or SSH
 */
export function hostOf(pid, table) {
  let current = table.get(pid)?.ppid;
  for (let depth = 0; depth < MAX_DEPTH && current !== undefined && current > 1; depth++) {
    const entry = table.get(current);
    if (entry === undefined) break;
    const terminal = TERMINALS.find(({ folder }) => entry.comm.includes(folder));
    if (terminal !== undefined) return terminal.bundleId;
    current = entry.ppid;
  }
  return undefined;
}

/**
 * One CLI process as a session, in the terms Claude Code's listing uses, so
 * that the rest of the plugin treats both alike.
 *
 * @param {number} pid
 * @param {AgyStatus} status
 * @param {string} [host] bundle id of the app that holds its terminal
 * @returns {SessionInfo}
 */
export function sessionOf(pid, status, host) {
  return { pid, cwd: status.cwd, host, ...stateOf(status) };
}

/**
 * @param {AgyStatus} status
 * @returns {Pick<SessionInfo, "status" | "waitingFor" | "state">}
 */
function stateOf({ state, waiting }) {
  // While a tool call waits for approval the CLI still says `tool_use`.
  if (waiting) return { status: "waiting", waitingFor: "permission" };
  switch (state) {
    case "idle":
    // Starting up: nothing has been asked of it yet.
    case "initializing":
    case "authenticating":
      return { status: "idle" };
    case "error":
      return { state: "failed" };
  }
  // `working`, `tool_use`, `reviewing`, and whatever a later version adds.
  return { status: "busy" };
}

// The plan's limits. The CLI reports one per group of models and window, such
// as `gemini-5h` or `3p-weekly`, with the share that is left. A limit becomes
// a `Limit` of kind `<window>:<group>`, in the windows' names that the quota
// keys of Claude Code use, so that the same keys, and the same pace, serve.

/** The windows, by the ending of a limit's id. */
const WINDOWS = [
  { ending: "-5h", window: "five_hour" },
  { ending: "-weekly", window: "seven_day" },
];
/** Names of the groups, as short as a key's corner needs. */
const GROUPS = new Map([
  ["gemini", "Gemini"],
  ["3p", "3rd party"],
]);

/**
 * @param {string} text what the bridge wrote into `quota.json`
 * @param {number} writtenAt when it was written, Unix milliseconds
 * @returns {Reading | null} `null` when it is not a file of the bridge
 */
export function parseQuota(text, writtenAt) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const quota = data !== null && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data).quota : undefined;
  if (quota === null || typeof quota !== "object" || Array.isArray(quota)) return null;

  /** @type {Limit[]} */
  const limits = [];
  for (const [id, bucket] of Object.entries(quota)) {
    const match = WINDOWS.find(({ ending }) => id.endsWith(ending) && id.length > ending.length);
    if (match === undefined || bucket === null || typeof bucket !== "object") continue;
    const { remaining_fraction: left, reset_time: resetTime, disabled } = /** @type {Record<string, unknown>} */ (bucket);
    if (disabled === true || typeof left !== "number" || !Number.isFinite(left)) continue;
    const resetsAt = typeof resetTime === "string" ? Date.parse(resetTime) : NaN;
    limits.push({
      kind: `${match.window}:${id.slice(0, -match.ending.length)}`,
      percentUsed: Math.min(100, Math.max(0, (1 - left) * 100)),
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : undefined,
    });
  }
  return { writtenAt, limits };
}

/** The group a quota key shows until another is chosen: the models most use. */
export const DEFAULT_GROUP = "gemini";

/**
 * Reads the chosen group out of a quota key's stored settings, which could hold anything.
 *
 * @param {unknown} settings
 * @returns {string} a group as the CLI names it
 */
export function groupOf(settings) {
  const group = settings !== null && typeof settings === "object" ? /** @type {Record<string, unknown>} */ (settings).group : undefined;
  return typeof group === "string" && /^[a-z0-9][a-z0-9-]{0,40}$/.test(group) ? group : DEFAULT_GROUP;
}

/**
 * The groups a quota key can be set to: those with a limit in its window,
 * and the key's own choice when there is no reading of it yet.
 *
 * @param {Iterable<string>} kinds the kinds of limit known
 * @param {string} window `five_hour` or `seven_day`
 * @param {string} chosen the key's group
 * @returns {Array<{ id: string, label: string }>} the default group first, then by name
 */
export function groupsIn(kinds, window, chosen) {
  const ids = new Set([chosen]);
  for (const kind of kinds) if (kind.startsWith(`${window}:`)) ids.add(kind.slice(window.length + 1));
  return [...ids]
    .map((id) => ({ id, label: groupLabel(id) }))
    .sort((a, b) => Number(b.id === DEFAULT_GROUP) - Number(a.id === DEFAULT_GROUP) || a.label.localeCompare(b.label));
}

/**
 * @param {string} group as the CLI names it, such as `gemini` or `gemini-argon-wtu`
 * @returns {string} for the corner of a key, such as `Gemini` or `Argon`
 */
export function groupLabel(group) {
  const known = GROUPS.get(group);
  if (known !== undefined) return known;
  // A model with a limit of its own, such as `gemini-argon-wtu`, is named after the model.
  const [first, second] = group.split("-");
  const word = (first === "gemini" && second !== undefined ? second : first).replace(/[^A-Za-z0-9]/g, "").slice(0, 9);
  return word.charAt(0).toUpperCase() + word.slice(1);
}
