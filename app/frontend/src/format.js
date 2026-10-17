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

/** Z score: 7.4 -> "7.4"; missing -> "n/a". */
export function fmtZ(z) {
  return fmtNum(z, 1)
}

/** goal_pct = the on-time goal (90 means 90% on time), so the late goal is 100 - goal_pct; missing -> null. */
export function lateGoalPct(goalPct) {
  return missing(goalPct) ? null : 100 - goalPct
}

/** selection{from,to} -> "Sep 16 to Oct 15, 2026". */
export function fmtRange(sel) {
  if (!sel || !sel.from || !sel.to) return ''
  return `${fmtDate(sel.from)} to ${fmtDate(sel.to)}, ${String(sel.to).slice(0, 4)}`
}
