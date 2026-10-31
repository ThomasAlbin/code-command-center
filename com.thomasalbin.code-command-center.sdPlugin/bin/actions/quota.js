// @ts-check
import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { groupLabel, groupOf, groupsIn } from "../core/antigravity.js";
import { renderQuotaKey, svgToDataUri } from "../core/render.js";
import { genZOf } from "../core/settings.js";
import { describeLimit } from "../core/usage.js";

/** @typedef {import("../app/usage-monitor.js").UsageMonitor} UsageMonitor */

/** How long a press shows when the limit resets. */
const RESET_SHOWN_MS = 3000;
/** In Gen-Z mode: one sway of the grass on a key whose limit is full, and how often it is redrawn. */
const GRASS_MS = 2_400;
const GRASS_FRAME_MS = 200;

/**
 * @typedef {object} QuotaKey
 * @property {(image?: string) => Promise<void>} setImage
 * @property {string} [image] what the key shows now
 * @property {string} [group] the group of models whose limit it shows; only for the Antigravity CLI
 * @property {ReturnType<typeof setTimeout>} [reset] set while the key shows when its limit resets
 */

/**
 * A key that shows how much of one plan limit is used. A press shows the time
 * the limit resets, for a moment, and in Gen-Z mode a full limit tells you to
 * touch grass. The Antigravity CLI has a limit per group of models in each
 * window, so each of its keys shows the group chosen in its settings.
 */
export class QuotaAction extends SingletonAction {
  /** @override */
  manifestId;
  #window;
  #title;
  #usage;
  #grouped;
  #tag;
  /** @type {Map<string, QuotaKey>} */
  #keys = new Map();
  /** Whether a full limit tells you to touch grass, a setting for all keys at once. */
  #genZ = false;
  /** @type {ReturnType<typeof setTimeout> | undefined} the next frame of swaying grass */
  #frame;

  /**
   * @param {string} uuid the action's UUID in manifest.json
   * @param {string} window the limit's window as Claude Code names it, such as `five_hour`
   * @param {string} title what the key calls it, such as `5h`
   * @param {UsageMonitor} usage
   * @param {{ grouped?: boolean, tag?: string }} [options] `grouped` for the Antigravity CLI's limits, one per
   *   group of models, each named in the key's corner; `tag` names whose limit a key without groups shows there
   */
  constructor(uuid, window, title, usage, { grouped = false, tag } = {}) {
    super();
    this.manifestId = uuid;
    this.#window = window;
    this.#title = title;
    this.#usage = usage;
    this.#grouped = grouped;
    this.#tag = tag;
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
    clearTimeout(this.#keys.get(ev.action.id)?.reset);
    if (this.#keys.delete(ev.action.id)) this.#usage.release();
    if (this.#keys.size === 0) clearTimeout(this.#frame);
  }

  /**
   * The plugin's settings changed: they say whether Gen-Z mode is on.
   * @param {unknown} settings
   */
  globalSettingsChanged(settings) {
    this.#genZ = genZOf(settings);
    this.#draw();
  }

  /**
   * Shows when the limit resets. Another press while it shows starts the time anew.
   * @override
   * @param {import("@elgato/streamdeck").KeyDownEvent} ev
   */
  onKeyDown(ev) {
    const key = this.#keys.get(ev.action.id);
    if (key === undefined) return;
    clearTimeout(key.reset);
    key.reset = setTimeout(() => {
      key.reset = undefined;
      this.#draw();
    }, RESET_SHOWN_MS);
    this.#draw();
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
    const grass = this.#genZ ? (Date.now() % GRASS_MS) / GRASS_MS : undefined;
    let swaying = false;
    for (const key of this.#keys.values()) {
      const kind = key.group === undefined ? this.#window : `${this.#window}:${key.group}`;
      const view = describeLimit(this.#title, this.#usage.view(kind), this.#usage.pace(kind), { reset: key.reset !== undefined, grass });
      if (view.grass !== undefined) swaying = true;
      const tag = key.group === undefined ? this.#tag : groupLabel(key.group);
      const svg = renderQuotaKey(tag === undefined ? view : { ...view, tag });
      if (key.image === svg) continue;
      key.image = svg;
      key.setImage(svgToDataUri(svg)).catch(() => {
        key.image = undefined; // not delivered: send it again next time
      });
    }
    clearTimeout(this.#frame);
    if (!swaying) return;
    this.#frame = setTimeout(() => this.#draw(), GRASS_FRAME_MS);
    this.#frame.unref(); // the link to Stream Deck keeps the process alive, not this
  }
}
