// @ts-check
import { escapeXml, fitLabel, KEY_SIZE, LINE_WIDTH, SMALLEST, textWidth } from "./format.js";
import { LOGOS } from "./logos.js";

/** @typedef {import("./format.js").FittedLabel} FittedLabel */
/** @typedef {import("./logos.js").App} App */
/** @typedef {import("./logos.js").Logo} Logo */
/** @typedef {Readonly<Record<App, Logo>>} Logos */
/** @typedef {import("./state.js").DisplayState} DisplayState */

const FONT = "Helvetica, Arial, sans-serif";
const CENTRE = KEY_SIZE / 2;
/** Vertical centre of the label area, below the logo. */
const LABEL_CENTRE = 102;
/** How far the small texts in the top corners sit from the edge. */
const CORNER = 10;
/** Where the app's logo sits on a session key: between the two corners, clear of a count and of a clock. */
const LOGO = { cx: 59, cy: 40, size: 44 };

/** @type {Record<DisplayState, { bg: string, fg: string }>} */
const PALETTE = {
  working: { bg: "#1F6FEB", fg: "#FFFFFF" },
  waiting: { bg: "#F0883E", fg: "#1B1300" },
  done: { bg: "#2EA043", fg: "#FFFFFF" },
  idle: { bg: "#12361F", fg: "#8FD9A8" },
  error: { bg: "#DA3633", fg: "#FFFFFF" },
  unknown: { bg: "#30363D", fg: "#C9D1D9" },
};

/** The bright half of the pulse of a session that has waited too long. */
const WAITING_LIT = { bg: "#FFD9A6", fg: "#1B1300" };
/** The frame of such a key. Light, because a dark one would vanish into the gap between keys. */
const RING = "#FFFFFF";
const EMPTY = { bg: "#0D1117", fg: "#484F58" };
/** A pinned key whose project has no session: readable, but clearly not running. */
const NOT_RUNNING = { bg: "#0D1117", fg: "#8B949E" };
const QUOTA = { bg: "#0D1117", title: "#8B949E", value: "#FFFFFF", footer: "#C9D1D9", track: "#30363D" };

/**
 * @typedef {object} SessionKeyView
 * @property {App} app the app the session runs in; the key carries its logo
 * @property {DisplayState} state
 * @property {string} label
 * @property {number} [overflow] sessions of this group that have no key
 * @property {boolean} [pinned] the key is reserved for this project
 * @property {string} [time] how long the session has been working or waiting, such as `12m`
 * @property {string} [reason] what a waiting session waits for, in one word
 * @property {boolean} [urgent] the session has waited long without being looked at
 * @property {boolean} [lit] the bright half of an urgent key's pulse
 */

/**
 * A key showing one session: the logo of its app, and its state as the colour
 * of the key. A waiting session is also told by the reason on its last line.
 *
 * @param {SessionKeyView} view
 * @param {Logos} [logos] the logo of each app; the plugin's own marks unless the apps' logos were found
 * @returns {string} SVG
 */
export function renderSessionKey({ app, state, label, overflow = 0, pinned = false, time = "", reason = "", urgent = false, lit = false }, logos = LOGOS) {
  const { bg, fg } = lit && state === "waiting" ? WAITING_LIT : PALETTE[state];
  const fitted = fitLabel(label);
  // The reason takes the last line, in lighter type, so the label moves up, and one of two lines shrinks.
  const name =
    reason === ""
      ? labelText(fitted, fg)
      : labelText(fitted, fg, fitted.lines.length === 2 ? 90 : 94, SMALLEST) + text(CENTRE, 131, SMALLEST, fg, "middle", reason, 400);
  return frame(
    bg,
    // Without a listing there is no session to show, whichever app the key is for.
    (state === "unknown" ? text(CENTRE, 58, 48, fg, "middle", "?") : logo(logos[app], LOGO.cx, LOGO.cy, LOGO.size, fg)) +
      name +
      // The pin and the count share the left corner: only an automatic key carries a count.
      (overflow > 0 ? text(CORNER, 26, 22, fg, "start", `+${overflow}`) : "") +
      (time === "" ? "" : text(KEY_SIZE - CORNER, 26, 22, fg, "end", time)) +
      (pinned ? pin(fg) : "") +
      (urgent ? ring(lit ? PALETTE.waiting.bg : RING) : ""),
  );
}

/**
 * A key reserved for a project that has no session right now. Laid out like a
 * session key, with the logo as dim as on an empty one.
 *
 * @param {string} label
 * @param {App} app
 * @param {Logos} [logos]
 * @returns {string} SVG
 */
export function renderPinnedEmptyKey(label, app, logos = LOGOS) {
  return frame(
    NOT_RUNNING.bg,
    logo(logos[app], LOGO.cx, LOGO.cy, LOGO.size, EMPTY.fg) + labelText(fitLabel(label), NOT_RUNNING.fg) + pin(NOT_RUNNING.fg),
  );
}

/**
 * @typedef {object} QuotaKeyView
 * @property {string} title which limit, such as `5h`
 * @property {number} [percent] how much is used; nothing while there is no reading
 * @property {string} footer time until the reset, or why there is none
 * @property {number} [even] the percent that even use would have reached by now, drawn as a tick on the bar
 * @property {boolean} [warn] the footer is a warning
 */

/**
 * A key showing how much of a plan limit is used.
 * @param {QuotaKeyView} view
 * @returns {string} SVG
 */
