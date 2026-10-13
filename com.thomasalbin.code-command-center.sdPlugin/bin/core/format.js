// @ts-check

/** Width and height of a key image. Stream Deck scales it down to the 72 px key. */
export const KEY_SIZE = 144;

const PADDING = 10;
/** Room for one line of text on a key. */
export const LINE_WIDTH = KEY_SIZE - 2 * PADDING;
const ONE_LINE_SIZES = [34, 30, 26, 24, 22];
const TWO_LINE_SIZES = [26, 24, 22, 20];
/** The smallest type a label is set in. */
export const SMALLEST = TWO_LINE_SIZES[TWO_LINE_SIZES.length - 1];
const BREAK_AFTER = new Set(["-", "_", ".", " ", "/"]);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** More characters than two lines of a key can show, so nothing is lost by stopping here. */
const LONGEST = 64;
/** Control characters, halves of a broken pair, and marks that reorder text: none belongs on a key. */
const UNPRINTABLE = /[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\p{Bidi_Control}\p{Noncharacter_Code_Point}]+/gu;

/**
 * Makes text that came from outside fit to set on a key. A folder name or a
 * label of a container can be any length and hold any character; an image
 * cannot, and fitting text takes longer the longer it is.
 *
 * @param {string} text
 * @returns {string} at most LONGEST characters, none of them unprintable
 */
export function tidy(text) {
  const cleaned = text.slice(0, 4 * LONGEST).replace(UNPRINTABLE, " ").replace(/\s+/g, " ").trim();
  return [...cleaned].slice(0, LONGEST).join("").trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeXml(text) {
  return text.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });
}

/**
 * Last segment of a path, which is how a project is usually known.
 * @param {string | undefined} cwd
 * @returns {string}
 */
export function folderLabel(cwd) {
  if (cwd === undefined || cwd === "") return "";
  // Only the end of the path matters, however long the rest is.
  const segments = cwd.slice(-16 * LONGEST).split("/").filter((segment) => segment !== "");
  return segments.length === 0 ? "/" : tidy(segments[segments.length - 1]);
}

/**
 * @param {number} ms time left
 * @returns {string} such as `42m`, `2h 13m` or `3d 4h`
 */
export function formatCountdown(ms) {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

/**
 * @param {number} ms time that has passed
 * @returns {string} such as `12m`, `1h05` or `11h`, short enough for the corner of a key; empty during the first minute
 */
export function formatElapsed(ms) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 10 ? `${hours}h${String(minutes % 60).padStart(2, "0")}` : `${hours}h`;
}

/**
 * @param {number} timestamp Unix milliseconds
 * @returns {string} local time of day, such as `14:05`
 */
export function formatClock(timestamp) {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * @param {number} timestamp Unix milliseconds
 * @returns {string} local day and time, such as `Sat 18:00`
 */
export function formatDayClock(timestamp) {
  return `${DAYS[new Date(timestamp).getDay()]} ${formatClock(timestamp)}`;
}

/**
 * What a session waits for, in one word. Claude Code says `permission prompt`
 * or `dialog open`; a key has room for the first word.
 *
 * @param {string | undefined} waitingFor
 * @returns {string} lower case, empty when nothing is known
 */
export function reasonWord(waitingFor) {
  const word = /[A-Za-z]+/.exec(tidy(waitingFor ?? ""))?.[0].toLowerCase() ?? "";
  return word === "" ? "" : longestPrefix(word, SMALLEST);
}

/**
 * @typedef {object} FittedLabel
 * @property {string[]} lines at most two
 * @property {number} fontSize 0 when there is nothing to draw
 */

/**
 * Picks the largest type that shows `text` on a key, on one line when it is
 * short and on two when it has a natural break.
 *
 * @param {string} text
 * @returns {FittedLabel}
 */
export function fitLabel(text) {
  const label = tidy(text);
  if (label === "") return { lines: [], fontSize: 0 };

  for (const fontSize of ONE_LINE_SIZES) {
    if (fits(label, fontSize)) return { lines: [label], fontSize };
  }
  for (const fontSize of TWO_LINE_SIZES) {
    const lines = splitAtBreak(label, fontSize);
    if (lines !== undefined) return { lines, fontSize };
  }

  // No break fits: wrap at the smallest size and cut what is left over.
  const first = longestPrefix(label, SMALLEST);
  const rest = label.slice(first.length);
  if (rest === "") return { lines: [first], fontSize: SMALLEST };
  const second = fits(rest, SMALLEST) ? rest : `${longestPrefix(rest, SMALLEST, "…")}…`;
  return { lines: [first, second], fontSize: SMALLEST };
}

/**
 * Estimated width of bold sans-serif text, in the units of the key image.
 * Close enough to Helvetica Bold to decide what fits.
 *
 * @param {string} text
 * @param {number} fontSize
 * @returns {number}
 */
export function textWidth(text, fontSize) {
  let ems = 0;
  for (const character of text) ems += characterWidth(character);
  return ems * fontSize;
}

/**
 * @param {string} character
 * @returns {number} width as a fraction of the font size
 */
function characterWidth(character) {
  if ("ijlI|'.,:;! ".includes(character)) return 0.28;
  if ("tfr-_()[]/".includes(character)) return 0.36;
  if ("mMW".includes(character)) return 0.9;
  if (character === "w") return 0.78;
  if (character >= "A" && character <= "Z") return 0.72;
  if (character === "…") return 1;
  return 0.58;
}

/**
 * @param {string} text
 * @param {number} fontSize
 * @returns {boolean}
 */
function fits(text, fontSize) {
  return textWidth(text, fontSize) <= LINE_WIDTH;
}

/**
 * @param {string} text
 * @param {number} fontSize
 * @param {string} [suffix] room to leave at the end
 * @returns {string} as much of the start of `text` as fits, at least one character
 */
function longestPrefix(text, fontSize, suffix = "") {
  let end = text.length;
  while (end > 1 && !fits(text.slice(0, end) + suffix, fontSize)) end--;
  return text.slice(0, end);
}

/**
 * @param {string} label
 * @param {number} fontSize
 * @returns {string[] | undefined} the most even two-line split at a separator, if one fits
 */
function splitAtBreak(label, fontSize) {
  /** @type {string[] | undefined} */
  let best;
  let bestDifference = Infinity;
  for (let index = 1; index < label.length; index++) {
    if (!BREAK_AFTER.has(label[index - 1])) continue;
    const first = label.slice(0, index).trimEnd();
    const second = label.slice(index).trimStart();
    if (first === "" || second === "" || !fits(first, fontSize) || !fits(second, fontSize)) continue;
    const difference = Math.abs(textWidth(first, fontSize) - textWidth(second, fontSize));
    if (difference < bestDifference) {
      best = [first, second];
      bestDifference = difference;
    }
  }
  return best;
}
