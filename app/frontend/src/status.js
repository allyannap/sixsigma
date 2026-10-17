// Status wording, colors and the map fill ramps. Colors come from the team's mockup.
// A status is always shown with a flag or outline as well as color (see StatusIcon).

export const STATUS = {
  act_now: {
    label: 'Act now',
    help: 'Clearly slower than the 60 days before it, and too slow overall.',
    bg: '#B42318',
    fg: '#FFFFFF',
    next: 'Open Section 3 to confirm the change is real, then Sections 4 and 5 for the cause and the fix.',
  },
  recent_change: {
    label: 'Recent change',
    help: 'The selected range is clearly slower than the 60 days before it (a shift test, Z > 3).',
    bg: '#FDE7D3',
    fg: '#8A3A00',
    next: 'Watch it. Section 3 shows the bad days and bad calls to look at.',
  },
  ongoing_gap: {
    label: 'Ongoing gap',
    help: 'Steady, but too slow week after week. Needs a planning fix.',
    bg: '#FBF1C7',
    fg: '#6B5300',
    next: 'Plan for it: Section 4 shows which step costs the minutes, Section 5 which fix helps.',
  },
  on_track: {
    label: 'On track',
    help: 'No action needed.',
    bg: '#DCEFE2',
    fg: '#1E6B3A',
    next: 'No action needed.',
  },
  not_enough: {
    label: 'Not enough calls (<30 calls)',
    help: 'Too few calls to say anything reliable.',
    bg: '#E3E6E1',
    fg: '#3D4842',
    next: 'Pick a longer date range, or look at the county.',
  },
}

export const STATUS_ORDER = ['act_now', 'recent_change', 'ongoing_gap', 'on_track', 'not_enough']

/** Statuses that mean "needs attention" (used only to count on the page when the API gives no count). */
export const ATTENTION = ['act_now', 'recent_change', 'ongoing_gap']

export const URGENCY = {
  red: { label: 'Red (most urgent)', light: '#FBE3E0', dark: '#8F1D14', chip: '#B42318' },
  yellow: { label: 'Yellow', light: '#FBF1C7', dark: '#8A6A00', chip: '#8A6A00' },
  green: { label: 'Green', light: '#DCEFE2', dark: '#1E6B3A', chip: '#1E6B3A' },
}
export const URGENCY_KEYS = ['red', 'yellow', 'green']

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
/** Blend two #RRGGBB colors; t = 0 gives a, t = 1 gives b. */
export function mix(a, b, t) {
  const [r1, g1, b1] = hex(a)
  const [r2, g2, b2] = hex(b)
  const c = (x, y) => Math.round(x + (y - x) * t)
  return `rgb(${c(r1, r2)}, ${c(g1, g2)}, ${c(b1, b2)})`
}

/** Map fill: the urgency's color, darker = more late. share = pct_late / the largest pct_late shown. */
export function fillFor(urgencyKey, share) {
  const u = URGENCY[urgencyKey] || URGENCY.red
  const t = Math.min(1, Math.max(0, share || 0))
  return mix(u.light, u.dark, 0.12 + 0.88 * t)
}

/** Table order: status first, then more late calls first (the mockup's rule). */
export function rankPlaces(places) {
  const rank = (p) => {
    const i = STATUS_ORDER.indexOf(p.status)
    return i < 0 ? STATUS_ORDER.length : i
  }
  return [...(places || [])].sort((a, b) => rank(a) - rank(b) || (b.late || 0) - (a.late || 0))
}

/** needs_attention is an int (act_now + recent_change + ongoing_gap). Counts the places only if it is missing. */
export function attentionCount(summary) {
  const n = summary && summary.needs_attention
  if (typeof n === 'number') return n
  return (summary && summary.places ? summary.places : []).filter((p) => ATTENTION.includes(p.status)).length
}
