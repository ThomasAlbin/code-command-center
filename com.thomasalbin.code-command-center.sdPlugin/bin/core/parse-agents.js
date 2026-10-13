// @ts-check

/**
 * One session as reported by `claude agents --json`. Every field is optional:
 * the plugin has to keep working when Claude Code adds, renames or drops one.
 *
 * @typedef {object} SessionInfo
 * @property {number} [pid]
 * @property {string} [cwd]
 * @property {string} [kind] `interactive` or `background`
 * @property {number} [startedAt] Unix milliseconds
 * @property {string} [sessionId]
 * @property {string} [name]
 * @property {string} [status] `busy`, `waiting` or `idle`, while the process is alive
 * @property {string} [waitingFor] what a `waiting` session is blocked on
 * @property {string} [state] background sessions: `working`, `blocked`, `done`, `failed` or `stopped`
 * @property {string} [id] background sessions: short id
 * @property {ContainerRef} [container] set by the plugin for a session that runs inside a Dev Container
 */

/**
 * @typedef {object} ContainerRef
 * @property {string} id Docker container id
 * @property {string} localFolder folder on this Mac that the container was opened from
 */

/**
 * @param {string} stdout
 * @returns {SessionInfo[] | null} `null` when the output is not a JSON array
 */
export function parseAgents(stdout) {
  /** @type {unknown} */
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  /** @type {SessionInfo[]} */
  const sessions = [];
  for (const item of data) {
    if (item === null || typeof item !== "object") continue;
    const record = /** @type {Record<string, unknown>} */ (item);
    sessions.push({
      pid: asNumber(record.pid),
      cwd: asString(record.cwd),
      kind: asString(record.kind),
      startedAt: asNumber(record.startedAt),
      sessionId: asString(record.sessionId),
      name: asString(record.name),
      status: asString(record.status),
      waitingFor: asString(record.waitingFor),
      state: asString(record.state),
      id: asString(record.id),
    });
  }
  return sessions;
}

/**
 * Identity of a session across listings. The pid survives `/clear`, which
 * changes `sessionId`; a background session whose process has exited falls
 * back to its ids.
 *
 * @param {SessionInfo} session
 * @returns {string | undefined}
 */
export function sessionKey(session) {
  // Process ids inside a container are separate from the Mac's.
  const scope = session.container === undefined ? "" : `ctr:${session.container.id}:`;
  if (session.pid !== undefined) return `${scope}pid:${session.pid}:${session.startedAt ?? 0}`;
  if (session.sessionId !== undefined) return `${scope}sid:${session.sessionId}`;
  if (session.id !== undefined) return `${scope}id:${session.id}`;
  return undefined;
}

/**
 * The project a session belongs to, as a folder on this Mac. A key can be
 * pinned to it, and it outlives the session.
 *
 * @param {SessionInfo} session
 * @returns {string | undefined}
 */
export function projectOf(session) {
  return session.container?.localFolder ?? session.cwd;
}

/**
 * @param {unknown} value
 * @returns {number | undefined}
 */
function asNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asString(value) {
  return typeof value === "string" ? value : undefined;
}
