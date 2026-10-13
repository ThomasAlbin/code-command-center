// Runs the plugin against a stand-in for the Stream Deck app, on Stream Deck's
// own Node runtime, and saves what each key would show. A development aid:
// it is not part of the plugin and listens on 127.0.0.1 only while it runs.
//
//   node scripts/dev/mock-streamdeck.mjs [output-folder] [seconds] [--hold] [--press] [--plugin=<folder>]
//
// --plugin runs another copy of the plugin, such as an installed or unpacked
// one, instead of the one in this repository.
//
// With --hold, the first desktop key is held three times after the first
// picture, to show it stepping through projects, and the settings panel's
// question is asked. With --press, the first desktop key is pressed once,
// which really brings the Claude app forward on that key's session. Without
// --press no key is pressed short, so no window moves.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "../../com.thomasalbin.code-command-center.sdPlugin/node_modules/ws/wrapper.mjs";

const PLUGIN = "com.thomasalbin.code-command-center";
const DEVICE = "MOCKDECK";
const CELL = 144;
const GAP = 12;
const STATES = {
  "#1F6FEB": "working",
  "#F0883E": "waiting",
  "#FFD9A6": "waiting, pulse",
  "#2EA043": "done",
  "#12361F": "idle",
  "#DA3633": "error",
  "#30363D": "no data",
  "#0D1117": "dark",
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pluginArg = process.argv.find((arg) => arg.startsWith("--plugin="));
const pluginDir = pluginArg === undefined ? path.join(root, `${PLUGIN}.sdPlugin`) : path.resolve(pluginArg.slice("--plugin=".length));
const args = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const hold = process.argv.includes("--hold");
const press = process.argv.includes("--press");
const outDir = args[0] ?? path.join(os.tmpdir(), "code-command-center-mock");
const seconds = Number(args[1] ?? 6);

// Stream Deck keeps its Node runtimes in a folder per version; the plugin asks for version 24.
const runtimes = path.join(os.homedir(), "Library/Application Support/com.elgato.StreamDeck/NodeJS");
const bundledNode = (existsSync(runtimes) ? readdirSync(runtimes) : [])
  .filter((version) => version.startsWith("24."))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((version) => path.join(runtimes, version, "node"))
  .findLast((file) => existsSync(file));
const node = bundledNode ?? process.execPath;

// The layout the README suggests, sent in reverse to show order does not matter.
const keys = [
  { context: "quota-5h", action: `${PLUGIN}.quota-5h`, row: 0, column: 0 },
  { context: "quota-7d", action: `${PLUGIN}.quota-7d`, row: 0, column: 1 },
  ...[0, 1, 2].flatMap((column) => [
    { context: `desktop-${column}`, action: `${PLUGIN}.session-desktop`, row: 1, column },
    { context: `vscode-${column}`, action: `${PLUGIN}.session-vscode`, row: 2, column },
  ]),
].reverse();

/** @type {Map<string, string>} context → latest SVG */
const shown = new Map();
let updates = 0;

mkdirSync(outDir, { recursive: true });
const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address();

const info = {
  application: { font: "Helvetica", language: "en", platform: "mac", platformVersion: "26.0.0", version: "7.6.0.0" },
  colors: {},
  devicePixelRatio: 2,
  devices: [{ id: DEVICE, name: "Mock Stream Deck", size: { columns: 5, rows: 3 }, type: 0 }],
  plugin: { uuid: PLUGIN, version: "1.0.0.0" },
};

const child = spawn(
  node,
  ["--no-global-search-paths", "bin/plugin.js", "-port", String(port), "-pluginUUID", "MOCK", "-registerEvent", "registerPlugin", "-info", JSON.stringify(info)],
  {
    cwd: pluginDir,
    env: { HOME: os.homedir(), PATH: "/usr/bin:/bin:/usr/sbin:/sbin", USER: os.userInfo().username, TMPDIR: os.tmpdir() },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let output = "";
child.stdout.on("data", (data) => (output += data));
child.stderr.on("data", (data) => (output += data));
child.on("exit", (code, signal) => {
  if (signal !== "SIGTERM") console.log(`plugin exited early: code ${code}, signal ${signal}\n${output}`);
});

const started = Date.now();
const stamp = () => `+${String(Date.now() - started).padStart(5)} ms `;

/**
 * @param {import("ws").WebSocket} socket
 * @param {string} event
 * @param {{ context: string, action: string, row: number, column: number }} key
 * @param {object} [payload]
 */
function sendKeyEvent(socket, event, key, payload = {}) {
  socket.send(
    JSON.stringify({
      event,
      action: key.action,
      context: key.context,
      device: DEVICE,
      payload: { controller: "Keypad", coordinates: { column: key.column, row: key.row }, isInMultiAction: false, settings: {}, ...payload },
    }),
  );
}

server.on("connection", (socket) => {
  socket.on("message", (data) => {
    const message = JSON.parse(String(data));
    if (message.event === "registerPlugin") {
      console.log(`${stamp()} plugin registered on the ${path.basename(path.dirname(node))} runtime`);
      for (const key of keys) sendKeyEvent(socket, "willAppear", key);
      if (hold) scheduleHolds(socket);
      if (press) schedulePress(socket);
    } else if (message.event === "setImage") {
      const svg = decodeURIComponent(String(message.payload.image).replace("data:image/svg+xml,", ""));
      shown.set(message.context, svg);
      updates += 1;
      console.log(`${stamp()} ${message.context.padEnd(10)} ${describe(svg)}`);
    } else if (message.event === "setSettings") {
      console.log(`${stamp()} ${message.context.padEnd(10)} stores ${JSON.stringify(redact(message.payload))}`);
    } else if (message.event === "sendToPropertyInspector") {
      const { projects = [], pin } = message.payload ?? {};
      console.log(`${stamp()} settings panel is offered ${projects.length} projects: ${projects.map((p) => `${p.label}${p.running ? "" : " (not running)"}`).join(", ")}; chosen: ${pin === "" ? "automatic" : path.basename(pin)}`);
    } else {
      console.log(`${stamp()} ${message.event}`);
    }
  });
});

/**
 * Holds the first desktop key three times, a second apart, then asks what the
 * settings panel would ask.
 * @param {import("ws").WebSocket} socket
 */
function scheduleHolds(socket) {
  const key = keys.find((candidate) => candidate.context === "desktop-0");
  if (key === undefined) return;
  for (const [index, at] of [2000, 3200, 4400].entries()) {
    setTimeout(() => {
      console.log(`${stamp()} --- hold ${index + 1} on desktop-0 ---`);
      sendKeyEvent(socket, "keyDown", key);
      setTimeout(() => sendKeyEvent(socket, "keyUp", key), 900);
    }, at);
  }
  setTimeout(() => {
    console.log(`${stamp()} --- settings panel asks for the choices of desktop-1 ---`);
    const other = keys.find((candidate) => candidate.context === "desktop-1");
    if (other === undefined) return;
    // As Stream Deck does: announce the panel, then deliver its question.
    socket.send(JSON.stringify({ event: "propertyInspectorDidAppear", action: other.action, context: other.context, device: DEVICE }));
    socket.send(JSON.stringify({ event: "sendToPlugin", action: other.action, context: other.context, payload: { request: "choices" } }));
  }, 2600);
}

/**
 * Presses the first desktop key once, shortly after the first picture.
 * @param {import("ws").WebSocket} socket
 */
function schedulePress(socket) {
  const key = keys.find((candidate) => candidate.context === "desktop-0");
  if (key === undefined) return;
  setTimeout(() => {
    console.log(`${stamp()} --- press on desktop-0 ---`);
    sendKeyEvent(socket, "keyDown", key);
    setTimeout(() => sendKeyEvent(socket, "keyUp", key), 120);
  }, 2000);
}

/** @param {string} svg */
function describe(svg) {
  const colour = /<rect[^>]*fill="(#[0-9A-F]{6})"/.exec(svg)?.[1] ?? "?";
  const texts = [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((match) => match[1]);
  const pinned = svg.includes('cx="17"') ? " [reserved]" : "";
  const tick = /<path d="M(\d+) 91V111"/.exec(svg)?.[1];
  const pace = tick === undefined ? "" : ` [even use at ${Math.round((Number(tick) - 12) / 1.2)}%]`;
  const framed = svg.includes('<rect x="3" y="3"') ? " [framed]" : "";
  const logo = svg.includes('fill-rule="evenodd"') ? " [logo read from VS Code]" : /fill-rule="nonzero" d="M 12 1 C|fill-rule="nonzero" d="M 8 5\.5/.test(svg) ? " [own mark]" : svg.includes('fill-rule="nonzero"') ? " [logo read from the Claude Code extension]" : "";
  return `${(STATES[colour] ?? colour).padEnd(8)} ${JSON.stringify(texts.join(" "))}${pinned}${pace}${framed}${logo}`;
}

/** Keeps folder names but not whole paths out of the output. */
function redact(payload) {
  return typeof payload?.pin === "string" ? { pin: `…/${path.basename(payload.pin)}` } : payload;
}

setTimeout(() => {
  // One picture of the deck: every key at its place on a 5 x 3 grid.
  const cells = keys
    .map((key) => {
      const svg = shown.get(key.context) ?? "";
      const x = GAP + key.column * (CELL + GAP);
      const y = GAP + key.row * (CELL + GAP);
      return svg.replace("<svg ", `<svg x="${x}" y="${y}" `);
    })
    .join("");
  const [width, height] = [GAP + 5 * (CELL + GAP), GAP + 3 * (CELL + GAP)];
  writeFileSync(
    path.join(outDir, "deck.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#000"/>${cells}</svg>`,
  );
  console.log(`\n${updates} image updates for ${shown.size} of ${keys.length} keys. Deck picture: ${path.join(outDir, "deck.svg")}`);
  if (output.trim() !== "") console.log(`plugin output:\n${output}`);
  child.kill("SIGTERM");
  server.close();
  process.exit(shown.size === keys.length ? 0 : 1);
}, seconds * 1000);
