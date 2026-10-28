// @ts-check
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { groupLabel, groupOf, groupsIn } from "../core/antigravity.js";
import { renderQuotaKey, svgToDataUri } from "../core/render.js";
import { describeLimit } from "../core/usage.js";

/** @typedef {import("../app/usage-monitor.js").UsageMonitor} UsageMonitor */

/**
 * @typedef {object} QuotaKey
 * @property {(image?: string) => Promise<void>} setImage
 * @property {string} [image] what the key shows now
 * @property {string} [group] the group of models whose limit it shows; only for the Antigravity CLI
 */

/**
 * A key that shows how much of one plan limit is used. Display only: a press
 * does nothing. The Antigravity CLI has a limit per group of models in each
 * window, so each of its keys shows the group chosen in its settings.
 */
export class QuotaAction extends SingletonAction {
  /** @override */
  manifestId;
  #window;
  #title;
  #usage;
  #grouped;
  /** @type {Map<string, QuotaKey>} */
  #keys = new Map();

  /**
   * @param {string} uuid the action's UUID in manifest.json
   * @param {string} window the limit's window as Claude Code names it, such as `five_hour`
   * @param {string} title what the key calls it, such as `5h`
   * @param {UsageMonitor} usage
   * @param {{ grouped?: boolean }} [options] `grouped` for the Antigravity CLI's limits, one per group of models
   */
  constructor(uuid, window, title, usage, { grouped = false } = {}) {
    super();
    this.manifestId = uuid;
    this.#window = window;
    this.#title = title;
    this.#usage = usage;
    this.#grouped = grouped;
    usage.onChange(() => this.#draw());
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").WillAppearEvent} ev
   */
  onWillAppear(ev) {
    const { action } = ev;
    if (!action.isKey() || this.#keys.has(action.id)) return;
    this.#keys.set(action.id, { setImage: (image) => action.setImage(image), group: this.#groupOf(ev.payload.settings) });
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

  /**
   * The user picked a group in the key's settings panel.
   * @override
   * @param {import("@elgato/streamdeck").DidReceiveSettingsEvent} ev
   */
  onDidReceiveSettings(ev) {
    const key = this.#keys.get(ev.action.id);
    if (key === undefined) return;
    key.group = this.#groupOf(ev.payload.settings);
    this.#draw();
  }

  /**
   * The settings panel opened: tell it which groups it can offer.
   * @override
   * @param {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} ev
   */
  async onPropertyInspectorDidAppear(ev) {
    await streamDeck.ui.sendToPropertyInspector(this.#choices(ev.action.id));
  }

  /**
   * The settings panel asks which groups it can offer.
   * @override
   * @param {import("@elgato/streamdeck").SendToPluginEvent<import("@elgato/utils").JsonValue, import("@elgato/utils").JsonObject>} ev
   */
  async onSendToPlugin(ev) {
    await streamDeck.ui.sendToPropertyInspector(this.#choices(ev.action.id));
  }

  /**
   * @param {string} id
   * @returns {{ groups: Array<{ id: string, label: string }>, group: string }}
   */
  #choices(id) {
    const group = this.#keys.get(id)?.group ?? groupOf(undefined);
    return { groups: groupsIn(this.#usage.kinds(), this.#window, group), group };
  }

  /**
   * @param {unknown} settings
   * @returns {string | undefined}
   */
  #groupOf(settings) {
    return this.#grouped ? groupOf(settings) : undefined;
  }

  #draw() {
    for (const key of this.#keys.values()) {
      const kind = key.group === undefined ? this.#window : `${this.#window}:${key.group}`;
      const view = describeLimit(this.#title, this.#usage.view(kind), this.#usage.pace(kind));
      const svg = renderQuotaKey(key.group === undefined ? view : { ...view, tag: groupLabel(key.group) });
      if (key.image === svg) continue;
      key.image = svg;
      key.setImage(svgToDataUri(svg)).catch(() => {
        key.image = undefined; // not delivered: send it again next time
      });
    }
  }
}
