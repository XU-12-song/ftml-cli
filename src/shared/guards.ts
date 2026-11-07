/**
 * 是否为有限 *数字* .
 *
 * @param {number} number
 * @returns {number is number}
 */
export function isFinite(number?: number): number is number {
  return Number.isFinite(number);
}

