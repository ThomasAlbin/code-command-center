// @ts-check

/**
 * @typedef {object} Candidate
 * @property {string} key session identity
 * @property {number} priority higher wins a contested key
 * @property {number} recency higher is more recent; breaks ties
 */

/**
 * Decides which session each visible key shows. A session keeps its key for
 * as long as both exist, so keys do not shuffle under the user's fingers.
 *
 * The returned map also carries the remembered sessions of keys that are not
 * visible right now (another page), so they get the same session back when
 * they reappear.
 *
 * @param {ReadonlyMap<string, string>} previous slot id → session key from the last call
 * @param {ReadonlyArray<Candidate>} candidates sessions that belong on these keys
 * @param {ReadonlyArray<string>} slotIds visible keys in reading order
 * @returns {{ assignment: Map<string, string>, overflow: number }}
 */
export function assignSlots(previous, candidates, slotIds) {
  const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate]));
  const visible = new Set(slotIds);
  /** @type {Map<string, string>} */
  const assignment = new Map();
  /** @type {Set<string>} */
  const shown = new Set();

  // 1. A session stays on the key it already has.
  for (const slot of slotIds) {
    const key = previous.get(slot);
    if (key !== undefined && byKey.has(key) && !shown.has(key)) {
      assignment.set(slot, key);
      shown.add(key);
    }
  }

  const waiting = candidates.filter((candidate) => !shown.has(candidate.key)).sort(bestFirst);

  // 2. Free keys fill in reading order, best candidate first.
  for (const slot of slotIds) {
    if (assignment.has(slot)) continue;
    const next = waiting.shift();
    if (next === undefined) break;
    assignment.set(slot, next.key);
    shown.add(next.key);
  }

  // 3. A candidate left over takes the key of a strictly less important session.
  for (const candidate of waiting) {
    /** @type {{ slot: string, holder: Candidate } | undefined} */
    let victim;
    for (const slot of slotIds) {
      const key = assignment.get(slot);
      const holder = key === undefined ? undefined : byKey.get(key);
      if (holder === undefined || holder.priority >= candidate.priority) continue;
      if (victim === undefined || bestFirst(holder, victim.holder) > 0) victim = { slot, holder };
    }
    if (victim === undefined) continue;
    assignment.set(victim.slot, candidate.key);
    shown.delete(victim.holder.key);
    shown.add(candidate.key);
  }

  // 4. Remember what hidden keys were showing.
  for (const [slot, key] of previous) {
    if (!visible.has(slot) && byKey.has(key)) assignment.set(slot, key);
  }

  return { assignment, overflow: candidates.length - shown.size };
}

/**
 * @param {Candidate} a
 * @param {Candidate} b
 * @returns {number}
 */
function bestFirst(a, b) {
  return b.priority - a.priority || b.recency - a.recency;
}
