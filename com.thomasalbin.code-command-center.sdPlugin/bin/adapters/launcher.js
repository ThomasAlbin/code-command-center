// @ts-check
import { readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findDevContainerWindow, findFolderWindow } from "../core/vscode-windows.js";
import { codeOpenDevContainer, openApp, openClaudeSession } from "./exec.js";

/** @typedef {import("../core/focus.js").FocusTarget} FocusTarget */

/**
 * Where VS Code records the folders of its windows. Read only to find a Dev
 * Container's address, and the window an Antigravity CLI session's terminal is in.
 */
const VS_CODE_STATE = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Code",
  "User",
  "globalStorage",
  "storage.json",
);

/**
 * @param {FocusTarget} target
 * @returns {Promise<void>}
 */
export async function bringToFront(target) {
  if (target.session !== undefined) {
    try {
      await openClaudeSession(target.session);
      return;
    } catch {
      // Fall through: bringing the app forward is better than nothing.
    }
  }
  if (target.devContainer !== undefined) {
    const { localFolder, path: containerPath } = target.devContainer;
    const address = findDevContainerWindow(readVsCodeState(), localFolder, containerPath);
    if (address !== undefined) {
      try {
        await codeOpenDevContainer(address);
        return;
      } catch {
        // Fall through: bringing the app forward is better than nothing.
      }
    }
  }
  // Only a window that is open is looked for: VS Code would open a new one for any other folder.
  const wanted = target.folder ?? (target.within === undefined ? undefined : findFolderWindow(readVsCodeState(), target.within));
  // Opening a folder that is gone would only produce an error window.
  const folder = wanted !== undefined && isDirectory(wanted) ? wanted : undefined;
  await openApp(target.bundleId, folder);
}

/**
 * @returns {string} empty when VS Code has no state file
 */
function readVsCodeState() {
  try {
    return readFileSync(VS_CODE_STATE, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {string} folder
 * @returns {boolean}
 */
function isDirectory(folder) {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
