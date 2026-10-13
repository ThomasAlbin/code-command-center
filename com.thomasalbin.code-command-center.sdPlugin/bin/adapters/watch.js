// @ts-check
import { watch } from "node:fs";

const RETRY_MS = 30_000;

/**
 * Calls `onChange` when a file whose name matches `pattern` changes in
 * `directory`. The files themselves are never opened. Keeps trying when the
 * directory does not exist yet or the watcher fails.
 *
 * @param {string} directory
 * @param {RegExp} pattern
 * @param {() => void} onChange
 * @returns {{ close(): void }}
 */
export function watchDirectory(directory, pattern, onChange) {
  /** @type {import("node:fs").FSWatcher | undefined} */
  let watcher;
  /** @type {NodeJS.Timeout | undefined} */
  let retry;
  let closed = false;

  const rearm = () => {
    watcher?.close();
    watcher = undefined;
    if (closed) return;
    clearTimeout(retry);
    retry = setTimeout(arm, RETRY_MS);
  };

  const arm = () => {
    if (closed) return;
    try {
      watcher = watch(directory, (_event, filename) => {
        if (filename === null || pattern.test(filename)) onChange();
      });
      watcher.on("error", rearm);
    } catch {
      rearm();
    }
  };

  arm();
  return {
    close() {
      closed = true;
      clearTimeout(retry);
      watcher?.close();
    },
  };
}
