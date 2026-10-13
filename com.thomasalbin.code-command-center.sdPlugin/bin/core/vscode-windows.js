// @ts-check

// VS Code addresses the window of a Dev Container as
// `vscode-remote://dev-container+<hex>/<folder inside the container>`, where
// the hex part encodes, among other things, the folder on the Mac that the
// container was opened from. Asking VS Code to open that exact address brings
// the existing window forward.

const ADDRESS = "vscode-remote://dev-container(?:%2B|\\+)([0-9a-f]+)(/[A-Za-z0-9._~%/+-]*)";
const ANY_ADDRESS = new RegExp(ADDRESS, "g");
const WHOLE_ADDRESS = new RegExp(`^${ADDRESS}$`);

/**
 * @param {string} address
 * @returns {boolean}
 */
export function isDevContainerAddress(address) {
  return WHOLE_ADDRESS.test(address);
}

/**
 * Looks up the address of a Dev Container's window in the contents of VS
 * Code's `storage.json`, where VS Code records the folders of its windows.
 *
 * @param {string} storage contents of the file
 * @param {string} localFolder folder on the Mac that the container was opened from
 * @param {string} [containerPath] folder inside the container, to prefer the exact window
 * @returns {string | undefined}
 */
export function findDevContainerWindow(storage, localFolder, containerPath) {
  /** @type {string | undefined} */
  let sameContainer;
  for (const [address, hex, pathPart] of storage.matchAll(ANY_ADDRESS)) {
    if (hostFolderOf(hex) !== localFolder) continue;
    if (containerPath === undefined || decode(pathPart) === containerPath) return address;
    sameContainer ??= address;
  }
  return sameContainer;
}

/**
 * @param {string} hex
 * @returns {string | undefined} the folder on the Mac encoded in an address
 */
function hostFolderOf(hex) {
  const text = Buffer.from(hex, "hex").toString("utf8");
  try {
    const data = JSON.parse(text);
    return typeof data?.hostPath === "string" ? data.hostPath : undefined;
  } catch {
    return text; // older VS Code versions encode the folder itself
  }
}

/**
 * @param {string} text
 * @returns {string}
 */
function decode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
