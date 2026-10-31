// @ts-check
import { escapeXml, fitLabel, KEY_SIZE, LINE_WIDTH, SMALLEST, textWidth } from "./format.js";
import { LOGOS } from "./logos.js";

/** @typedef {import("./format.js").FittedLabel} FittedLabel */
/** @typedef {import("./logos.js").App} App */
/** @typedef {import("./logos.js").Logo} Logo */
/** @typedef {Readonly<Record<App, Logo>>} Logos */
/** @typedef {import("./state.js").DisplayState} DisplayState */
/**
 * @typedef {object} SheenLook
 * @property {ReadonlyArray<string | null>} colours of the bands, in the order they drift past; `null` leaves a gap
 * @property {number} opacity of the bands
 * @property {string} [glintColour] white unless given
 * @property {number} glintOpacity
 */

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
 * The holographic shimmer of a working, waiting, finished or idle key: bands
 * of colour that drift across it, and a glint that sweeps over it once in each
 * cycle. It lies between the key's colour and what is drawn on it, so the logo
 * and the label stay sharp.
 */
const SHEEN = {
  /** The direction the bands drift in, in degrees down from the horizontal. */
  angle: 30,
  /** The distance after which the bands repeat; they drift by that much in one cycle. */
  period: 96,
  /** Half the width of the glint. */
  glint: 26,
  /** The part of the cycle the glint takes to cross the key. For the rest of it, there is none. */
  glintShare: 0.55,
  /**
   * How the shimmer looks on each kind of key. Cool colours on a working key's
   * blue; warm ones on a waiting key's orange and light ones on a finished
   * key's green, where cool ones turn grey or brown. An idle key is dark: a wash
   * of colour over it looks grey, so it has green ribbons with dark gaps between
   * them, and a mint glint, since a white one turns grey there too.
   * @type {{ working: SheenLook } & Partial<Record<DisplayState, SheenLook>>}
   */
  looks: {
    working: { colours: ["#00E5FF", "#B44DFF", "#FF5CC8", "#7DF9FF", "#6BFFB8"], opacity: 0.38, glintOpacity: 0.65 },
    waiting: { colours: ["#FFE45C", "#FF5CC8", "#FFFFFF", "#FFB0E0", "#FFF3A0"], opacity: 0.38, glintOpacity: 0.65 },
    done: { colours: ["#FFE45C", "#C6FF5C", "#7DF9FF", "#FFF3A0", "#6BFFB8"], opacity: 0.45, glintOpacity: 0.65 },
    idle: { colours: ["#00FFA3", null, "#00D1FF", null, "#7CFF4F"], opacity: 0.45, glintColour: "#B0FFD9", glintOpacity: 0.35 },
  },
};
/**
 * The burst of a key whose session has just finished: the logo pops, a ring
 * spreads from it, and confetti flies out and falls.
 */
const BURST = {
  colours: ["#FFE45C", "#FF5CC8", "#00E5FF", "#B44DFF", "#FFFFFF", "#6BFFB8"],
  pieces: 16,
  /** Where the pieces start, around the logo rather than on it. */
  start: 16,
  /** How far the farthest piece flies. */
  reach: 64,
  /** How far the pieces have dropped by the end. */
  fall: 28,
  /** How much larger the logo grows at the top of its pop. */
  pop: 0.25,
  /** The part of the burst the pop takes. */
  popShare: 0.4,
};
/** A highlight that runs along the filled part of a quota key's bar. */
const SHINE = {
  /** Half its width. */
  width: 14,
  opacity: 0.75,
  /** The part of its cycle it takes to run along the bar. For the rest of it, there is none. */
  share: 0.4,
};
/** The grass along the bottom of a quota key whose limit is full, swaying. */
const GRASS = {
  colours: ["#2EA043", "#3FB950", "#56D364"],
  blades: 13,
  /** Half the width of a blade at its root. */
  root: 3.5,
  /** How far the tip of a blade sways to either side. */
  sway: 3.5,
};

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
 * @property {number} [holo] where the holographic shimmer is in its cycle, from 0 to 1; no shimmer without it
 * @property {number} [burst] how far the burst of a session that just finished has got, from 0 to 1; no burst without it
 */

