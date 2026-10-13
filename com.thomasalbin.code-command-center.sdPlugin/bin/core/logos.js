// @ts-check

/** @typedef {"desktop" | "vscode"} App */

/**
 * @typedef {object} Logo
 * @property {string} d outline, as SVG path data with every number written out
 * @property {number} width width of the box the outline is drawn in
 * @property {number} height height of that box
 * @property {"nonzero" | "evenodd"} rule how the outline is filled
 */

/**
 * The marks this plugin draws by itself: a sparkle for the Claude app and a
 * pair of angle brackets for VS Code. They are plain shapes of its own. The
 * apps' logos belong to their owners and are not part of this project; where
 * an app is installed, its logo is read from the app instead (see
 * `adapters/local-logos.js`).
 *
 * @type {Record<App, Logo>}
 */
export const LOGOS = {
  desktop: {
    d: "M 12 1 C 12.8 7.5 16.5 11.2 23 12 C 16.5 12.8 12.8 16.5 12 23 C 11.2 16.5 7.5 12.8 1 12 C 7.5 11.2 11.2 7.5 12 1 Z",
    width: 24,
    height: 24,
    rule: "nonzero",
  },
  vscode: {
    d: "M 8 5.5 L 1.5 12 L 8 18.5 L 9.8 16.7 L 5.1 12 L 9.8 7.3 Z M 16 5.5 L 22.5 12 L 16 18.5 L 14.2 16.7 L 18.9 12 L 14.2 7.3 Z",
    width: 24,
    height: 24,
    rule: "nonzero",
  },
};

/** A logo file is small. Anything larger is not read as one. */
const MAX_SVG_LENGTH = 64_000;

/**
 * Reads the outline of a logo from an SVG file: its first path, and the box
 * the file says it is drawn in.
 *
 * @param {string} svg the file's text
 * @returns {Logo | undefined} nothing if the file is not a simple one-path logo
 */
export function outlineOf(svg) {
  if (svg.length > MAX_SVG_LENGTH) return undefined;
  const box = /\bviewBox="\s*0[\s,]+0[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)\s*"/.exec(svg);
  const path = /<path\b[^>]*?\sd="([^"]+)"[^>]*>/.exec(svg);
  if (box === null || path === null) return undefined;
  const d = spellOut(path[1]);
  const [width, height] = [Number(box[1]), Number(box[2])];
  if (d === undefined || !(width > 0) || !(height > 0)) return undefined;
  return { d, width, height, rule: /\bfill-rule="evenodd"/.test(path[0]) ? "evenodd" : "nonzero" };
}

/**
 * Rewrites path data with every number and flag on its own. Logo files pack
 * them together (`0 01-.104`), which not every SVG renderer reads correctly.
 * The result holds command letters and numbers only, so it is safe to put
 * into an image.
 *
 * @param {string} d
 * @returns {string | undefined} nothing if it is not path data
 */
export function spellOut(d) {
  const number = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y;
  /** @type {string[]} */
  const parts = [];
  let command = "";
  let argument = 0;
  for (let at = 0; at < d.length; ) {
    const character = d[at];
    if (/[\s,]/.test(character)) {
      at += 1;
    } else if (/[MmLlHhVvCcSsQqTtAaZz]/.test(character)) {
      command = character;
      argument = 0;
      parts.push(character);
      at += 1;
    } else if (command.toLowerCase() === "a" && (argument % 7 === 3 || argument % 7 === 4)) {
      // The two flags of an arc are single digits, whatever follows them.
      if (character !== "0" && character !== "1") return undefined;
      parts.push(character);
      argument += 1;
      at += 1;
    } else {
      number.lastIndex = at;
      const match = number.exec(d);
      if (match === null || command === "") return undefined;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) return undefined;
      parts.push(String(value));
      argument += 1;
      at = number.lastIndex;
    }
  }
  return parts.length === 0 ? undefined : parts.join(" ");
}
