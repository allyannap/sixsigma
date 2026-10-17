import { STATUS } from '../status.js'

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
        <span className={`num${num === 5 ? ' num5' : ''}`}>{num}</span>
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

/** The second cue for status (besides color): a flag or an outline sample. */
export function StatusIcon({ status, size = 16, color = '#17201C' }) {
  const stroke = color
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" className="status-icon">
      {status === 'act_now' && <path d="M3 15V2M3 2h10l-3 3.5L13 9H3z" fill={stroke} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />}
      {status === 'recent_change' && <path d="M3 15V2M3 2h10l-3 3.5L13 9H3z" fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" />}
      {status === 'ongoing_gap' && <rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke={stroke} strokeWidth="2" strokeDasharray="2 2.5" />}
      {status === 'on_track' && <path d="M3 8.5l3.5 3.5L13 4.5" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />}
      {status === 'not_enough' && <circle cx="8" cy="8" r="5.5" fill="none" stroke={stroke} strokeWidth="1.5" />}
    </svg>
  )
}

export function StatusBadge({ status }) {
  const s = STATUS[status]
  if (!s) return <span className="badge">{status || 'unknown'}</span>
  return (
    <span className="badge" style={{ background: s.bg, color: s.fg }}>
      <StatusIcon status={status} size={14} color={s.fg} />
      {s.label}
    </span>
  )
}

export function StatusLegend() {
  return (
    <div className="legend-grid">
      {Object.keys(STATUS).filter((k) => k !== 'not_enough').map((k) => (
        <div key={k} className="legend-item">
          <StatusBadge status={k} />
          <span>{STATUS[k].help}</span>
        </div>
      ))}
      <div className="legend-item">
        <StatusBadge status="not_enough" />
        <span>Gray on the map. Too few calls to judge.</span>
      </div>
    </div>
  )
}
