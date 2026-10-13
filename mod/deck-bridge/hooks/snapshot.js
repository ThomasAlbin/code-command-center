// Helpers for register.js. They take plain values and return text; they have
// no access to Claude Code.

/** The two plan limits the Stream Deck keys show. Anything else is left out. */
const KINDS = ["five_hour", "seven_day"];

/**
 * Where one session's reading goes: one small file per session, so sessions
 * never write over each other.
 *
 * @param {string} home the user's home folder
 * @param {string} sessionId
 * @returns {string}
 */
export function fileFor(home, sessionId) {
  const name = String(sessionId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "session";
  return `${home}/.code-command-center/usage/${name}.json`;
}

/**
 * The file's content: when it was written, and for each of the two limits
 * the percent used and the reset time.
 *
 * @param {number} writtenAt Unix milliseconds
 * @param {unknown} rateLimits as `session.measure` reports them
 * @returns {string | undefined} nothing when there is no limit to report, so an earlier reading is kept
 */
export function snapshot(writtenAt, rateLimits) {
  const limits = [];
  for (const limit of Array.isArray(rateLimits) ? rateLimits : []) {
    if (limit === null || typeof limit !== "object") continue;
    const { kind, percentUsed, resetsAt } = limit;
    if (!KINDS.includes(kind) || typeof percentUsed !== "number") continue;
    limits.push({ kind, percentUsed, resetsAt: typeof resetsAt === "string" ? resetsAt : undefined });
  }
  return limits.length === 0 ? undefined : JSON.stringify({ v: 1, writtenAt, limits });
}
