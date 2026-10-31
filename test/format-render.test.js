// @ts-check
import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeXml,
  fitLabel,
  folderLabel,
  formatDayClock,
  formatElapsed,
  reasonWord,
  textWidth,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/format.js";
import { LOGOS } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/logos.js";
import {
  renderEmptyKey,
  renderPinnedEmptyKey,
  renderSessionKey,
  svgToDataUri,
} from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/render.js";

test("a project is labelled by its folder", () => {
  assert.equal(folderLabel("/Users/dev/projects/misty-streams"), "misty-streams");
  assert.equal(folderLabel("/Users/dev/projects/alpha/"), "alpha");
  assert.equal(folderLabel("/"), "/");
  assert.equal(folderLabel(undefined), "");
});

/** Width available for text on a 144 px key with its margins. */
const LINE_WIDTH = 124;

test("short labels get one large line", () => {
  assert.deepEqual(fitLabel("test"), { lines: ["test"], fontSize: 34 });
  assert.deepEqual(fitLabel("examples"), { lines: ["examples"], fontSize: 26 });
  assert.equal(fitLabel("Workspace").lines.length, 1);
});

test("longer labels break at a separator, as evenly as possible", () => {
  assert.deepEqual(fitLabel("misty-streams"), { lines: ["misty-", "streams"], fontSize: 26 });
  assert.deepEqual(fitLabel("big-data-analyzer").lines, ["big-data-", "analyzer"]);
  assert.deepEqual(fitLabel("the-garden-lab-com").lines, ["the-garden-", "lab-com"]);
  assert.deepEqual(fitLabel("my big project").lines, ["my big", "project"]);
});

test("a label that fits on one line is not broken", () => {
  assert.deepEqual(fitLabel("my project").lines, ["my project"]);
});

test("labels without a usable break are wrapped and cut", () => {
  const { lines, fontSize } = fitLabel("supercalifragilisticexpialidocious");
  assert.equal(fontSize, 20);
  assert.equal(lines.length, 2);
  assert.ok(lines[1].endsWith("…"));
});

test("no line is wider than the key, whatever the letters", () => {
  const labels = ["mmmmmmmm", "WWWWWWWWWWWW", "iiiiiiiiiiiiiiiiiiii", "www-mmm-www-mmm", "A", "MAXIMUM_WIDTH_NAME", "a b c d e f g h i j k l m"];
  for (const label of labels) {
    const { lines, fontSize } = fitLabel(label);
    assert.ok(lines.length >= 1 && lines.length <= 2, label);
    for (const line of lines) assert.ok(textWidth(line, fontSize) <= LINE_WIDTH, `${label}: ${line}`);
  }
});

test("narrow letters take less room than wide ones", () => {
  assert.ok(textWidth("illi", 20) < textWidth("mmmm", 20));
  assert.equal(textWidth("", 20), 0);
});

test("an empty label draws nothing", () => {
  assert.deepEqual(fitLabel("  "), { lines: [], fontSize: 0 });
});

