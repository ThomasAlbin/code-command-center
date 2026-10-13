// @ts-check

/** @typedef {import("./parse-agents.js").SessionInfo} SessionInfo */
/** @typedef {import("./parse-ps.js").Client} Client */

export const CLAUDE_DESKTOP = "com.anthropic.claudefordesktop";
export const VS_CODE = "com.microsoft.VSCode";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} value
 * @returns {value is string} whether it has the form of a Claude Code session id
 */
export function isSessionId(value) {
  return typeof value === "string" && SESSION_ID.test(value);
}

/**
 * @typedef {object} FocusTarget
 * @property {string} bundleId app to bring to the front
 * @property {string} [session] id of the Claude Code session the Claude app should show
 * @property {string} [folder] folder on this Mac whose window should come forward
 * @property {{ localFolder: string, path?: string }} [devContainer] Dev Container whose window should come forward
 */

/**
 * What a key press should bring to the front.
 *
 * @param {Client} client
 * @param {SessionInfo} [session] the session on the key, if any
 * @param {string} [pin] the project the key is reserved for, if any
 * @returns {FocusTarget | undefined}
 */
export function focusTarget(client, session, pin) {
  if (client === "desktop") {
    // Asked for a session it does not run, the Claude app would import it. So it is only
    // asked for a live, interactive session, which on a desktop key is one it started itself.
    const live = session?.pid !== undefined && session.kind === "interactive";
    return live && isSessionId(session?.sessionId) ? { bundleId: CLAUDE_DESKTOP, session: session.sessionId } : { bundleId: CLAUDE_DESKTOP };
  }
  if (client !== "vscode") return undefined;

  if (session?.container !== undefined) {
    const { localFolder } = session.container;
    return { bundleId: VS_CODE, devContainer: { localFolder, path: session.cwd } };
  }
  if (session?.cwd !== undefined && session.cwd.startsWith("/")) {
    // VS Code focuses the window that already has this exact folder open.
    return { bundleId: VS_CODE, folder: session.cwd };
  }
  if (session === undefined && pin !== undefined && pin.startsWith("/")) {
    // A reserved key without a session opens its project, in its Dev Container if it has one.
    return { bundleId: VS_CODE, folder: pin, devContainer: { localFolder: pin } };
  }
  return { bundleId: VS_CODE };
}
