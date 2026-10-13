// @ts-check
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLocalLogos } from "../com.thomasalbin.code-command-center.sdPlugin/bin/adapters/local-logos.js";
import { Board } from "../com.thomasalbin.code-command-center.sdPlugin/bin/app/board.js";
import { LOGOS, outlineOf, spellOut } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/logos.js";
import { renderEmptyKey, renderSessionKey } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";

/** A logo file as apps ship them: numbers packed together, an arc with glued flags. */
const PACKED = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Example</title><path d="M4.5 3l.5-.25.25.5a2.5 2.5 0 01-.1-.7L6 .1z"/></svg>`;
const EVEN_ODD = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 40 30"><g opacity=".3"><path fill="#000" fill-rule="evenodd" d="M1 1h38v28H1zM10 10v10h10V10z" clip-rule="evenodd"/></g></svg>`;

test("packed path data is written out, number by number", () => {
  assert.equal(spellOut("M4.5 3l.5-.25.25.5"), "M 4.5 3 l 0.5 -0.25 0.25 0.5");
  assert.equal(spellOut("a2.5 2.5 0 01-.1-.7"), "a 2.5 2.5 0 0 1 -0.1 -0.7", "the two flags of an arc are single digits");
  assert.equal(spellOut("M0,0 L1e1,2E-1Z"), "M 0 0 L 10 0.2 Z");
});

test("what is not path data is refused, so nothing else can get into an image", () => {
  assert.equal(spellOut(""), undefined);
  assert.equal(spellOut("1 2 3"), undefined, "numbers before any command");
  assert.equal(spellOut('M0 0"/><script>'), undefined);
  assert.equal(spellOut("M0 0 X 1 1"), undefined, "not a path command");
  assert.equal(spellOut("a1 1 0 21 1 1"), undefined, "not an arc flag");
});

test("a logo is read from an app's file: its outline, its box and how it is filled", () => {
  assert.deepEqual(outlineOf(PACKED), {
    d: "M 4.5 3 l 0.5 -0.25 0.25 0.5 a 2.5 2.5 0 0 1 -0.1 -0.7 L 6 0.1 z",
    width: 24,
    height: 24,
    rule: "nonzero",
  });
  const evenOdd = outlineOf(EVEN_ODD);
  assert.deepEqual([evenOdd?.width, evenOdd?.height, evenOdd?.rule], [40, 30, "evenodd"]);
});

test("a file that is not a simple logo yields none", () => {
  assert.equal(outlineOf("<svg><path d=\"M0 0\"/></svg>"), undefined, "no box");
  assert.equal(outlineOf('<svg viewBox="0 0 24 24"><circle r="3"/></svg>'), undefined, "no path");
  assert.equal(outlineOf('<svg viewBox="0 0 24 24"><path d="hello"/></svg>'), undefined);
  assert.equal(outlineOf(`<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>${" ".repeat(70_000)}`), undefined, "too large to be a logo");
});

/**
 * A home folder with Claude Code extensions for VS Code in it.
 * @param {Record<string, string>} versions version → content of its logo file
 */
function homeWith(versions) {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccc-logos-"));
  for (const [version, svg] of Object.entries(versions)) {
    const resources = path.join(home, ".vscode", "extensions", `anthropic.claude-code-${version}-darwin-arm64`, "resources");
    mkdirSync(resources, { recursive: true });
    writeFileSync(path.join(resources, "claude-logo.svg"), svg);
  }
  return home;
}

test("the apps' logos are taken from the apps installed here, newest version first", () => {
  const home = homeWith({ "2.1.9": EVEN_ODD, "2.1.10": PACKED });
  const vsCode = path.join(home, "vscode-logo.svg");
  writeFileSync(vsCode, EVEN_ODD);
  try {
    const found = readLocalLogos(home, vsCode);
    assert.equal(found.desktop?.rule, "nonzero", "2.1.10 is newer than 2.1.9");
    assert.equal(found.vscode?.rule, "evenodd");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an app that is missing, or whose logo cannot be read, yields no logo", () => {
  const home = homeWith({ "2.1.10": "not an image" });
  try {
    assert.deepEqual(readLocalLogos(home, path.join(home, "missing.svg")), {});
    assert.deepEqual(readLocalLogos(path.join(home, "nowhere"), path.join(home, "missing.svg")), {});
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an older version's logo is used when the newest has none that can be read", () => {
  const home = homeWith({ "2.1.9": PACKED, "2.1.10": "broken" });
  try {
    assert.equal(readLocalLogos(home, path.join(home, "missing.svg")).desktop?.width, 24);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("keys are drawn with the logos they are given, and with the plugin's own marks otherwise", () => {
  const local = /** @type {NonNullable<ReturnType<typeof outlineOf>>} */ (outlineOf(PACKED));
  const logos = { ...LOGOS, desktop: local };
  const given = renderSessionKey({ app: "desktop", state: "working", label: "alpha" }, logos);
  assert.ok(given.includes(local.d) && !given.includes(LOGOS.desktop.d));
  assert.ok(renderSessionKey({ app: "desktop", state: "working", label: "alpha" }).includes(LOGOS.desktop.d));
  assert.ok(renderEmptyKey("VS Code", "vscode", logos).includes(LOGOS.vscode.d), "an app without a local logo keeps the mark");
});

test("the board passes its logos on to every key", () => {
  const local = /** @type {NonNullable<ReturnType<typeof outlineOf>>} */ (outlineOf(PACKED));
  /** @type {string[]} */
  const images = [];
  const board = new Board({
    monitor: { sessions: [], healthy: true, onChange() {}, watch() {}, acknowledge() {} },
    bringToFront: async () => {},
    now: () => 1_000_000,
    logos: { ...LOGOS, desktop: local },
  });
  board.keyAppeared("desktop", {
    id: "a",
    coordinates: { row: 0, column: 0 },
    device: { id: "deck" },
    setImage: async (image) => {
      images.push(decodeURIComponent(image ?? ""));
    },
  });
  board.render();
  assert.ok(images[0].includes(local.d));
  board.keyDisappeared("a");
});

test("the plugin's own marks are plain shapes in a 24 by 24 box", () => {
  for (const { d, width, height, rule } of Object.values(LOGOS)) {
    assert.equal(spellOut(d), d, "already written out");
    assert.deepEqual([width, height, rule], [24, 24, "nonzero"]);
    const numbers = d.split(" ").filter((part) => /\d/.test(part)).map(Number);
    assert.ok(numbers.every((value) => value >= 0 && value <= 24), "nothing outside the box");
  }
});
