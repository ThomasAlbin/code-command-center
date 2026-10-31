// @ts-check

// Gen-Z mode: whether it is on, and the beat its shimmer keeps. Session keys
// and quota keys share both, so one glint sweeps across all of them.

/** @typedef {import("./render.js").DeckPlace} DeckPlace */

/** One cycle of the shimmer: the glint sweeps across the deck, then rests. */
export const SHIMMER_MS = 6_000;
/** A deck whose size Stream Deck does not say is taken to be an MK.2. */
const USUAL_DECK = { columns: 5, rows: 3 };

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
 * Where the shimmer is in its cycle. Every key is at the same point of it, and
 * shows the part of the shimmer that lies where it sits on the deck.
 *
 * @param {number} now
 * @returns {number} from 0 to 1
 */
export function shimmerPhase(now) {
  return (now % SHIMMER_MS) / SHIMMER_MS;
}

/**
 * @param {{ column: number, row: number } | undefined} coordinates where the key sits; a key in a multi-action has none
 * @param {{ columns: number, rows: number }} [size] of the deck it is on
 * @returns {DeckPlace | undefined} nothing for a key with no place, which shimmers on its own
 */
export function placeOf(coordinates, size = USUAL_DECK) {
  if (coordinates === undefined) return undefined;
  return { column: coordinates.column, row: coordinates.row, columns: size.columns, rows: size.rows };
}
