// @ts-check
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const SCRIPT = readFileSync(
  new URL("../com.thomasalbin.code-command-center.sdPlugin/ui/session.js", import.meta.url),
  "utf8",
);

/**
 * Runs the settings panel's script against a minimal stand-in for the page
 * and for the connection Stream Deck gives it.
 * @param {object} settings what Stream Deck stored for the key
 */
function openPanel(settings) {
  /** @type {Array<{ value: string, textContent: string, title: string }>} */
  let options = [];
  /** @type {Record<string, (event?: object) => void>} */
  const selectListeners = {};
  const select = {
    value: "",
    get options() {
      return options;
    },
    replaceChildren() {
      options = [];
    },
    /** @param {{ value: string, textContent: string, title: string }} option */
    append(option) {
      options.push(option);
    },
    /**
     * @param {string} type
     * @param {() => void} listener
     */
    addEventListener(type, listener) {
      selectListeners[type] = listener;
    },
  };

  /** @type {object[]} */
  const sent = [];
  /** @type {Record<string, (event: { data: string }) => void>} */
  const socketListeners = {};
  class FakeSocket {
    static OPEN = 1;
    readyState = 1;
    /** @param {string} url */
    constructor(url) {
      this.url = url;
    }
    /**
     * @param {string} type
     * @param {(event: { data: string }) => void} listener
     */
    addEventListener(type, listener) {
      socketListeners[type] = listener;
    }
    /** @param {string} text */
    send(text) {
      sent.push(JSON.parse(text));
    }
  }

  const window = {};
  const context = vm.createContext({
    window,
    document: {
      /** @param {string} id */
      getElementById: (id) => (id === "pin" ? select : null),
      createElement: () => ({ value: "", textContent: "", title: "" }),
    },
    WebSocket: FakeSocket,
  });
  vm.runInContext(SCRIPT, context);

  const actionInfo = { action: "com.thomasalbin.code-command-center.session-desktop", context: "KEY", payload: { settings } };
  /** @type {any} */ (window).connectElgatoStreamDeckSocket("28196", "PANEL", "registerPropertyInspector", "{}", JSON.stringify(actionInfo));
  socketListeners.open({ data: "" });

  return {
    select,
    sent,
    /** @param {object} message */
    receive: (message) => socketListeners.message({ data: JSON.stringify(message) }),
    /** @param {string} value */
    choose(value) {
      select.value = value;
      selectListeners.change();
    },
    labels: () => options.map((option) => option.textContent),
  };
}

const PROJECTS = [
  { id: "/work/alpha", label: "alpha", running: true },
  { id: "/work/beta", label: "beta", running: true },
];

test("the panel registers and asks the plugin for the choices", () => {
  const panel = openPanel({});
  assert.deepEqual(panel.sent, [
    { event: "registerPropertyInspector", uuid: "PANEL" },
    { event: "sendToPlugin", action: "com.thomasalbin.code-command-center.session-desktop", context: "PANEL", payload: { request: "choices" } },
  ]);
  assert.deepEqual(panel.labels(), ["Automatic"]);
});

test("it lists the running projects and selects the key's own choice", () => {
  const panel = openPanel({ pin: "/work/beta" });
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: PROJECTS, pin: "/work/beta" } });
  assert.deepEqual(panel.labels(), ["Automatic", "alpha", "beta"]);
  assert.equal(panel.select.value, "/work/beta");
});

test("a chosen project that is not running stays selectable", () => {
  const panel = openPanel({ pin: "/work/sleeping" });
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: PROJECTS, pin: "/work/sleeping" } });
  assert.deepEqual(panel.labels(), ["Automatic", "alpha", "beta", "sleeping (not running)"]);
  assert.equal(panel.select.value, "/work/sleeping");
});

test("choosing a project stores it, choosing Automatic clears it", () => {
  const panel = openPanel({});
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: PROJECTS, pin: "" } });
  panel.sent.length = 0;

  panel.choose("/work/alpha");
  panel.choose("");
  assert.deepEqual(panel.sent, [
    { event: "setSettings", context: "PANEL", payload: { pin: "/work/alpha" } },
    { event: "setSettings", context: "PANEL", payload: {} },
  ]);
});

test("a switch made on the device shows up in the open panel", () => {
  const panel = openPanel({});
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: PROJECTS, pin: "" } });
  panel.receive({ event: "didReceiveSettings", payload: { settings: { pin: "/work/beta" } } });
  assert.equal(panel.select.value, "/work/beta");
  panel.receive({ event: "didReceiveSettings", payload: { settings: {} } });
  assert.equal(panel.select.value, "");
});

test("messages of the wrong shape are ignored", () => {
  const panel = openPanel({});
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: "none" } });
  panel.receive({ event: "sendToPropertyInspector", payload: { projects: [null, { id: 5 }, PROJECTS[0]] } });
  assert.deepEqual(panel.labels(), ["Automatic", "alpha"]);
});

test("the panel loads nothing from the network", () => {
  const html = readFileSync(new URL("../com.thomasalbin.code-command-center.sdPlugin/ui/session.html", import.meta.url), "utf8");
  assert.ok(!/https?:\/\//.test(html), "no remote address in the page");
  assert.ok(!/https?:\/\//.test(SCRIPT.replace(/\/\/.*$/gm, "")), "no remote address in the script");
  assert.ok(SCRIPT.includes("ws://127.0.0.1:"), "its one connection is the local one Stream Deck provides");
});
