// Formatting only. Every number shown on the page comes from the API.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const missing = (n) => n === null || n === undefined || Number.isNaN(n)

/** 12345 -> "12,345"; missing -> "n/a". */
export function fmtInt(n) {
  return missing(n) ? 'n/a' : Math.round(n).toLocaleString('en-US')
}

/** 3.14159, 1 -> "3.1"; missing -> "n/a". */
export function fmtNum(n, digits = 1) {
  return missing(n) ? 'n/a' : Number(n).toFixed(digits)
}

/** 12.34 -> "12.3%" (the API already sends percents 0-100). */
export function fmtPct(n, digits = 1) {
  return missing(n) ? 'n/a' : `${fmtNum(n, digits)}%`
}

/** 7.25 -> "7.3 min". */
export function fmtMin(n, digits = 1) {
  return missing(n) ? 'n/a' : `${fmtNum(n, digits)} min`
}

/** Seconds -> "m:ss", e.g. 485 -> "8:05", -75 -> "-1:15". */
export function mmss(seconds) {
  if (missing(seconds)) return 'n/a'
  const sign = seconds < 0 ? '-' : ''
  const s = Math.round(Math.abs(seconds))
  const r = s % 60
  return `${sign}${Math.floor(s / 60)}:${r < 10 ? '0' : ''}${r}`
}

/** "2026-09-16" -> "Sep 16". Plain string work, so no time-zone surprises. */
export function fmtDate(iso) {
  if (!iso) return ''
  const [, m, d] = String(iso).slice(0, 10).split('-')
  if (!m || !d) return String(iso)
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`
}

/**
 * [80.6, 90.6] -> "80.6 to 90.6"; unit "%" -> "80.6% to 90.6%".
 * One bound missing -> "n/a" in its place (a P95 upper bound needs 59 or more calls); both missing -> "n/a".
 */
export function fmtCi(ci, unit = '', digits = 1) {
  if (!ci || (missing(ci[0]) && missing(ci[1]))) return 'n/a'
  const one = (v) => (missing(v) ? 'n/a' : `${fmtNum(v, digits)}${unit}`)
  return `${one(ci[0])} to ${one(ci[1])}`
}

/** selection{from,to} -> "Sep 16 to Oct 15, 2026". */
export function fmtRange(sel) {
  if (!sel || !sel.from || !sel.to) return ''
  return `${fmtDate(sel.from)} to ${fmtDate(sel.to)}, ${String(sel.to).slice(0, 4)}`
}

/** "2026-09-01", 3 -> "2026-09-04" (calendar arithmetic in UTC, so no daylight-saving surprises). */
export function addDays(iso, n) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Last day of a p-chart period: a day ends on its start, a week 6 days later, a month on its last calendar day.
 * Clipped to `to` (the last day of the selection) so a partial final period ends where the data ends.
 */
export function periodEnd(start, unit, to) {
  const s = String(start).slice(0, 10)
  let end = s
  if (unit === 'week') end = addDays(s, 6)
  if (unit === 'month') {
    const d = new Date(`${s}T00:00:00Z`)
    end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  }
  return to && String(to).slice(0, 10) < end ? String(to).slice(0, 10) : end
}

/** The dates actually represented by a subgroup after applying the selected range. */
export function periodBounds(start, unit, selection = {}) {
  const first = String(start).slice(0, 10)
  const from = selection.from && selection.from > first ? selection.from : first
  return { from, to: periodEnd(first, unit, selection.to) }
}

/**
 * chance_below{expected, n_places, observed_below} -> one plain sentence, or '' when it could not be computed.
 * It says how many places would read Below goal purely by chance if every place were exactly at the goal.
 */
export function fmtChanceBelow(cb, noun = 'places') {
  if (!cb || missing(cb.expected)) return ''
  return `About ${fmtNum(cb.expected, 1)} would read Below by chance alone if every place were exactly at the goal (expected, of ${fmtInt(cb.n_places)} ${noun}); ${fmtInt(cb.observed_below)} read Below here.`
}

/** "6.4" -> "6.4 calls/day now vs 5.2 in the baseline". */
export function fmtVolume(now, base) {
  return `${fmtNum(now, 1)} calls/day now vs ${fmtNum(base, 1)} in the baseline`
}

/** Exact p-value for display: 0.0123 -> "0.012"; under 0.001 -> "<0.001"; missing -> "n/a". */
export function fmtP(p) {
  if (missing(p)) return 'n/a'
  return p < 0.001 ? '<0.001' : Number(p).toFixed(3)
}

/**
 * Late share as "1 in N late" (N = valid / late, rounded) for a quick borough comparison; "none late" when no call was
 * late, and a percentage when more than half were late (where "1 in 1" would hide the size). Under 30 valid calls the
 * share is too uncertain to compare: "too few calls".
 */
export function fmtOneIn(late, valid) {
  if (missing(late) || missing(valid) || valid <= 0) return 'no calls'
  if (valid < 30) return 'too few calls'
  if (late <= 0) return 'none late'
  const n = valid / late
  return n < 2 ? `${fmtPct((100 * late) / valid, 0)} late` : `1 in ${Math.round(n)} late`
}

/** On-time goal as the late share it allows: 90 -> "1 in 10"; missing or 100 -> ''. */
export function fmtGoalOneIn(goalPct) {
  if (missing(goalPct) || goalPct >= 100) return ''
  return `1 in ${Math.round(100 / (100 - goalPct))}`
}
