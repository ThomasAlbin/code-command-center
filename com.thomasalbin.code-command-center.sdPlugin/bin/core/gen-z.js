// @ts-check

// Gen-Z mode: whether it is on, and the beat its shimmer keeps. Session keys
// and quota keys share both, so the glint travels across all of them alike.

/** One cycle of the shimmer: the glint crosses a key, then rests. */
export const SHIMMER_MS = 4_000;
/** How much later the shimmer reaches the next key along, so it travels across the deck. */
const STAGGER_MS = 300;

/**
 * Gen-Z mode is one of the plugin's own settings, which Stream Deck keeps for
 * all of its keys at once, as against each key's own.
 *
 * @param {unknown} settings as Stream Deck stores them
 * @returns {boolean} whether Gen-Z mode is on; it is not unless switched on
 */
export function genZOf(settings) {
  return settings !== null && typeof settings === "object" && /** @type {{ genZ?: unknown }} */ (settings).genZ === true;
}

/**
 * Where the shimmer of a key is in its cycle. It starts in the top left
 * corner of the deck and reaches each key a little after the one before.
 *
 * @param {number} now
 * @param {{ column: number, row: number } | undefined} coordinates where the key sits; a key in a multi-action has none
 * @returns {number} from 0 to 1
 */
export function shimmerPhase(now, coordinates) {
  const delay = coordinates === undefined ? 0 : (coordinates.column + coordinates.row) * STAGGER_MS;
  return ((((now - delay) % SHIMMER_MS) + SHIMMER_MS) % SHIMMER_MS) / SHIMMER_MS;
}
