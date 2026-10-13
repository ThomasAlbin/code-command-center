// @ts-check
import { SingletonAction } from "@elgato/streamdeck";
import { renderQuotaKey, svgToDataUri } from "../core/render.js";
import { describeLimit } from "../core/usage.js";

/** @typedef {import("../app/usage-monitor.js").UsageMonitor} UsageMonitor */

/**
 * A key that shows how much of one plan limit is used. Display only: a press
 * does nothing.
 */
export class QuotaAction extends SingletonAction {
  /** @override */
  manifestId;
  #kind;
  #title;
  #usage;
  /** @type {Map<string, { setImage: (image?: string) => Promise<void>, image?: string }>} */
  #keys = new Map();

  /**
   * @param {string} uuid the action's UUID in manifest.json
   * @param {string} kind the limit as Claude Code names it, such as `five_hour`
   * @param {string} title what the key calls it, such as `5h`
   * @param {UsageMonitor} usage
   */
  constructor(uuid, kind, title, usage) {
    super();
    this.manifestId = uuid;
    this.#kind = kind;
    this.#title = title;
    this.#usage = usage;
    usage.onChange(() => this.#draw());
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").WillAppearEvent} ev
   */
  onWillAppear(ev) {
    const { action } = ev;
    if (!action.isKey() || this.#keys.has(action.id)) return;
    this.#keys.set(action.id, { setImage: (image) => action.setImage(image) });
    this.#usage.acquire();
    this.#draw();
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").WillDisappearEvent} ev
   */
  onWillDisappear(ev) {
    if (this.#keys.delete(ev.action.id)) this.#usage.release();
  }

  #draw() {
    if (this.#keys.size === 0) return;
    const svg = renderQuotaKey(describeLimit(this.#title, this.#usage.view(this.#kind), this.#usage.pace(this.#kind)));
    for (const key of this.#keys.values()) {
      if (key.image === svg) continue;
      key.image = svg;
      key.setImage(svgToDataUri(svg)).catch(() => {
        key.image = undefined; // not delivered: send it again next time
      });
    }
  }
}
