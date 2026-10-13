// @ts-check
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { PROJECT_PAGE } from "../com.thomasalbin.code-command-center.sdPlugin/bin/core/project.js";

const PLUGIN = new URL("../com.thomasalbin.code-command-center.sdPlugin/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", PLUGIN), "utf8"));
const entry = readFileSync(new URL("bin/plugin.js", PLUGIN), "utf8");

/**
 * @param {string} name a picture as the manifest names it, without its ending
 * @returns {boolean} whether a file of that name is there in a form Stream Deck takes
 */
const pictured = (name) => [".svg", ".png"].some((ending) => existsSync(new URL(`${name}${ending}`, PLUGIN)));

test("every key in the manifest has its pictures and is handled by the plugin", () => {
  assert.equal(manifest.Actions.length, 5);
  for (const action of manifest.Actions) {
    assert.ok(action.UUID.startsWith(`${manifest.UUID}.`), action.UUID);
    assert.ok(pictured(action.Icon), `${action.Name}: icon in the list of actions`);
    assert.ok(pictured(action.States[0].Image), `${action.Name}: picture of the key`);
    assert.ok(entry.includes(`\`\${PLUGIN}.${action.UUID.slice(manifest.UUID.length + 1)}\``), `${action.Name}: registered in plugin.js`);
    assert.equal(action.UserTitleEnabled, false);
  }
  assert.ok(pictured(manifest.Icon) && pictured(manifest.CategoryIcon));
});

test("the names of the keys are written with capitals and carry no name of Anthropic's", () => {
  const names = manifest.Actions.map((/** @type {{ Name: string }} */ action) => action.Name);
  assert.deepEqual(names, ["Desktop Session", "Session in VS Code", "Quota 5h", "Quota 7d", "Project Page"]);
  for (const name of names) assert.doesNotMatch(name, /claude|anthropic/i);
});

test("the logo key opens the project's page and nothing else", () => {
  assert.equal(PROJECT_PAGE, "https://github.com/ThomasAlbin/code-command-center");
  const source = readFileSync(new URL("bin/actions/project-page.js", PLUGIN), "utf8");
  assert.equal((source.match(/#open\(/g) ?? []).length, 1);
  assert.ok(source.includes("await this.#open(PROJECT_PAGE);"), "the address is the fixed one, not something handed in");
  // Opening an address is the Stream Deck app's part, and this key is the only one that asks for it.
  assert.equal((entry.match(/openUrl/g) ?? []).length, 1);
  const key = readFileSync(new URL("imgs/actions/project-page/key.svg", PLUGIN), "utf8");
  for (const colour of ["#1F6FEB", "#F0883E", "#2EA043"]) assert.ok(key.includes(colour), "the three colours of the logo");
});
