// @ts-check

/**
 * @param {string} text such as `2.1.293`
 * @returns {number[] | undefined}
 */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * @param {ReadonlyArray<number>} a
 * @param {ReadonlyArray<number>} b
 * @returns {number} positive when `a` is newer
 */
export function compareVersions(a, b) {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