test("escapes the characters XML reserves", () => {
  assert.equal(escapeXml(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c&apos;");
});

test("each state has its own colour", () => {
  const colours = new Set();
  for (const state of /** @type {const} */ (["working", "waiting", "done", "idle", "error", "unknown"])) {
    const svg = renderSessionKey({ app: "desktop", state, label: "alpha" });
    const match = /<rect[^>]*fill="(#[0-9A-F]{6})"/.exec(svg);
    assert.ok(match, state);
    colours.add(match[1]);
    assert.ok(svg.includes(">alpha</text>"), state);
    assert.ok(!svg.includes("NaN") && !svg.includes("undefined"), state);
  }
  assert.equal(colours.size, 6);
});

test("a session key carries the logo of its app in place of a state symbol", () => {
  for (const state of /** @type {const} */ (["working", "waiting", "done", "idle", "error"])) {
    const claude = renderSessionKey({ app: "desktop", state, label: "alpha" });
    const code = renderSessionKey({ app: "vscode", state, label: "alpha" });
    assert.ok(claude.includes(LOGOS.desktop.d) && !claude.includes(LOGOS.vscode.d), state);
    assert.ok(code.includes(LOGOS.vscode.d) && !code.includes(LOGOS.desktop.d), state);
    assert.ok(!claude.includes("<circle") && !claude.includes("stroke-linecap"), `${state}: no dots, marks or checks`);
  }
});

test("a key that has no listing to show carries a question mark, whichever app it is for", () => {
  const svg = renderSessionKey({ app: "vscode", state: "unknown", label: "" });
  assert.ok(svg.includes(">?</text>"));
  assert.ok(!svg.includes(LOGOS.vscode.d));
});

test("a shimmering key keeps its colour, with the shimmer beneath the logo and the label", () => {
  const plain = renderSessionKey({ app: "desktop", state: "working", label: "alpha" });
  const shimmering = renderSessionKey({ app: "desktop", state: "working", label: "alpha", holo: 0.2 });
  assert.ok(!plain.includes("url(#sheen)"));
  assert.equal(/<rect[^>]*fill="(#[0-9A-F]{6})"/.exec(shimmering)?.[1], "#1F6FEB");
  const sheen = shimmering.indexOf("url(#sheen)");
  assert.ok(sheen > 0 && sheen < shimmering.indexOf(LOGOS.desktop.d) && sheen < shimmering.indexOf(">alpha</text>"));
  assert.ok(!shimmering.includes("NaN") && !shimmering.includes("undefined"));
});

test("a waiting key shimmers in warm colours, so its orange does not turn grey", () => {
  /** @param {import("../com.thomasalbin.code-command-center.sdPlugin/bin/core/state.js").DisplayState} state */
  const colours = (state) => [...renderSessionKey({ app: "desktop", state, label: "alpha", holo: 0.2 }).matchAll(/stop-color="(#[0-9A-F]{6})" stop-opacity="0.38"/g)].map((match) => match[1]);
  assert.ok(colours("working").includes("#00E5FF"));
  assert.ok(!colours("waiting").includes("#00E5FF"));
  assert.ok(colours("waiting").includes("#FFE45C"));
  const done = [...renderSessionKey({ app: "desktop", state: "done", label: "alpha", holo: 0.2 }).matchAll(/stop-color="(#[0-9A-F]{6})" stop-opacity="0.45"/g)].map((match) => match[1]);
  assert.ok(done.includes("#C6FF5C") && !done.includes("#B44DFF"), "a finished key in light colours, no violet");
  const idle = renderSessionKey({ app: "desktop", state: "idle", label: "alpha", holo: 0.2 });
  const idleBands = [.../<linearGradient id="sheen".*?<\/linearGradient>/.exec(idle)?.[0].matchAll(/stop-color="(#[0-9A-F]{6})"/g) ?? []].map((match) => match[1]);
  assert.ok(idle.includes('fill="#2EA043"') && idle.includes('fill="#FFFFFF"'), "an idle key takes a finished key's green, since a shimmer on its own dark green looks grey");
  assert.ok(idleBands.includes("#0E6B30") && !idleBands.includes("#C6FF5C"), "with dark green bands where that has lime, to tell the two apart");
  assert.ok(renderSessionKey({ app: "desktop", state: "idle", label: "alpha" }).includes('fill="#12361F"'), "without the shimmer it stays dim");
  const pulsing = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha", urgent: true, lit: true, holo: 0.2 });
  assert.ok(pulsing.indexOf("url(#sheen)") < pulsing.lastIndexOf("<rect"), "the pulse's frame stays on top");
});

test("the glint crosses a shimmering key early in each cycle, and the bands keep drifting", () => {
  /** @param {number} phase */
  const at = (phase) => renderSessionKey({ app: "desktop", state: "working", label: "alpha", holo: phase });
  assert.ok(at(0).includes("url(#glint)"));
  assert.ok(at(0.5).includes("url(#glint)"));
  assert.ok(!at(0.8).includes("url(#glint)"), "then it rests");
  assert.notEqual(at(0.8), at(0.9), "the bands still move");
  assert.equal(at(0.3), at(0.3), "the same moment is the same image, so nothing is sent twice");
});

test("a key whose session just finished bursts: the logo pops, a ring spreads and confetti flies and fades", () => {
  /** @param {number} [burst] */
  const at = (burst) => renderSessionKey({ app: "desktop", state: "done", label: "alpha", burst });
  /** @param {string} svg */
  const logoScale = (svg) => Number(/<path transform="translate\([\d.]+ [\d.]+\) scale\(([\d.]+)\)"/.exec(svg)?.[1]);
  /** @param {string} svg */
  const pieces = (svg) => [...svg.matchAll(/fill-opacity="([\d.]+)" transform="translate\(([-\d.]+) ([-\d.]+)\)/g)];

  assert.ok(!at().includes("<circle") && pieces(at()).length === 0, "no burst without it");
  assert.ok(logoScale(at(0.2)) > logoScale(at()), "the logo pops");
  assert.equal(logoScale(at(0.6)), logoScale(at()), "and is back to size");
  assert.equal(pieces(at(0.1)).length, 16);
  const spread = (/** @type {number} */ burst) => Math.max(...pieces(at(burst)).map((piece) => Math.abs(Number(piece[2]) - 59)));
  assert.ok(spread(0.6) > spread(0.1), "the confetti flies out");
  assert.ok(Number(pieces(at(0.9))[0][1]) < Number(pieces(at(0.1))[0][1]), "and fades");
  const svg = at(0.3);
  assert.ok(svg.indexOf("<circle") < svg.indexOf(">alpha</text>"), "the ring lies beneath the label");
  assert.ok(svg.lastIndexOf(" rotate(") > svg.indexOf(">alpha</text>"), "the confetti flies over it");
  assert.ok(!svg.includes("NaN") && !svg.includes("undefined"));
});

test("the logo stays clear of the count and of the clock in the corners", () => {
  const svg = renderSessionKey({ app: "vscode", state: "working", label: "alpha", overflow: 2, time: "1h05" });
  const match = /<path transform="translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)"/.exec(svg);
  assert.ok(match);
  const left = Number(match[1]);
  const right = left + LOGOS.vscode.width * Number(match[3]);
  assert.ok(left > 10 + textWidth("+2", 22), "right of the count");
  assert.ok(right < 134 - textWidth("1h05", 22), "left of the longest clock");
});

test("a key without a session shows its app's logo too, dimmed", () => {
  const empty = renderEmptyKey("VS Code", "vscode");
  assert.ok(empty.includes(LOGOS.vscode.d) && empty.includes(">VS Code</text>"));
  assert.ok(renderEmptyKey("Claude", "desktop").includes(LOGOS.desktop.d));
  const reserved = renderPinnedEmptyKey("alpha", "desktop");
  assert.ok(reserved.includes(`fill="#484F58" fill-rule="nonzero" d="${LOGOS.desktop.d}"`));
});

test("the outlines of the logos are spelled out, for renderers that read path data strictly", () => {
  const item = "(?:[A-Za-z]|-?\\d+(?:\\.\\d+)?)";
  for (const { d, width, height } of Object.values(LOGOS)) {
    assert.match(d, new RegExp(`^${item}(?: ${item})*$`));
    assert.ok(width > 0 && height > 0);
  }
});

test("a folder name cannot break out of the image", () => {
  const svg = renderSessionKey({ app: "desktop", state: "working", label: "<a&b>" });
  assert.ok(svg.includes("&lt;a&amp;b&gt;"));
  assert.ok(!svg.includes("<a&b>"));
});

test("sessions without a key are counted on the badge", () => {
  assert.ok(renderSessionKey({ app: "desktop", state: "idle", label: "alpha", overflow: 2 }).includes(">+2</text>"));
  assert.ok(!renderSessionKey({ app: "desktop", state: "idle", label: "alpha" }).includes(">+"));
});

test("time spent is short enough for the corner of a key", () => {
  assert.equal(formatElapsed(59_000), "", "nothing during the first minute");
  assert.equal(formatElapsed(60_000), "1m");
  assert.equal(formatElapsed(59 * 60_000 + 59_000), "59m");
  assert.equal(formatElapsed(65 * 60_000), "1h05");
  assert.equal(formatElapsed(9 * 3_600_000 + 59 * 60_000), "9h59");
  assert.equal(formatElapsed(26 * 3_600_000), "26h");
});

test("a moment on another day is named with its day", () => {
  assert.equal(formatDayClock(new Date(2026, 9, 10, 18, 0).getTime()), "Sat 18:00");
  assert.equal(formatDayClock(new Date(2026, 9, 11, 7, 5).getTime()), "Sun 07:05");
});

test("what a session waits for is cut to its first word", () => {
  assert.equal(reasonWord("permission prompt"), "permission");
  assert.equal(reasonWord("dialog open"), "dialog");
  assert.equal(reasonWord("Input needed"), "input");
  assert.equal(reasonWord(undefined), "");
  assert.equal(reasonWord("  "), "");
  assert.ok(textWidth(reasonWord("mmmmmmmmmmmmmmmmmmmm"), 20) <= LINE_WIDTH, "whatever Claude Code says, it fits");
});

/**
 * @param {string} svg
 * @param {string} content
 * @returns {{ x: number, y: number, anchor: string, size: number } | undefined} where a text sits
 */
function textAt(svg, content) {
  const match = new RegExp(`<text x="([\\d.]+)" y="([\\d.]+)" text-anchor="(\\w+)"[^>]*font-size="(\\d+)"[^>]*>${content}</text>`).exec(svg);
  return match === null ? undefined : { x: Number(match[1]), y: Number(match[2]), anchor: match[3], size: Number(match[4]) };
}

test("time spent sits in the right corner and the count of other sessions in the left", () => {
  const svg = renderSessionKey({ app: "desktop", state: "working", label: "alpha", overflow: 2, time: "12m" });
  assert.deepEqual(textAt(svg, "12m"), { x: 134, y: 26, anchor: "end", size: 22 });
  assert.deepEqual(textAt(svg, "\\+2"), { x: 10, y: 26, anchor: "start", size: 22 });
  assert.equal(textAt(renderSessionKey({ app: "desktop", state: "working", label: "alpha" }), "12m"), undefined);
});

test("a waiting key says what it waits for on its last line", () => {
  const plain = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha" });
  const svg = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha", reason: "permission" });
  const [reason, label, before] = [textAt(svg, "permission"), textAt(svg, "alpha"), textAt(plain, "alpha")];
  assert.ok(reason && label && before);
  assert.equal(reason.size, 20);
  assert.ok(label.y < before.y, "the label moves up to make room");
  assert.ok(label.y + 8 < reason.y - reason.size * 0.72, "and stays clear of the reason");
  assert.ok(reason.y + reason.size * 0.25 < 138, "which stays clear of the frame an urgent key gets");
});

test("a label of two lines shrinks to leave room for the reason", () => {
  const svg = renderSessionKey({ app: "desktop", state: "waiting", label: "misty-streams", reason: "permission" });
  const [first, second, reason] = [textAt(svg, "misty-"), textAt(svg, "streams"), textAt(svg, "permission")];
  assert.ok(first && second && reason);
  assert.equal(first.size, 20);
  assert.ok(first.y - first.size * 0.72 > 66, "below the logo");
  assert.ok(second.y + 6 < reason.y - reason.size * 0.72, "above the reason");
});

test("a key that has waited too long gets a frame, and its pulse a brighter colour", () => {
  const calm = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha" });
  const urgent = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha", urgent: true });
  const lit = renderSessionKey({ app: "desktop", state: "waiting", label: "alpha", urgent: true, lit: true });
  assert.ok(!calm.includes('<rect x="3" y="3"') && urgent.includes('<rect x="3" y="3"') && lit.includes('<rect x="3" y="3"'));
  const background = (/** @type {string} */ svg) => /<rect[^>]*fill="(#[0-9A-F]{6})"/.exec(svg)?.[1];
  assert.equal(background(urgent), "#F0883E");
  assert.equal(background(lit), "#FFD9A6");
  assert.notEqual(urgent, lit);
  assert.equal(renderSessionKey({ app: "desktop", state: "working", label: "alpha", lit: true }), renderSessionKey({ app: "desktop", state: "working", label: "alpha" }), "only a waiting key pulses");
});

test("an empty key names what it is for", () => {
  assert.ok(renderEmptyKey("VS Code", "vscode").includes(">VS Code</text>"));
});

test("images are sent as SVG data URIs", () => {
  const uri = svgToDataUri(renderEmptyKey("Claude", "desktop"));
  assert.ok(uri.startsWith("data:image/svg+xml,%3Csvg"));
  assert.equal(decodeURIComponent(uri.slice("data:image/svg+xml,".length)), renderEmptyKey("Claude", "desktop"));
});
