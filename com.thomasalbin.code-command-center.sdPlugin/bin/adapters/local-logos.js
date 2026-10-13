// @ts-check
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { outlineOf } from "../core/logos.js";
import { compareVersions, parseVersion } from "../core/version.js";

/** @typedef {import("../core/logos.js").App} App */
/** @typedef {import("../core/logos.js").Logo} Logo */

/** VS Code's own logo, as the app ships it for its empty editor. */
const VS_CODE_LOGO =
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out/vs/workbench/browser/parts/editor/media/letterpress-dark.svg";
/** Claude's logo, as the Claude Code extension for VS Code ships it. */
const CLAUDE_EXTENSION = /^anthropic\.claude-code-(\d+\.\d+\.\d+)/;
const CLAUDE_LOGO = path.join("resources", "claude-logo.svg");

/**
 * The logos of the apps on this Mac, read from the apps' own files. This
 * project ships no logo of anyone else; a key shows one only where its owner
 * has put it on this machine. An app that is missing, or that keeps its logo
 * somewhere else after an update, simply yields none.
 *
 * @param {string} home
 * @param {string} [vsCodeLogo] where VS Code keeps its logo
 * @returns {Partial<Record<App, Logo>>}
 */
export function readLocalLogos(home, vsCodeLogo = VS_CODE_LOGO) {
  /** @type {Partial<Record<App, Logo>>} */
  const found = {};

  const claude = newestFirst(path.join(home, ".vscode", "extensions"))
    .map((folder) => logoIn(path.join(folder, CLAUDE_LOGO)))
    .find((logo) => logo !== undefined);
  if (claude !== undefined) found.desktop = claude;

  const vscode = logoIn(vsCodeLogo);
  if (vscode !== undefined) found.vscode = vscode;

  return found;
}

/**
 * @param {string} extensions VS Code's extensions folder
 * @returns {string[]} the folders of the Claude Code extension, newest version first
 */
function newestFirst(extensions) {
  /** @type {string[]} */
  let names;
  try {
    names = readdirSync(extensions);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => {
      const version = parseVersion(CLAUDE_EXTENSION.exec(name)?.[1] ?? "");
      return version === undefined ? [] : [{ name, version }];
    })
    .sort((a, b) => compareVersions(b.version, a.version))
    .map((entry) => path.join(extensions, entry.name));
}

/**
 * @param {string} file
 * @returns {Logo | undefined}
 */
function logoIn(file) {
  try {
    return outlineOf(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}
