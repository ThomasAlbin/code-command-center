// @ts-check

/** @typedef {import("./session-monitor.js").SessionMonitor} SessionMonitor */
/** @typedef {import("./session-monitor.js").TrackedSession} TrackedSession */

/**
 * Sessions come from two places: this Mac, and Dev Containers. This presents
 * both as one, and runs each only while a key that can show its sessions is
 * visible.
 */
export class MonitorSet {
  #mac;
  #containers;

  /**
   * @param {SessionMonitor} mac sessions running on this Mac
   * @param {SessionMonitor} containers sessions running in Dev Containers; they all belong to VS Code
   */
  constructor(mac, containers) {
    this.#mac = mac;
    this.#containers = containers;
  }

  /** @returns {TrackedSession[]} */
  get sessions() {
    return [...this.#mac.sessions, ...this.#containers.sessions];
  }

  /**
   * @returns {boolean} whether sessions on this Mac can be listed. While they
   * cannot, the ones last seen here may be long gone; sessions in Dev
   * Containers are listed on their own and stay current. Docker being off is
   * not a fault.
   */
  get healthy() {
    return this.#mac.healthy;
  }

  /** @param {() => void} listener */
  onChange(listener) {
    this.#mac.onChange(listener);
    this.#containers.onChange(listener);
  }

  /**
   * @param {{ desktop: number, vscode: number }} visible how many keys of each kind are showing
   */
  watch(visible) {
    if (visible.desktop + visible.vscode > 0) this.#mac.start();
    else this.#mac.stop();
    if (visible.vscode > 0) this.#containers.start();
    else this.#containers.stop();
  }

  /** @param {string} key */
  acknowledge(key) {
    this.#mac.acknowledge(key);
    this.#containers.acknowledge(key);
  }

  /** Lists sessions again soon, for example after the Mac woke up. */
  requestRefresh() {
    this.#mac.requestRefresh();
    this.#containers.requestRefresh();
  }
}
