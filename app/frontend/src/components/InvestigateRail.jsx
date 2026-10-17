// "Investigate" sidebar: the one ranked list of places, as a table beside the map (desktop) or as a drawer (narrow
// screens). Two tabs that never overlap: "Needs review" (the flagged places, most urgent first: investigationRows) and
// "Not flagged" (every other place, ranked the same way: rankPlaces). Every number comes from /api/summary and is only
// formatted here.
import { useEffect, useRef, useState } from 'react'
import { fmtChanceBelow, fmtCi, fmtInt, fmtNum, fmtPct } from '../format.js'
import { CONTROL, SPEC, attentionSplit, rankPlaces } from '../status.js'
import { investigationRows } from './InvestigationSection.jsx'
import { Icon, Messages, Spinner, StatusBadge, WatchChip } from './common.jsx'
import '../rail.css'

/**
 * The tab's places with every number side by side. Rows keep the tab's order; the place name selects the place. The
 * name column stays pinned while the table scrolls sideways.
 */
function RailTable({ rows, selected, onPick }) {
  return (
    <div className="table-scroll rail-table" tabIndex={0} role="region" aria-label="Places with their numbers (scrolls sideways)">
      <table className="places">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Place</th><th scope="col">Valid calls</th>
            <th scope="col">On time [95% CI]</th><th scope="col">Target</th><th scope="col">Control</th><th scope="col">Label</th>
            <th scope="col" title="Late calls beyond what the goal allows: late - (1 - goal) x valid. Negative = fewer than allowed.">Late beyond goal</th>
            <th scope="col">Cancelled / invalid</th><th scope="col">Calls per day: now (baseline)</th>
            <th scope="col">P95 min [95% CI]</th><th scope="col" title="Secondary; assumes lognormal times; never sets a label">Cpk [upper]</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.id} className={selected.id === p.id ? 'row-selected' : ''}>
              <td className="mono">{i + 1}</td>
              <th scope="row"><button type="button" className="link-btn" onClick={() => onPick(p, false)} aria-pressed={selected.id === p.id}>{p.name}</button></th>
              <td className="mono">{fmtInt(p.valid)}</td>
              <td className="mono">{fmtPct(p.on_time_pct)} <span className="muted">[{fmtCi(p.on_time_ci)}] vs {fmtNum(p.goal_pct, 0)}</span></td>
              <td><span className="chip" style={{ background: SPEC[p.spec]?.bg, color: SPEC[p.spec]?.fg }}>{SPEC[p.spec]?.label}</span></td>
              <td><span className="chip" style={{ background: CONTROL[p.control]?.bg, color: CONTROL[p.control]?.fg }}>{CONTROL[p.control]?.label}</span></td>
              <td><StatusBadge status={p.queue} short /><WatchChip p={p} /></td>
              <td className="mono">{fmtNum(p.excess_late, 1)}</td>
              <td className="mono">{fmtInt(p.cancelled)} ({fmtPct(p.cancel_pct)}) / {fmtInt(p.invalid)}</td>
              <td className="mono">{fmtNum(p.calls_per_day, 1)} ({fmtNum(p.base_calls_per_day, 1)})</td>
              <td className="mono">{p.p95_min == null ? 'n/a' : fmtNum(p.p95_min)} <span className="muted">[{fmtCi(p.p95_ci)}]</span></td>
              <td className="mono" title={p.cpk == null ? 'Cpk undefined (under 30 calls or no spread)' : ''}>
                {p.cpk == null ? 'n/a' : fmtNum(p.cpk, 2)}{p.cpk_upper != null && <span className="muted"> [{fmtNum(p.cpk_upper, 2)}]</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function InvestigateRail({ open, onClose, summaryState, parent, selected, onPick, initialView = 'review' }) {
  const headRef = useRef(null)
  const railRef = useRef(null)
  const s = summaryState.data
  const places = (s && s.places) || []
  const noun = parent.level === 'state' ? 'counties' : 'ZIP areas'
  const [view, setView] = useState(initialView) // 'review' = the flagged places; 'others' = every place not flagged
  const flagged = s ? investigationRows(places) : []
  const flaggedIds = new Set(flagged.map((p) => p.id))
  const others = s ? rankPlaces(places).filter((p) => !flaggedIds.has(p.id)) : []
  const rows = view === 'others' ? others : flagged
  const split = s ? attentionSplit(s) : null
  const qc = (s && s.queue_counts) || {}

  // As a drawer (narrow screens) the rail closes once a place is picked, so the map and numbers show.
  const choose = (p, drill) => {
    onPick(p, drill)
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 1023px)').matches) onClose()
  }

  // Desktop: the list runs from its top down to the bottom of the screen (when the page is scrolled to the top), with
  // the table scrolling inside. Its height goes in --rail-h, which also keeps the page tall enough to hold it.
  useEffect(() => {
    const el = railRef.current
    if (!el || typeof window === 'undefined') return undefined
    const root = document.documentElement
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      root.style.setProperty('--rail-h', `${Math.max(420, Math.round(window.innerHeight - top - 16))}px`)
    }
    size()
    window.addEventListener('resize', size)
    return () => window.removeEventListener('resize', size)
  }, [open])

  // Opening moves focus into the rail; Escape closes it.
  useEffect(() => {
    if (!open) return undefined
    if (headRef.current) headRef.current.focus()
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <>
      <div className={`rail-backdrop${open ? ' is-open' : ''}`} aria-hidden="true" onClick={onClose} />
      <aside id="investigate-rail" ref={railRef} className={`rail${open ? ' is-open' : ''}`} aria-labelledby="rail-title"
        inert={open ? undefined : ''} aria-hidden={!open || undefined}>
        <div className="rail-head">
          <h2 id="rail-title" ref={headRef} tabIndex={-1}>Investigate</h2>
          <button type="button" className="rail-close" aria-label="Close the investigation list" onClick={onClose}><Icon name="back" /></button>
        </div>
        {summaryState.loading && <p className="loading-line rail-note"><Spinner />Loading the list...</p>}
        {summaryState.error && <p className="rail-note error" role="alert">The list is not available: {summaryState.error}</p>}
        {split && (
          <div className="rail-summary">
            {/* Same count as the list and the map's Critical + Watch: the queue labels needing review, plus places
                confirmed below target whose change cannot be judged yet. */}
            <p className="rail-count">{flagged.length} of {places.length} {noun} need review</p>
            <p className="rail-split">
              Act now <b className="n-act">{qc.act_now || 0}</b> · Recent change <b className="n-recent">{qc.recent_change || 0}</b> · Ongoing gap <b className="n-gap">{qc.ongoing_gap || 0}</b>
              {flagged.length > split.total && <> · Below target, change not yet judged <b className="n-gap">{flagged.length - split.total}</b></>}
            </p>
          </div>
        )}
        {s && (
          <div className="rail-views" role="tablist" aria-label="Which places to list">
            <button type="button" role="tab" className={view === 'review' ? 'is-on' : ''} aria-selected={view === 'review'} onClick={() => setView('review')}>
              Needs review <b>{flagged.length}</b>
            </button>
            <button type="button" role="tab" className={view === 'others' ? 'is-on' : ''} aria-selected={view === 'others'} onClick={() => setView('others')}>
              Not flagged <b>{others.length}</b>
            </button>
          </div>
        )}
        {s && rows.length === 0 && <p className="rail-note">{view === 'others' ? `Every ${noun === 'counties' ? 'county' : 'ZIP area'} with calls is flagged.` : 'No area in this view is flagged.'}</p>}
        {s && rows.length > 0 && <RailTable rows={rows} selected={selected} onPick={choose} />}
        {s && (
          <details className="rail-howto">
            <summary>How to read this list</summary>
            <p>Most urgent first: Act now, then Ongoing gap, then Recent change; inside each, the places with the most late calls beyond the goal come first. Pick a place name to show it on the map and in the charts.</p>
            <p><strong>Target</strong>: is the on-time rate confidently at or above the goal? <strong>Control</strong>: has the late share risen above its own recent past? Being in control does not mean the service is good.</p>
            {fmtChanceBelow(s.chance_below, noun) && <p>{fmtChanceBelow(s.chance_below, noun)}</p>}
            <Messages messages={s.messages} />
          </details>
        )}
      </aside>
    </>
  )
}
