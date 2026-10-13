// @ts-check

/** @typedef {import("./parse-agents.js").SessionInfo} SessionInfo */

/**
 * What Claude Code reports, reduced to what a key can show.
 * @typedef {"working" | "waiting" | "idle" | "error" | "unknown"} BaseState
 */

/**
 * `done` is an idle session that finished while the user was not looking.
 * @typedef {BaseState | "done"} DisplayState
 */

/**
 * What the plugin remembers about one session between listings.
 * @typedef {object} Memo
 * @property {BaseState} base
 * @property {number} lastChange when `base` last changed, Unix milliseconds
 * @property {number} [doneSince] set when the session went quiet and the user has not looked yet
 * @property {number} [turnSince] since when the session has been working or waiting without going quiet
 * @property {number} [waitingSince] since when it has been waiting for the user
 * @property {boolean} [seen] the user looked at the session while it was waiting
 */

/** How long a finished session stays bright green without a key press. */
export const DONE_TTL_MS = 30 * 60 * 1000;
/** A session left waiting this long without the user looking starts to pulse. */
export const NUDGE_AFTER_MS = 5 * 60 * 1000;

/**
 * @param {SessionInfo} session
 * @returns {BaseState}
 */
export function baseState(session) {
  switch (session.status) {
    case "busy":
      return "working";
    case "waiting":
      return "waiting";
    case "idle":
      return "idle";
  }
  // A background session whose process has exited reports `state` only.
  switch (session.state) {
    case "working":
      return "working";
    case "blocked":
      return "waiting";
    case "done":
    case "stopped":
      return "idle";
    case "failed":
      return "error";
  }
  return "unknown";
}

/**
 * @param {Memo | undefined} previous
 * @param {BaseState} base
 * @param {number} now
 * @param {number} [startedAt] when the session started, used the first time it is seen
 * @returns {Memo}
 */
export function advance(previous, base, now, startedAt) {
  // A session first seen idle was not watched finishing, so it is not "done".
  if (previous === undefined) return { base, lastChange: startedAt ?? now, ...clocks(undefined, base, now) };
  if (previous.base === base) return previous;
  const wentQuiet = base === "idle" && (previous.base === "working" || previous.base === "waiting");
  return { base, lastChange: now, ...(wentQuiet ? { doneSince: now } : {}), ...clocks(previous, base, now) };
}

/**
 * The clocks a key shows. Claude Code does not say when a turn began, so they
 * start when the plugin first sees the state, which can be later.
 *
 * @param {Memo | undefined} previous
 * @param {BaseState} base
 * @param {number} now
 * @returns {Pick<Memo, "turnSince" | "waitingSince">}
 */
function clocks(previous, base, now) {
  if (base !== "working" && base !== "waiting") return {};
  // A permission prompt in the middle of a turn does not start a new turn.
  const turnSince = previous?.turnSince ?? now;
  return base === "waiting" ? { turnSince, waitingSince: now } : { turnSince };
}

/**
 * The user looked at the session, for example by pressing its key.
 * @param {Memo} memo
 * @returns {Memo}
 */
export function acknowledge(memo) {
  if (memo.doneSince !== undefined) return { base: memo.base, lastChange: memo.lastChange };
  if (memo.base === "waiting" && memo.seen !== true) return { ...memo, seen: true };
  return memo;
}

/**
 * How long a session has been at it: the whole turn for a working session,
 * the wait for a waiting one.
 *
 * @param {Memo} memo
 * @param {number} now
 * @returns {number | undefined} milliseconds; nothing for a state without a clock
 */
export function elapsed(memo, now) {
  const since = memo.base === "working" ? memo.turnSince : memo.base === "waiting" ? memo.waitingSince : undefined;
  return since === undefined ? undefined : Math.max(0, now - since);
}

/**
 * Whether a session has been left waiting for too long.
 * @param {Memo} memo
 * @param {number} now
 * @param {number} [afterMs]
 * @returns {boolean}
 */
export function overdue(memo, now, afterMs = NUDGE_AFTER_MS) {
  return memo.base === "waiting" && memo.seen !== true && memo.waitingSince !== undefined && now - memo.waitingSince >= afterMs;
}

/**
 * @param {Memo} memo
 * @param {number} now
 * @param {number} [doneTtlMs]
 * @returns {DisplayState}
 */
export function displayState(memo, now, doneTtlMs = DONE_TTL_MS) {
  if (memo.base === "idle" && memo.doneSince !== undefined && now - memo.doneSince < doneTtlMs) {
    return "done";
  }
  return memo.base;
}

/**
 * Which session wins when there are more sessions than keys.
 * @param {DisplayState} state
 * @returns {number}
 */
export function priority(state) {
  switch (state) {
    case "waiting":
      return 3;
    case "working":
    case "done":
    case "error":
      return 2;
    case "idle":
      return 1;
    default:
      return 0;
  }
}
