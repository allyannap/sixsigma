import { fmtDate } from '../format.js'
import { CONTROL, QUEUE, QUEUE_ORDER, SPEC, WATCH } from '../status.js'

/** Small gray lines of text from a response's messages[] (plain-English warnings from the API). */
export function Messages({ messages }) {
  const list = [...new Set(messages || [])]
  if (!list.length) return null
  return (
    <ul className="messages" aria-label="Notes from the analysis">
      {list.map((m) => <li key={m}>{m}</li>)}
    </ul>
  )
}

/** Shows loading, an error (with Try again), or the children once data is here. */
export function Async({ state, children }) {
  if (state.loading) return <p className="loading" role="status">Loading...</p>
  if (state.error) {
    return (
      <div className="error" role="alert">
        <p><strong>Could not load this part.</strong> {state.error}</p>
        <button type="button" className="btn" onClick={state.reload}>Try again</button>
      </div>
    )
  }
  if (!state.data) return null
  return children(state.data)
}

/** One numbered card of the page. */
export function Section({ num, title, tag, intro, children, id }) {
  return (
    <section className="card" id={id} aria-labelledby={`h-${num}`}>
      <div className="section-head">
        <span className="num">{num}</span>
        <h2 id={`h-${num}`}>{title}</h2>
        {tag && <span className="tag">{tag}</span>}
      </div>
      {intro && <p className="intro">{intro}</p>}
      {children}
    </section>
  )
}

export function Kpi({ label, children, sub }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{children}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  )
}

/** The second cue for the queue label (besides color): a flag, an outline sample, a check or a circle. */
export function StatusIcon({ status, size = 16, color = '#17201C' }) {
  const stroke = color
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="status-icon">
      {status === 'act_now' && <path d="M3 15V2M3 2h10l-3 3.5L13 9H3z" fill={stroke} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />}
      {status === 'recent_change' && <path d="M3 15V2M3 2h10l-3 3.5L13 9H3z" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />}
      {status === 'ongoing_gap' && <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="2 2.5" />}
      {status === 'meets_stable' && <path d="M3 8.5l3.5 3.5L13 4.5" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {status === 'needs_data' && <circle cx="8" cy="8" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />}
    </svg>
  )
}

/** The combined queue label. */
export function StatusBadge({ status, short = false }) {
  const s = QUEUE[status]
  if (!s) return <span className="badge">{status || 'unknown'}</span>
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg }}>
      <StatusIcon status={status} size={14} color={s.fg} />
      {short ? s.short : s.label}
    </span>
  )
}

/** One of the two independent judgments: kind = 'spec' or 'control'. */
export function JudgmentBadge({ kind, value }) {
  const table = kind === 'spec' ? SPEC : CONTROL
  const s = table[value]
  const prefix = kind === 'spec' ? 'Target' : 'Control'
  if (!s) return <span className="badge">{value || 'unknown'}</span>
  return (
    <span className="badge badge-judgment" style={{ background: s.bg, color: s.fg }} title={`${prefix}: ${s.label}`}>
      <span className="badge-kind">{prefix}:</span> {s.label}
    </span>
  )
}

/** Small "watch" chip: a single weak signal. The place stays In control; the tooltip says why it is flagged. */
export function WatchChip({ p }) {
  if (!p || !p.watch || p.control !== 'in_control') return null
  return <span className="chip chip-watch" title={WATCH.tip}>{WATCH.label}<span className="sr-only">: {WATCH.tip}</span></span>
}

/** The two badges, always shown together with (or instead of) the combined label. */
export function Judgments({ p }) {
  if (!p) return null
  return (
    <span className="judgments">
      <JudgmentBadge kind="spec" value={p.spec} />
      <JudgmentBadge kind="control" value={p.control} />
      <WatchChip p={p} />
    </span>
  )
}

export function StatusLegend() {
  return (
    <div className="legend-grid">
      {QUEUE_ORDER.map((k) => (
        <div key={k} className="legend-item">
          <StatusBadge status={k} short />
          <span>{QUEUE[k].help}</span>
        </div>
      ))}
    </div>
  )
}

/** Whether the baseline was screened and found stable, which unusual periods were left out, and why if unstable. */
export function BaselineCheck({ b }) {
  if (!b) return null
  if (!b.checked) return <>Not screened for stability (too little baseline to split into periods).</>
  return (
    <>
      {b.stable ? 'Screened: stable.' : 'Screened: not stable.'}
      {b.removed > 0 && <> {b.removed} unusual period{b.removed === 1 ? '' : 's'} left out{b.removed_starts && b.removed_starts.length ? ` (${b.removed_starts.map(fmtDate).join(', ')})` : ''}.</>}
      {!b.stable && b.reasons && b.reasons.length > 0 && <> Reasons: {b.reasons.join('; ')}.</>}
    </>
  )
}
