// @ts-check
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The install and uninstall scripts, run against a stand-in home folder.
// Every path they touch is handed to them, so the real home is never used.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SETTINGS_TOOL = path.join(ROOT, "scripts", "lib", "settings.mjs");
const PLUGIN = "com.thomasalbin.code-command-center.sdPlugin";
const OURS = { marketplace: "code-command-center", mod: "deck-bridge@code-command-center" };

/**
 * @param {(home: string) => void} body
 */
function withHome(body) {
  const home = mkdtempSync(path.join(os.tmpdir(), "ccc-scripts-"));
  try {
    mkdirSync(path.join(home, ".claude"));
    body(home);
  } finally {
    // The mod's copy is write-protected, which would stop the clean-up.
    spawnSync("/bin/chmod", ["-R", "u+w", home]);
    rmSync(home, { recursive: true, force: true });
  }
}

/**
 * @param {string} file
 * @returns {Record<string, any>}
 */
const json = (file) => JSON.parse(readFileSync(file, "utf8"));

/**
 * @param {string[]} args
 * @returns {{ status: number | null, out: string }}
 */
function settingsTool(...args) {
  const result = spawnSync(process.execPath, [SETTINGS_TOOL, ...args], { encoding: "utf8" });
  return { status: result.status, out: result.stdout + result.stderr };
}

/**
 * @param {string} script
 * @param {string} home
 * @param {{ node?: boolean, args?: string[] }} [options] `node: false` runs it as on a Mac without Node.js
 * @returns {{ status: number | null, out: string }}
 */
function run(script, home, { node = true, args = ["--yes"] } = {}) {
  const result = spawnSync("/bin/sh", [path.join(ROOT, "scripts", script), ...args], {
    encoding: "utf8",
    env: {
      HOME: home,
      CLAUDE_CONFIG_DIR: path.join(home, ".claude"),
      STREAMDECK_PLUGINS_DIR: path.join(home, "Plugins"),
      PATH: node ? `${path.dirname(process.execPath)}:/usr/bin:/bin` : "/usr/bin:/bin",
    },
  });
  return { status: result.status, out: result.stdout + result.stderr };
}

const OTHERS = {
  model: "something",
  extraKnownMarketplaces: { another: { source: { source: "directory", path: "/elsewhere" } } },
  enabledPlugins: { "other@another": true },
};

test("the two entries are added next to what is there, and taken out again without a trace", () => {
  withHome((home) => {
    const file = path.join(home, ".claude", "settings.json");
    writeFileSync(file, JSON.stringify(OTHERS), { mode: 0o600 });

    assert.equal(settingsTool("add", file, "/copy/of/mod").status, 0);
    const added = json(file);
    assert.deepEqual(added.extraKnownMarketplaces[OURS.marketplace], { source: { source: "directory", path: "/copy/of/mod" } });
    assert.equal(added.enabledPlugins[OURS.mod], true);
    assert.equal(added.enabledPlugins["other@another"], true);
    assert.equal(lstatSync(file).mode & 0o777, 0o600, "the file keeps its access rights");

    assert.equal(settingsTool("remove", file).status, 0);
    assert.deepEqual(json(file), OTHERS);
    const backups = readdirSync(path.join(home, ".claude")).filter((name) => name.includes(".backup-"));
    assert.ok(backups.length >= 1, "a backup is kept before every change");
  });
});

test("a settings file that is a link stays a link, and the file it leads to is the one changed", () => {
  withHome((home) => {
    const real = path.join(home, "dotfiles", "claude-settings.json");
    const link = path.join(home, ".claude", "settings.json");
    mkdirSync(path.dirname(real));
    writeFileSync(real, JSON.stringify(OTHERS));
    symlinkSync(real, link);

    assert.equal(settingsTool("add", link, "/copy/of/mod").status, 0);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(json(real).enabledPlugins[OURS.mod], true);
    assert.ok(readdirSync(path.join(home, ".claude")).some((name) => name.startsWith("settings.json.backup-")), "the backup lies next to the link");

    assert.equal(settingsTool("remove", link).status, 0);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.deepEqual(json(real), OTHERS);
  });
});

