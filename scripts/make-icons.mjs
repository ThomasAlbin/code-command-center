// Draws the plugin's logo, three arrow badges pointing right in the colours of
// the three session states, and writes it in the two forms Stream Deck asks
// for: the plugin icon as PNG (in colour, on a dark tile) and the list icon as
// SVG (white, no tile). Uses only Node's standard library. Run with
// `node scripts/make-icons.mjs`.
//
// The logo is the property of Thomas Albin and is not covered by the license
// of the software. See "The logo" in LICENSE.md.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const OUT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "com.thomasalbin.code-command-center.sdPlugin",
  "imgs",
  "plugin",
);

/** Written into each file, so that the notice travels with the logo. */
const NOTICE = "Code Command Center logo. Copyright (c) 2026 Thomas Albin. All rights reserved. See LICENSE.md.";

/** The logo is drawn on the 28-unit grid of Stream Deck's list icons. */
const GRID = 28;
/** One badge, in grid units: a body with a point on its right and a notch of the same shape on its left. */
const BADGE = { height: 14, body: 5, point: 5, gap: 2, corner: 1 };
const LOGO_UNITS = 3 * BADGE.body + 2 * BADGE.gap + BADGE.point;

const TILE = [13, 17, 23];
/** Working, waiting, done: the colours of the session keys. */
const STATES = [
  [31, 111, 235],
  [240, 136, 62],
  [46, 160, 67],
];
const CORNER_RADIUS = 0.22;
/** Share of the tile's width that the logo takes. */
const LOGO_WIDTH = 0.68;
/** Samples per pixel along each axis, for smooth edges. */
const SAMPLES = 8;
/** Straight pieces that stand in for one rounded corner when pixels are tested. */
const ARC_STEPS = 16;

/**
 * @param {number} index 0 to 2, left to right
 * @returns {number[][]} the badge's corners, clockwise from the top left, the notch last
 */
function corners(index) {
  const { height, body, point, gap } = BADGE;
  const x = (GRID - LOGO_UNITS) / 2 + index * (body + gap);
  const y = (GRID - height) / 2;
  return [
    [x, y],
    [x + body, y],
    [x + body + point, y + height / 2],
    [x + body, y + height],
    [x, y + height],
    [x + point, y + height / 2],
  ];
}

/**
 * The notch is rounded around the same centre as the tip of the badge before
 * it, so the gap between two badges has one width all the way.
 * @returns {number[]} the radius of each corner
 */
function radii() {
  const { height, point, gap, corner } = BADGE;
  const slant = height / 2 / Math.hypot(point, height / 2);
  return [corner, corner, corner, corner, corner, corner + gap * slant];
}

/**
 * @param {number[][]} points
 * @param {number[]} radius
 * @returns {{ radius: number, from: number[], to: number[], centre: number[], sweep: 0 | 1 }[]} the arc that rounds each corner
 */
function fillets(points, radius) {
  return points.map((corner, i) => {
    const before = points[(i - 1 + points.length) % points.length];
    const after = points[(i + 1) % points.length];
    const back = unit([before[0] - corner[0], before[1] - corner[1]]);
    const ahead = unit([after[0] - corner[0], after[1] - corner[1]]);
    const half = Math.acos(back[0] * ahead[0] + back[1] * ahead[1]) / 2;
    const reach = radius[i] / Math.tan(half);
    const middle = unit([back[0] + ahead[0], back[1] + ahead[1]]);
    const turn = (corner[0] - before[0]) * (after[1] - corner[1]) - (corner[1] - before[1]) * (after[0] - corner[0]);
    return {
      radius: radius[i],
      from: [corner[0] + back[0] * reach, corner[1] + back[1] * reach],
      to: [corner[0] + ahead[0] * reach, corner[1] + ahead[1] * reach],
      centre: [
        corner[0] + (middle[0] * radius[i]) / Math.sin(half),
        corner[1] + (middle[1] * radius[i]) / Math.sin(half),
      ],
      sweep: turn > 0 ? 1 : 0,
    };
  });
}

/**
 * @param {number[]} vector
 * @returns {number[]}
 */
function unit(vector) {
  const length = Math.hypot(vector[0], vector[1]);
  return [vector[0] / length, vector[1] / length];
}

