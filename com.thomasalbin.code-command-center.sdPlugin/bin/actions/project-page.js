// @ts-check
import { SingletonAction } from "@elgato/streamdeck";
import { PROJECT_PAGE } from "../core/project.js";

/**
 * A key that shows the plugin's logo and opens the project's page. The logo
 * is the key's picture in the manifest and never changes, so nothing is
 * drawn here.
 */
export class ProjectPageAction extends SingletonAction {
  /** @override */
  manifestId;
  #open;

  /**
   * @param {string} uuid the action's UUID in manifest.json
   * @param {(url: string) => Promise<void>} open asks the Stream Deck app to open an address in the browser
   */
  constructor(uuid, open) {
    super();
    this.manifestId = uuid;
    this.#open = open;
  }

  /**
   * @override
   * @param {import("@elgato/streamdeck").KeyDownEvent} ev
   */
  async onKeyDown(ev) {
    try {
      await this.#open(PROJECT_PAGE);
    } catch {
      await ev.action.showAlert().catch(() => {});
    }
  }
}