test("a link to a settings file that does not exist yet is filled, not replaced", () => {
  withHome((home) => {
    const real = path.join(home, "dotfiles", "claude-settings.json");
    const link = path.join(home, ".claude", "settings.json");
    symlinkSync(real, link);
    assert.equal(settingsTool("add", link, "/copy/of/mod").status, 0);
    assert.ok(lstatSync(link).isSymbolicLink());
    assert.equal(json(real).enabledPlugins[OURS.mod], true);
  });
});

test("settings that are not valid JSON are left exactly as they are", () => {
  withHome((home) => {
    const file = path.join(home, ".claude", "settings.json");
    writeFileSync(file, "{ not json");
    for (const command of [["add", file, "/copy"], ["remove", file], ["check", file]]) {
      const result = settingsTool(...command);
      assert.equal(result.status, 1);
      assert.match(result.out, /not valid JSON/);
    }
    assert.equal(readFileSync(file, "utf8"), "{ not json");
  });
});

test("the mod is installed as a write-protected copy and the uninstall removes all of it", () => {
  withHome((home) => {
    const file = path.join(home, ".claude", "settings.json");
    writeFileSync(file, JSON.stringify(OTHERS));
    const plugin = path.join(home, "Plugins", PLUGIN);
    mkdirSync(plugin, { recursive: true });
    writeFileSync(path.join(plugin, "manifest.json"), "{}");

    const installed = run("install-mod.sh", home);
    assert.equal(installed.status, 0, installed.out);
    const copy = path.join(home, ".code-command-center", "marketplace");
    assert.equal(json(file).extraKnownMarketplaces[OURS.marketplace].source.path, copy);
    assert.equal(
      readFileSync(path.join(copy, "mod", "deck-bridge", "hooks", "register.js"), "utf8"),
      readFileSync(path.join(ROOT, "mod", "deck-bridge", "hooks", "register.js"), "utf8"),
    );
    assert.equal(lstatSync(path.join(copy, "mod", "deck-bridge", "hooks", "register.js")).mode & 0o222, 0, "not writable");
    assert.ok(existsSync(path.join(home, ".code-command-center", "usage")));

    const removed = run("uninstall.sh", home);
    assert.equal(removed.status, 0, removed.out);
    assert.match(removed.out, /Removed\. Quit and reopen/);
    assert.ok(!existsSync(plugin));
    assert.ok(!existsSync(path.join(home, ".code-command-center")));
    assert.deepEqual(json(file), OTHERS);
  });
});

test("without Node.js the uninstall says that the two entries are still there", (t) => {
  if (spawnSync("/bin/sh", ["-c", "command -v node"], { env: { PATH: "/usr/bin:/bin" } }).status === 0) {
    t.skip("this machine has node in a system folder");
    return;
  }
  withHome((home) => {
    const file = path.join(home, ".claude", "settings.json");
    assert.equal(run("install-mod.sh", home).status, 0);
    const before = readFileSync(file, "utf8");

    const removed = run("uninstall.sh", home, { node: false });
    assert.equal(removed.status, 1);
    assert.match(removed.out, /two entries are still in/);
    assert.doesNotMatch(removed.out, /^Removed\./m);
    assert.equal(readFileSync(file, "utf8"), before);
    assert.ok(!existsSync(path.join(home, ".code-command-center")), "the rest is removed all the same");
  });
});

test("an uninstall that cannot read the settings removes nothing", () => {
  withHome((home) => {
    assert.equal(run("install-mod.sh", home).status, 0);
    writeFileSync(path.join(home, ".claude", "settings.json"), "{ not json");
    const removed = run("uninstall.sh", home);
    assert.notEqual(removed.status, 0);
    assert.ok(existsSync(path.join(home, ".code-command-center", "marketplace")), "the mod's copy is still there");
  });
});

test("every script parses", () => {
  for (const script of ["install.sh", "install-mod.sh", "install-mod-container.sh", "uninstall.sh", "pack.sh"]) {
    execFileSync("/bin/sh", ["-n", path.join(ROOT, "scripts", script)]);
  }
});