/**
 * @param {number} index
 * @returns {string} the badge as SVG path data
 */
function outline(index) {
  const number = (/** @type {number} */ value) => String(Math.round(value * 1000) / 1000);
  return (
    fillets(corners(index), radii())
      .map((arc, i) => {
        const r = number(arc.radius);
        return `${i === 0 ? "M" : "L"}${number(arc.from[0])} ${number(arc.from[1])}A${r} ${r} 0 0 ${arc.sweep} ${number(arc.to[0])} ${number(arc.to[1])}`;
      })
      .join("") + "Z"
  );
}

/**
 * @param {number} index
 * @returns {number[][]} the same outline as a polygon, for testing pixels
 */
function polygon(index) {
  const points = [];
  for (const arc of fillets(corners(index), radii())) {
    const start = Math.atan2(arc.from[1] - arc.centre[1], arc.from[0] - arc.centre[0]);
    let end = Math.atan2(arc.to[1] - arc.centre[1], arc.to[0] - arc.centre[0]);
    if (arc.sweep === 1 && end < start) end += 2 * Math.PI;
    if (arc.sweep === 0 && end > start) end -= 2 * Math.PI;
    for (let step = 0; step <= ARC_STEPS; step++) {
      const angle = start + ((end - start) * step) / ARC_STEPS;
      points.push([arc.centre[0] + arc.radius * Math.cos(angle), arc.centre[1] + arc.radius * Math.sin(angle)]);
    }
  }
  return points;
}

const BADGES = STATES.map((colour, index) => {
  const points = polygon(index);
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  return {
    colour,
    points,
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
});

/**
 * @param {number[][]} points
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function inside(points, x, y) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * @param {number} x 0 to 1
 * @param {number} y 0 to 1
 * @returns {number[] | undefined} RGB, or nothing outside the tile
 */
function colourAt(x, y) {
  // Outside the rounded corners the icon is transparent.
  const cx = Math.min(Math.max(x, CORNER_RADIUS), 1 - CORNER_RADIUS);
  const cy = Math.min(Math.max(y, CORNER_RADIUS), 1 - CORNER_RADIUS);
  if (Math.hypot(x - cx, y - cy) > CORNER_RADIUS) return undefined;
  const gx = GRID / 2 + ((x - 0.5) * LOGO_UNITS) / LOGO_WIDTH;
  const gy = GRID / 2 + ((y - 0.5) * LOGO_UNITS) / LOGO_WIDTH;
  for (const badge of BADGES) {
    if (gx < badge.left || gx > badge.right || gy < badge.top || gy > badge.bottom) continue;
    if (inside(badge.points, gx, gy)) return badge.colour;
  }
  return TILE;
}

/**
 * @param {number} size
 * @returns {Buffer} PNG file contents
 */
function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, covered] = [0, 0, 0, 0];
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const colour = colourAt((px + (sx + 0.5) / SAMPLES) / size, (py + (sy + 0.5) / SAMPLES) / size);
          if (colour === undefined) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          covered += 1;
        }
      }
      const offset = py * stride + 1 + px * 4;
      if (covered > 0) {
        raw[offset] = Math.round(r / covered);
        raw[offset + 1] = Math.round(g / covered);
        raw[offset + 2] = Math.round(b / covered);
        raw[offset + 3] = Math.round((255 * covered) / (SAMPLES * SAMPLES));
      }
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits per channel, RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("tEXt", Buffer.from(`Copyright\0${NOTICE}`, "latin1")),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

/**
 * @returns {string} the list icon: the logo in white, as Stream Deck asks of list icons
 */
function listIcon() {
  const badges = [0, 1, 2].map(outline).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${GRID}" height="${GRID}" viewBox="0 0 ${GRID} ${GRID}"><!-- ${NOTICE} --><path d="${badges}" fill="#FFFFFF"/></svg>\n`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(path.join(OUT, "icon.png"), png(256));
writeFileSync(path.join(OUT, "icon@2x.png"), png(512));
writeFileSync(path.join(OUT, "category.svg"), listIcon());
console.log(`Wrote icon.png, icon@2x.png and category.svg to ${OUT}`);
