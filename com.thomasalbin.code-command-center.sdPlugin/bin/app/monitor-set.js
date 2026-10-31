// @ts-check

/** @typedef {import("./session-monitor.js").SessionMonitor} SessionMonitor */
/** @typedef {import("./session-monitor.js").TrackedSession} TrackedSession */

/**
 * Sessions come from three places: Claude Code on this Mac, Claude Code in
 * Dev Containers, and the Antigravity CLI on this Mac. This presents them as
 * one, and runs each only while a key that can show its sessions is visible.
 */
export class MonitorSet {
  #mac;
  #containers;
  #antigravity;

  /**
   * @param {SessionMonitor} mac Claude Code sessions running on this Mac
   * @param {SessionMonitor} containers Claude Code sessions running in Dev Containers; they all belong to VS Code
   * @param {SessionMonitor} antigravity Antigravity CLI sessions running on this Mac
   */
  constructor(mac, containers, antigravity) {
    this.#mac = mac;
    this.#containers = containers;
    this.#antigravity = antigravity;
  }

  /** @returns {SessionMonitor[]} */
  get #all() {
    return [this.#mac, this.#containers, this.#antigravity];
  }

  /** @returns {TrackedSession[]} */
  get sessions() {
    return this.#all.flatMap((monitor) => monitor.sessions);
  }

  /**
   * @returns {boolean} whether Claude Code sessions on this Mac can be listed.
   * While they cannot, the ones last seen here may be long gone; sessions in
   * Dev Containers and of the Antigravity CLI are listed on their own and
   * stay current. Docker being off is not a fault.
   */
  get healthy() {
    return this.#mac.healthy;
  }

  /** @param {() => void} listener */
  onChange(listener) {
    for (const monitor of this.#all) monitor.onChange(listener);
  }

  /**
   * @param {{ desktop: number, vscode: number, antigravity: number }} visible how many keys of each kind are showing
   */
  watch(visible) {
    if (visible.desktop + visible.vscode > 0) this.#mac.start();
    else this.#mac.stop();
    if (visible.vscode > 0) this.#containers.start();
    else this.#containers.stop();
    if (visible.antigravity > 0) this.#antigravity.start();
    else this.#antigravity.stop();
  }

  /** @param {string} key */
  acknowledge(key) {
    for (const monitor of this.#all) monitor.acknowledge(key);
  }

  /** Lists sessions again soon, for example after the Mac woke up. */
  requestRefresh() {
    for (const monitor of this.#all) monitor.requestRefresh();
  }
}
