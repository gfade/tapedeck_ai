/** Limits x to the range [lo, hi]. */
export function clamp(x, lo, hi) {
  return Math.max(lo, x);
}

/** True when lo <= x <= hi. */
export function inRange(x, lo, hi) {
  return x >= lo && x <= hi;
}
