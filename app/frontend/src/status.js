// Status wording, colors and the map fill ramps. Colors come from the team's mockup.
// Two independent judgments (docs/api.md): spec (meets / below / inconclusive) and control
// (in_control / out_of_control / insufficient_baseline). The queue label combines them; the page
// always shows both badges beside it. A status is shown with an icon or outline as well as color.

export const QUEUE = {
  act_now: {
    label: 'Act now: performance gap + recent signal',
    short: 'Act now',
    help: 'Below the on-time goal, and the late share rose above its control limit.',
    bg: '#B42318',
    fg: '#FFFFFF',
    next: 'Check Section 2 for the dates of the signal, then review the calls from those periods.',
  },
  ongoing_gap: {
    label: 'Ongoing gap',
    short: 'Ongoing gap',
    help: 'Below the on-time goal, but no change from its own baseline: a long-running gap.',
    bg: '#FBF1C7',
    fg: '#6B5300',
    next: 'A planning question (for example, where units are posted), not a sudden change.',
  },
  recent_change: {
    label: 'Recent process change: investigate',
    short: 'Recent change',
    help: 'The late share rose above its control limit. The on-time goal is met or not yet decided.',
    bg: '#FDE7D3',
    fg: '#8A3A00',
    next: 'Section 2 lists the periods above the limit; check what changed then.',
  },
  meets_stable: {
    label: 'Meets goal; statistically stable',
    short: 'Meets goal, stable',
    help: 'The on-time rate is confidently at or above the goal, and no control signal.',
    bg: '#DCEFE2',
    fg: '#1E6B3A',
    next: 'No review needed for this period.',
  },
  needs_data: {
    label: 'Needs more data / Inconclusive',
    short: 'Needs more data',
    help: 'Too few calls, too little baseline, or an on-time interval that includes the goal. Not a pass.',
    bg: '#E3E6E1',
    fg: '#3D4842',
    next: 'Widen the date range, or look at the county or the state.',
  },
}

export const QUEUE_ORDER = ['act_now', 'ongoing_gap', 'recent_change', 'needs_data', 'meets_stable']

/** Queue labels that count as "needs attention". */
export const ATTENTION = ['act_now', 'ongoing_gap', 'recent_change']

export const SPEC = {
  below: { label: 'Below target', bg: '#FBE3E0', fg: '#8F1D14' },
  meets: { label: 'Meets target', bg: '#DCEFE2', fg: '#1E6B3A' },
  inconclusive: { label: 'Inconclusive', bg: '#EEF0EC', fg: '#3D4842' },
}

export const CONTROL = {
  out_of_control: { label: 'Out of control', bg: '#FDE7D3', fg: '#8A3A00' },
  in_control: { label: 'In control', bg: '#E4ECF5', fg: '#1F3A5F' },
  insufficient_baseline: { label: 'Insufficient baseline', bg: '#EEF0EC', fg: '#3D4842' },
}

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

/** Map fill: the urgency's color, darker = a larger late share. share = late % / the largest late % shown. */
export function fillFor(urgencyKey, share) {
  const u = URGENCY[urgencyKey] || URGENCY.red
  const t = Math.min(1, Math.max(0, share || 0))
  return mix(u.light, u.dark, 0.12 + 0.88 * t)
}

/** Late % of a place (100 - on-time %), or null. */
export function latePct(p) {
  return p && p.on_time_pct != null ? 100 - p.on_time_pct : null
}

/** Queue order first; inside a label, confirmed below-target places first, then more late calls. */
export function rankPlaces(places) {
  const rank = (p) => {
    const i = QUEUE_ORDER.indexOf(p.queue)
    return i < 0 ? QUEUE_ORDER.length : i
  }
  const below = (p) => (p.spec === 'below' ? 0 : 1)
  return [...(places || [])].sort((a, b) => rank(a) - rank(b) || below(a) - below(b) || (b.late || 0) - (a.late || 0))
}

/** needs_attention is an int (act_now + ongoing_gap + recent_change). Counts the places only if it is missing. */
export function attentionCount(summary) {
  const n = summary && summary.needs_attention
  if (typeof n === 'number') return n
  return (summary && summary.places ? summary.places : []).filter((p) => ATTENTION.includes(p.queue)).length
}