/**
 * A key showing one session: the logo of its app, and its state as the colour
 * of the key. A waiting session is also told by the reason on its last line.
 *
 * @param {SessionKeyView} view
 * @param {Logos} [logos] the logo of each app; the plugin's own marks unless the apps' logos were found
 * @returns {string} SVG
 */
export function renderSessionKey(
  { app, state, label, overflow = 0, pinned = false, time = "", reason = "", urgent = false, lit = false, holo, burst },
  logos = LOGOS,
) {
  const { bg, fg } = lit && state === "waiting" ? WAITING_LIT : PALETTE[state];
  const fitted = fitLabel(label);
  // The reason takes the last line, in lighter type, so the label moves up, and one of two lines shrinks.
  const name =
    reason === ""
      ? labelText(fitted, fg)
      : labelText(fitted, fg, fitted.lines.length === 2 ? 90 : 94, SMALLEST) + text(CENTRE, 131, SMALLEST, fg, "middle", reason, 400);
  const pop = burst === undefined ? 1 : 1 + BURST.pop * Math.sin(Math.PI * Math.min(1, burst / BURST.popShare));
  return frame(
    bg,
    (holo === undefined ? "" : sheen(holo, SHEEN.looks[state] ?? SHEEN.looks.working)) +
      (burst === undefined ? "" : spreadingRing(burst)) +
      // Without a listing there is no session to show, whichever app the key is for.
      (state === "unknown" ? text(CENTRE, 58, 48, fg, "middle", "?") : logo(logos[app], LOGO.cx, LOGO.cy, LOGO.size * pop, fg)) +
      name +
      // The pin and the count share the left corner: only an automatic key carries a count.
      (overflow > 0 ? text(CORNER, 26, 22, fg, "start", `+${overflow}`) : "") +
      (time === "" ? "" : text(KEY_SIZE - CORNER, 26, 22, fg, "end", time)) +
      (pinned ? pin(fg) : "") +
      (urgent ? ring(lit ? PALETTE.waiting.bg : RING) : "") +
      (burst === undefined ? "" : confetti(burst)),
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
 * @property {string} [tag] whose limit, in the top right corner, such as `Gemini`
 * @property {number} [percent] how much is used; nothing while there is no reading
 * @property {string} [value] what the middle shows in place of the percent, such as the time the limit resets
 * @property {string} footer time until the reset, or why there is none
 * @property {number} [even] the percent that even use would have reached by now, drawn as a tick on the bar
 * @property {boolean} [warn] the footer is a warning
 * @property {number} [grass] the limit is full: the key tells you to touch grass, with grass that sways, here from 0 to 1 in its cycle
 * @property {number} [shine] a highlight runs along the bar, here from 0 to 1 in its cycle; no highlight without it
 */

/**
 * A key showing how much of a plan limit is used.
 * @param {QuotaKeyView} view
 * @returns {string} SVG
 */
export function renderQuotaKey({ title, tag = "", percent, value, footer, even, warn = false, grass, shine }) {
  const used = percent === undefined ? 0 : Math.min(100, Math.max(0, percent));
  const tone = used >= 90 ? PALETTE.error.bg : used >= 70 ? PALETTE.waiting.bg : PALETTE.done.bg;
  const middle = value ?? (percent === undefined ? "–" : `${Math.round(used)}%`);
  const footerSize = textWidth(footer, SMALLEST) > LINE_WIDTH ? 18 : SMALLEST;
  const heading =
    text(14, 32, 24, QUOTA.title, "start", title) +
    (tag === "" ? "" : text(KEY_SIZE - 14, 30, textWidth(tag, 18) > 76 ? 15 : 18, QUOTA.title, "end", tag));
  if (grass !== undefined) {
    return frame(
      QUOTA.bg,
      heading +
        text(CENTRE, 64, 30, QUOTA.value, "middle", "touch") +
        text(CENTRE, 92, 30, QUOTA.value, "middle", "grass") +
        text(CENTRE, 114, footerSize, QUOTA.footer, "middle", footer) +
        blades(grass),
    );
  }
  return frame(
    QUOTA.bg,
    heading +
      text(CENTRE, 84, 44, QUOTA.value, "middle", middle) +
      `<rect x="12" y="96" width="120" height="10" rx="5" fill="${QUOTA.track}"/>` +
      (used > 0 ? `<rect x="12" y="96" width="${Math.max(10, Math.round(used * 1.2))}" height="10" rx="5" fill="${tone}"/>` : "") +
      (used > 0 && shine !== undefined ? barShine(Math.max(10, Math.round(used * 1.2)), shine) : "") +
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
 * @param {number} phase where the shimmer is in its cycle, from 0 to 1
 * @param {SheenLook} look the bands' colours, in the order they drift past, and how strongly they and the glint show
 * @returns {string} SVG, to lie over the key's colour
 */
function sheen(phase, { colours, opacity, glintColour = "#FFFFFF", glintOpacity }) {
  const { period, glint } = SHEEN;
  const angle = (SHEEN.angle * Math.PI) / 180;
  const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
  /** How far the key reaches in the direction of the drift. */
  const reach = KEY_SIZE * (dx + dy);
  /**
   * @param {number} from distance along the drift
   * @param {number} to
   */
  const along = (from, to) =>
    `x1="${round(from * dx)}" y1="${round(from * dy)}" x2="${round(to * dx)}" y2="${round(to * dy)}"`;

  // Four periods cover the key wherever the bands are; one later the pattern is the same again.
  const start = (phase - 1) * period;
  const count = 4 * colours.length;
  const stops = Array.from({ length: count + 1 }, (_, index) => {
    const colour = colours[index % colours.length];
    // A gap fades out the colour before it, so no grey lies between the bands.
    const shown = colour ?? colours[(index - 1 + colours.length) % colours.length] ?? "#FFFFFF";
    return `<stop offset="${round(index / count, 4)}" stop-color="${shown}" stop-opacity="${colour === null ? 0 : opacity}"/>`;
  }).join("");
  let defs = `<linearGradient id="sheen" gradientUnits="userSpaceOnUse" ${along(start, start + 4 * period)}>${stops}</linearGradient>`;
  let body = `<rect width="${KEY_SIZE}" height="${KEY_SIZE}" fill="url(#sheen)"/>`;

  const crossed = phase / SHEEN.glintShare;
  if (crossed <= 1) {
    const centre = -glint + crossed * (reach + 2 * glint);
    defs +=
      `<linearGradient id="glint" gradientUnits="userSpaceOnUse" ${along(centre - glint, centre + glint)}>` +
      `<stop offset="0" stop-color="${glintColour}" stop-opacity="0"/>` +
      `<stop offset="0.5" stop-color="${glintColour}" stop-opacity="${glintOpacity}"/>` +
      `<stop offset="1" stop-color="${glintColour}" stop-opacity="0"/></linearGradient>`;
    body += `<rect width="${KEY_SIZE}" height="${KEY_SIZE}" fill="url(#glint)"/>`;
  }
  return `<defs>${defs}</defs>${body}`;
}

/**
 * A highlight running along the filled part of a quota key's bar. It is the
 * bar's own shape, filled with a band of light that moves along it, so it never
 * spills past the bar's end.
 *
 * @param {number} filled width of the filled part
 * @param {number} phase from 0 to 1 in its cycle
 * @returns {string} SVG; nothing while it rests
 */
function barShine(filled, phase) {
  const run = phase / SHINE.share;
  if (run > 1) return "";
  const { width } = SHINE;
  const centre = 12 - width + run * (filled + 2 * width);
  return (
    `<defs><linearGradient id="shine" gradientUnits="userSpaceOnUse" x1="${round(centre - width)}" y1="0" x2="${round(centre + width)}" y2="0">` +
    `<stop offset="0" stop-color="#FFFFFF" stop-opacity="0"/>` +
    `<stop offset="0.5" stop-color="#FFFFFF" stop-opacity="${SHINE.opacity}"/>` +
    `<stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></linearGradient></defs>` +
    `<rect x="12" y="96" width="${filled}" height="10" rx="5" fill="url(#shine)"/>`
  );
}

/**
 * Blades of grass along the bottom of a key, each swaying a little after its neighbour.
 * @param {number} phase from 0 to 1 in the sway's cycle
 * @returns {string} SVG
 */
function blades(phase) {
  const { blades: count, root, colours } = GRASS;
  const gap = KEY_SIZE / count;
  return Array.from({ length: count }, (_, index) => {
    const x = gap * (index + 0.5);
    const height = 15 + ((index * 5) % 4) * 3;
    const tip = x + GRASS.sway * Math.sin(2 * Math.PI * (phase + index * 0.09));
    const middle = KEY_SIZE - height / 2;
    return (
      `<path fill="${colours[index % colours.length]}" d="M ${round(x - root)} ${KEY_SIZE} ` +
      `Q ${round(x - 1)} ${round(middle)} ${round(tip)} ${KEY_SIZE - height} ` +
      `Q ${round(x + 1)} ${round(middle)} ${round(x + root)} ${KEY_SIZE} Z"/>`
    );
  }).join("");
}

/**
 * A ring that spreads from the logo and fades, beneath the logo and the label.
 * @param {number} progress from 0 to 1
 * @returns {string} SVG
 */
function spreadingRing(progress) {
  const out = easeOut(progress);
  return (
    `<circle cx="${LOGO.cx}" cy="${LOGO.cy}" r="${round(12 + 70 * out)}" fill="none" stroke="#FFFFFF" ` +
    `stroke-width="${round(6 - 5 * out)}" stroke-opacity="${round(0.7 * (1 - progress), 2)}"/>`
  );
}

/**
 * Pieces of confetti that fly out from the logo, tumble, fall and fade, over everything else.
 * @param {number} progress from 0 to 1
 * @returns {string} SVG
 */
function confetti(progress) {
  const { pieces, colours } = BURST;
  const out = easeOut(progress);
  const opacity = round(1 - progress * progress, 2);
  return Array.from({ length: pieces }, (_, index) => {
    // Spread around the logo, with some pieces flying farther than others.
    const angle = (index / pieces) * 2 * Math.PI + (index % 3) * 0.35;
    const reach = BURST.reach * (0.55 + 0.45 * (((index * 7) % 5) / 4));
    const distance = BURST.start + reach * out;
    const x = LOGO.cx + Math.cos(angle) * distance;
    const y = LOGO.cy + Math.sin(angle) * distance + BURST.fall * progress * progress;
    const turn = ((index % 2 === 0 ? 1 : -1) * 360 * progress + index * 40) % 360;
    return (
      `<rect x="-4" y="-2" width="8" height="4" rx="1" fill="${colours[index % colours.length]}" fill-opacity="${opacity}" ` +
      `transform="translate(${round(x)} ${round(y)}) rotate(${round(turn)})"/>`
    );
  }).join("");
}

/**
 * @param {number} progress from 0 to 1
 * @returns {number} fast at first, slowing to a stop
 */
function easeOut(progress) {
  return 1 - (1 - progress) ** 3;
}

/**
 * @param {number} value
 * @param {number} [digits]
 * @returns {string} without trailing zeros, so the same shimmer is always the same text
 */
function round(value, digits = 1) {
  return String(Number(value.toFixed(digits)));
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