export function renderQuotaKey({ title, percent, footer, even, warn = false }) {
  const used = percent === undefined ? 0 : Math.min(100, Math.max(0, percent));
  const tone = used >= 90 ? PALETTE.error.bg : used >= 70 ? PALETTE.waiting.bg : PALETTE.done.bg;
  const value = percent === undefined ? "–" : `${Math.round(used)}%`;
  const footerSize = textWidth(footer, SMALLEST) > LINE_WIDTH ? 18 : SMALLEST;
  return frame(
    QUOTA.bg,
    text(14, 32, 24, QUOTA.title, "start", title) +
      text(CENTRE, 84, 44, QUOTA.value, "middle", value) +
      `<rect x="12" y="96" width="120" height="10" rx="5" fill="${QUOTA.track}"/>` +
      (used > 0 ? `<rect x="12" y="96" width="${Math.max(10, Math.round(used * 1.2))}" height="10" rx="5" fill="${tone}"/>` : "") +
      (even === undefined ? "" : paceMark(even)) +
      text(CENTRE, 132, footerSize, warn ? PALETTE.waiting.bg : QUOTA.footer, "middle", footer),
  );
}

/**
 * A key with no session on it: the logo and the name of the app it is for.
 * @param {string} caption the app's name
 * @param {App} app
 * @param {Logos} [logos]
 * @returns {string} SVG
 */
export function renderEmptyKey(caption, app, logos = LOGOS) {
  return frame(EMPTY.bg, logo(logos[app], CENTRE, 54, 60, EMPTY.fg) + text(CENTRE, 118, 22, EMPTY.fg, "middle", caption));
}

/**
 * @param {string} svg
 * @returns {string} the form `setImage` accepts
 */
export function svgToDataUri(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * @param {string} bg
 * @param {string} body
 * @returns {string}
 */
function frame(bg, body) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${KEY_SIZE}" height="${KEY_SIZE}" viewBox="0 0 ${KEY_SIZE} ${KEY_SIZE}">` +
    `<rect width="${KEY_SIZE}" height="${KEY_SIZE}" fill="${bg}"/>${body}</svg>`
  );
}

/**
 * A logo, in one colour.
 *
 * @param {Logo} outline
 * @param {number} cx centre
 * @param {number} cy centre
 * @param {number} size width
 * @param {string} fill
 * @returns {string}
 */
function logo(outline, cx, cy, size, fill) {
  const { d, width, height, rule } = outline;
  const scale = size / width;
  const x = Math.round((cx - size / 2) * 100) / 100;
  const y = Math.round((cy - (height * scale) / 2) * 100) / 100;
  return `<path transform="translate(${x} ${y}) scale(${Math.round(scale * 1000) / 1000})" fill="${fill}" fill-rule="${rule}" d="${d}"/>`;
}

/**
 * A small pushpin in the corner of a key that is reserved for one project.
 * @param {string} colour
 * @returns {string}
 */
function pin(colour) {
  return `<circle cx="17" cy="15" r="6" fill="${colour}"/><path d="M17 20 L17 31" stroke="${colour}" stroke-width="3" stroke-linecap="round"/>`;
}

/**
 * A frame around a key, so that it stands out by shape as well as by pulsing.
 * @param {string} colour
 * @returns {string}
 */
function ring(colour) {
  return `<rect x="3" y="3" width="${KEY_SIZE - 6}" height="${KEY_SIZE - 6}" fill="none" stroke="${colour}" stroke-width="6"/>`;
}

/**
 * A tick across the bar of a quota key.
 * @param {number} percent where along the bar
 * @returns {string}
 */
function paceMark(percent) {
  // Kept off the rounded ends of the bar. Drawn dark first, so it shows on the fill as well as on the track.
  const x = Math.min(130, Math.max(14, Math.round(12 + percent * 1.2)));
  return (
    `<path d="M${x} 89V113" stroke="${QUOTA.bg}" stroke-width="7"/>` +
    `<path d="M${x} 91V111" stroke="${QUOTA.value}" stroke-width="3" stroke-linecap="round"/>`
  );
}

/**
 * @param {number} x
 * @param {number} y baseline
 * @param {number} size
 * @param {string} fill
 * @param {"start" | "middle" | "end"} anchor
 * @param {string} content
 * @param {number} [weight]
 * @returns {string}
 */
function text(x, y, size, fill, anchor, content, weight = 700) {
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-weight="${weight}" font-size="${size}" fill="${fill}">${escapeXml(content)}</text>`;
}

/**
 * @param {FittedLabel} fitted
 * @param {string} fg
 * @param {number} [centre] vertical centre of the text
 * @param {number} [twoLineLimit] the largest type for a label of two lines
 * @returns {string}
 */
function labelText(fitted, fg, centre = LABEL_CENTRE, twoLineLimit = Infinity) {
  const { lines } = fitted;
  if (lines.length === 0) return "";
  const fontSize = lines.length === 2 ? Math.min(fitted.fontSize, twoLineLimit) : fitted.fontSize;
  const lineHeight = fontSize * 1.1;
  const firstBaseline = centre - ((lines.length - 1) * lineHeight) / 2 + fontSize * 0.35;
  return lines.map((line, index) => text(CENTRE, Math.round(firstBaseline + index * lineHeight), fontSize, fg, "middle", line)).join("");
}
