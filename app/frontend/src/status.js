// Status wording, colors and the map fill ramps. Colors come from the team's mockup.
// Two independent judgments (docs/api.md): spec (meets / below / inconclusive) and control
// (in_control / out_of_control / insufficient_baseline). The queue label combines them; the page
// always shows both badges beside it. A status is shown with an icon or outline as well as color.

export const QUEUE = {
  act_now: {
    label: 'Act now: performance gap + recent signal',
    short: 'Act now',
    help: 'Below the on-time goal, and the late share is confirmed above its control limit (two or more periods, or one very strong one).',
    bg: '#B42318',
    fg: '#FFFFFF',
    next: 'Check the p chart (Are late calls being unusually frequent?) for the dates of the signal, then review the calls from those periods.',
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
    help: 'The late share is confirmed above its control limit (two or more periods, or one very strong one). The on-time goal is met or not yet decided.',
    bg: '#FDE7D3',
    fg: '#8A3A00',
    next: 'The p chart (Are late calls being unusually frequent?) lists the periods above the limit; check what changed then.',
  },
  meets_stable: {
    label: 'Meets goal; no change signal',
    short: 'Meets goal, no signal',
    help: 'The on-time rate is confidently at or above the goal, and the late share shows no confirmed change from its baseline.',
    bg: '#DCEFE2',
    fg: '#1E6B3A',
    next: 'No review needed for this period.',
  },
  needs_data: {
    label: 'Needs more data / Inconclusive',
    short: 'Needs more data',
    help: 'Too few calls, too little baseline, an on-time interval that includes the goal, or confirmed below target but too little baseline to judge change. Not a pass.',
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

/** One period above the limit that is not confirmed: the place stays In control, with this note beside it. */
export const WATCH = { label: 'watch', tip: '1 period above the limit, not confirmed' }

// Call urgency is a FILTER (which calls are analysed), not a verdict. It is shown as a number and words, never in
// red / amber / green, because those colours belong to the map status (Critical / Watch / Stable). The keys stay the
// API's red / yellow / green (urgency codes 0-2, 3-5, 6-9 in config/targets.csv).
export const URGENCY = {
  red: { num: 1, label: 'Most urgent', codes: '0-2', light: '#FBE3E0', dark: '#8F1D14', chip: '#B42318' },
  yellow: { num: 2, label: 'Urgent', codes: '3-5', light: '#FBF1C7', dark: '#8A6A00', chip: '#8A6A00' },
  green: { num: 3, label: 'Less urgent', codes: '6-9', light: '#DCEFE2', dark: '#1E6B3A', chip: '#1E6B3A' },
}

/** "Call urgency 1 (most urgent)" for one API key; unknown keys are returned as they are. */
export function urgencyText(key) {
  const u = URGENCY[key]
  return u ? `Call urgency ${u.num} (${u.label.toLowerCase()})` : String(key)
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

/** Larger excess_late first; a missing value (null) sorts last. */
function byExcessLate(a, b) {
  const x = a.excess_late
  const y = b.excess_late
  if (x == null && y == null) return 0
  if (x == null) return 1
  if (y == null) return -1
  return y - x
}

/**
 * Queue order first; inside a label, confirmed below-target places first, then the most late calls beyond
 * what the goal allows (excess_late, desc). Raw late counts are not used: they favor big places.
 */
export function rankPlaces(places) {
  const rank = (p) => {
    const i = QUEUE_ORDER.indexOf(p.queue)
    return i < 0 ? QUEUE_ORDER.length : i
  }
  const below = (p) => (p.spec === 'below' ? 0 : 1)
  return [...(places || [])].sort((a, b) => rank(a) - rank(b) || below(a) - below(b) || byExcessLate(a, b))
}

/**
 * Splits "need review" in two: places with a recent signal (Act now + Recent change) and ongoing gaps.
 * Uses queue_counts when the API sent it, else counts the places.
 */
export function attentionSplit(summary) {
  const counts = (summary && summary.queue_counts) || null
  const places = (summary && summary.places) || []
  const count = (k) => (counts && typeof counts[k] === 'number' ? counts[k] : places.filter((p) => p.queue === k).length)
  const recent = count('act_now') + count('recent_change')
  const ongoing = count('ongoing_gap')
  return { recent, ongoing, total: recent + ongoing }
}

/** needs_attention is an int (act_now + ongoing_gap + recent_change). Counts the places only if it is missing. */
export function attentionCount(summary) {
  const n = summary && summary.needs_attention
  if (typeof n === 'number') return n
  return (summary && summary.places ? summary.places : []).filter((p) => ATTENTION.includes(p.queue)).length
}

// ---- OnScene page: the map colour groups. Only a mapping of what the API already says, no statistics. ----
// The queue label alone made every "Needs more data / Inconclusive" place gray, which hid places with plenty of
// calls that sit close to the goal, or that meet it but have too few late calls to chart. The map therefore also
// reads the place's target result and call count, so gray means only "too few calls":
//   Critical  = Act now
//   Watch     = Ongoing gap, Recent change, or confirmed below target when change cannot be judged yet
//   Near goal = 30+ valid calls but the on-time interval includes the goal (and no change signal)
//   Stable    = Meets goal (with or without a usable baseline)
//   gray      = under 30 valid calls (or none)
// The queue label itself, and the Target / Control badges, are unchanged everywhere else on the page.
export const MIN_VALID_CALLS = 30
export const TIERS = [
  { key: 'critical', label: 'Critical' },
  { key: 'watch', label: 'Watch' },
  { key: 'near', label: 'Near goal' },
  { key: 'stable', label: 'Stable' },
  { key: 'nodata', label: 'Too few calls' },
]
export const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]))

/** Colour group of one place card (or 'nodata' for a missing one). */
export function mapTier(p) {
  if (!p) return 'nodata'
  if (p.queue === 'act_now') return 'critical'
  if (p.queue === 'ongoing_gap' || p.queue === 'recent_change' || p.spec === 'below') return 'watch'
  if (p.queue === 'meets_stable' || p.spec === 'meets') return 'stable'
  return (p.valid || 0) >= MIN_VALID_CALLS ? 'near' : 'nodata'
}

/** The 5 legend rows, counted over the places drawn on the map: [{key, label, count}]. */
export function legendRows(places) {
  const counts = {}
  for (const p of places || []) {
    const t = mapTier(p)
    counts[t] = (counts[t] || 0) + 1
  }
  return TIERS.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] || 0 }))
}
