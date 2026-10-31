// Draws every kind of key into one picture, to judge legibility without a
// Stream Deck. A development aid.
//
//   node scripts/dev/gallery.mjs [output-file]
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderEmptyKey,
  renderPinnedEmptyKey,
  renderQuotaKey,
  renderSessionKey,
} from "../../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";

const CELL = 144;
const GAP = 12;
const out = process.argv[2] ?? path.join(os.tmpdir(), "code-command-center-gallery.svg");
/** The key that shows the logo is a picture in the plugin's folder, not something the plugin draws. */
const logoKey = readFileSync(
  new URL("../../com.thomasalbin.code-command-center.sdPlugin/imgs/actions/project-page/key.svg", import.meta.url),
  "utf8",
).trim();

const rows = [
  [
    renderQuotaKey({ title: "5h", tag: "Claude", percent: 42, footer: "2h 13m" }),
    renderQuotaKey({ title: "7d", tag: "Claude", percent: 78, footer: "3d 4h" }),
    renderQuotaKey({ title: "5h", tag: "Claude", percent: 96, footer: "12m" }),
    renderQuotaKey({ title: "7d", tag: "Claude", percent: 0, footer: "reset" }),
    renderQuotaKey({ title: "5h", tag: "Claude", footer: "no data" }),
  ],
  [
    renderQuotaKey({ title: "5h", tag: "Claude", percent: 46, footer: "full 12:40", even: 30, warn: true }),
    renderQuotaKey({ title: "7d", tag: "Claude", percent: 13, footer: "2d 16h", even: 62 }),
    renderQuotaKey({ title: "7d", tag: "Claude", percent: 72, footer: "full Wed 18:00", even: 60, warn: true }),
    renderQuotaKey({ title: "5h", tag: "Claude", percent: 42, footer: "as of 09:08", even: 70 }),
    renderQuotaKey({ title: "5h", tag: "Claude", percent: 96, footer: "12m", even: 96 }),
  ],
  [
    renderQuotaKey({ title: "5h", percent: 42, value: "16:30", footer: "resets" }),
    renderQuotaKey({ title: "7d", percent: 72, value: "18:00", footer: "resets Wed", even: 60 }),
    renderQuotaKey({ title: "7d", tag: "Argon", percent: 13, value: "21:36", footer: "resets Mon" }),
    renderQuotaKey({ title: "5h", tag: "Claude", footer: "for 2h 13m", grass: 0.2 }),
    renderQuotaKey({ title: "7d", tag: "Claude", percent: 41, footer: "3d 4h" }),
  ],
  [
    renderSessionKey({ app: "desktop", state: "working", label: "atlas", time: "12m" }),
    renderSessionKey({ app: "vscode", state: "working", label: "big-data-analyzer", pinned: true, time: "1h05" }),
    renderSessionKey({ app: "desktop", state: "waiting", label: "test", time: "3m", reason: "permission" }),
    renderSessionKey({ app: "desktop", state: "waiting", label: "misty-streams", time: "6m", reason: "dialog", urgent: true, overflow: 2 }),
    renderSessionKey({ app: "desktop", state: "waiting", label: "test", time: "6m", reason: "permission", urgent: true, lit: true, pinned: true }),
  ],
  [
    renderSessionKey({ app: "desktop", state: "working", label: "test", holo: 0.25 }),
    renderSessionKey({ app: "desktop", state: "waiting", label: "examples", pinned: true }),
    renderSessionKey({ app: "vscode", state: "done", label: "misty-streams", burst: 0.3 }),
    renderSessionKey({ app: "vscode", state: "idle", label: "weather-api", pinned: true }),
    logoKey,
  ],
  [
    renderSessionKey({ app: "vscode", state: "working", label: "big-data-analyzer", pinned: true }),
    renderSessionKey({ app: "vscode", state: "idle", label: "demo2-container", overflow: 2 }),
    renderPinnedEmptyKey("harbor", "vscode"),
    renderEmptyKey("VS Code", "vscode"),
    renderSessionKey({ app: "desktop", state: "unknown", label: "" }),
  ],
  [
    renderSessionKey({ app: "antigravity", state: "working", label: "orbit", time: "4m" }),
    renderSessionKey({ app: "antigravity", state: "waiting", label: "comet-tail", time: "2m", reason: "permission" }),
    renderSessionKey({ app: "antigravity", state: "done", label: "orbit", pinned: true }),
    renderPinnedEmptyKey("launchpad", "antigravity"),
    renderEmptyKey("Antigravity", "antigravity"),
  ],
];

const cells = rows
  .flatMap((row, rowIndex) =>
    row.map((svg, column) =>
      svg.replace("<svg ", `<svg x="${GAP + column * (CELL + GAP)}" y="${GAP + rowIndex * (CELL + GAP)}" `),
    ),
  )
  .join("");
const [width, height] = [GAP + 5 * (CELL + GAP), GAP + rows.length * (CELL + GAP)];
writeFileSync(
  out,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000"/>${cells}</svg>`,
);
console.log(out);
