// @ts-check

/**
 * The plugin's own settings, which Stream Deck keeps for all of its keys at
 * once, as against each key's own.
 *
 * @param {unknown} settings as Stream Deck stores them
 * @returns {boolean} whether Gen-Z mode is on; it is not unless switched on
 */
export function genZOf(settings) {
  return settings !== null && typeof settings === "object" && /** @type {{ genZ?: unknown }} */ (settings).genZ === true;
}
