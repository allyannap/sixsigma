// Small helpers for drawing SVG charts. They place numbers on a canvas; they compute no statistics.

/** Straight-line scale: data value -> pixel. */
export function linear(d0, d1, r0, r1) {
  return (v) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0)
}

/** Log scale: data value (> 0) -> pixel. Response times are right-skewed, so charts use this. */
export function logScale(d0, d1, r0, r1) {
  const a = Math.log(d0)
  const b = Math.log(d1)
  return (v) => r0 + ((Math.log(v) - a) / (b - a || 1)) * (r1 - r0)
}

const MINUTE_TICKS = [0.5, 1, 2, 3, 5, 8, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480]

/** Round-number minute ticks inside [lo, hi] for a log axis. */
export function logTicks(lo, hi) {
  const ticks = MINUTE_TICKS.filter((t) => t >= lo && t <= hi)
  return ticks.length >= 2 ? ticks : [lo, hi]
}

/** Many dots as ONE svg path ("M x y h0" with round caps) so thousands of calls stay fast. */
export function dotsPath(points) {
  return points.map(([x, y]) => `M${x.toFixed(1)} ${y.toFixed(1)}h0`).join('')
}

/** A line through points as an svg path. */
export function linePath(points) {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('')
}
