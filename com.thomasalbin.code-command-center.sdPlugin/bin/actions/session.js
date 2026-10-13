// @ts-check
import streamDeck, { SingletonAction } from "@elgato/streamdeck";

/** @typedef {import("../app/board.js").Board} Board */
/** @typedef {import("../app/board.js").Group} Group */

/** Holding a key this long switches it to the next project instead of pressing it. */
const HOLD_MS = 700;

/**
 * A key that shows one Claude Code session of one app. Which session is the
 * board's decision; this class only passes Stream Deck's events on.
 */
export class SessionAction extends SingletonAction {
  /** @override */
  manifestId;
  #group;
  #board;
  /** @type {Map<string, NodeJS.Timeout>} key id → the hold that is still counting */
  #holds = new Map();

  /**
   * @param {string} uuid the action's UUID in manifest.json
   * @param {Group} group
   * @param {Board} board
   */
  constructor(uuid, group, board) {
    super();
    this.manifestId = uuid;
    this.#group = group;
    this.#board = board;
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").WillAppearEvent} ev
   */
  onWillAppear(ev) {
    if (ev.action.isKey()) this.#board.keyAppeared(this.#group, ev.action, ev.payload.settings);
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").WillDisappearEvent} ev
   */
  onWillDisappear(ev) {
    this.#cancelHold(ev.action.id);
    this.#board.keyDisappeared(ev.action.id);
  }

  /**
   * The user picked a project in the key's settings panel.
   * @override
   * @param {import("@elgato/streamdeck").DidReceiveSettingsEvent} ev
   */
  onDidReceiveSettings(ev) {
    this.#board.settingsChanged(ev.action.id, ev.payload.settings);
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").KeyDownEvent} ev
   */
  onKeyDown(ev) {
    const { action } = ev;
    this.#cancelHold(action.id);
    const hold = setTimeout(() => {
      this.#holds.delete(action.id);
      const choice = this.#board.keyHeld(action.id);
      if (choice === undefined) return;
      // Stored by Stream Deck, so the key is still reserved after a restart.
      action.setSettings(choice.pin === undefined ? {} : { pin: choice.pin }).catch(() => {});
    }, HOLD_MS);
    this.#holds.set(action.id, hold);
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").KeyUpEvent} ev
   */
  async onKeyUp(ev) {
    if (!this.#cancelHold(ev.action.id)) return; // held long enough: already handled
    try {
      await this.#board.keyPressed(ev.action.id);
    } catch {
      await ev.action.showAlert();
    }
  }

  /**
   * The settings panel opened: tell it which projects it can offer.
   * @override
   * @param {import("@elgato/streamdeck").PropertyInspectorDidAppearEvent} ev
   */
  async onPropertyInspectorDidAppear(ev) {
    await streamDeck.ui.sendToPropertyInspector(this.#board.choices(ev.action.id));
  }

  /**
   * The settings panel asks which projects it can offer.
   * @override
   * @param {import("@elgato/streamdeck").SendToPluginEvent<import("@elgato/utils").JsonValue, import("@elgato/utils").JsonObject>} ev
   */
  async onSendToPlugin(ev) {
    await streamDeck.ui.sendToPropertyInspector(this.#board.choices(ev.action.id));
  }

  /**
   * @param {string} id
   * @returns {boolean} whether a hold was still counting
   */
  #cancelHold(id) {
    const hold = this.#holds.get(id);
    if (hold === undefined) return false;
    clearTimeout(hold);
    this.#holds.delete(id);
    return true;
  }
}
