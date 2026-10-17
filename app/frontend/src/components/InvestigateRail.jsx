// "Investigate" sidebar: the investigation list as cards beside the map (desktop) or as a drawer over the page (narrow
// screens). Same rows and order as the Investigation list section (investigationRows); every number comes from
// /api/summary and is only formatted here.
import { useEffect, useRef } from 'react'
import { fmtDate, fmtInt, fmtPct } from '../format.js'
import { CONTROL, attentionSplit } from '../status.js'
import { investigationRows } from './InvestigationSection.jsx'
import { Icon, Spinner, StatusBadge, WatchChip } from './common.jsx'
import '../rail.css'

// Bar colour follows the target judgment (Below / Inconclusive / Meets), the same colours as the map.
const BAR = { below: 'var(--map-critical)', inconclusive: 'var(--map-watch)', meets: 'var(--map-stable)' }

const clamp = (v) => Math.max(0, Math.min(100, v))

/** One card: name and queue label; on-time % with a bar and a tick at the goal; the first signal or the control status. */
function Card({ p, active, onPick }) {
  const pct = p.on_time_pct
  const goal = p.goal_pct
  const signal = p.signals && p.signals.length ? p.signals[0] : null
  return (
    <li>
      <button type="button" className={`rail-card${active ? ' is-active' : ''}`} aria-pressed={active} onClick={() => onPick(p, false)}>
        <span className="rail-card-top">
          <span className="rail-name">{p.name}</span>
          <StatusBadge status={p.queue} short />
        </span>
        <span className="rail-rate">
          <span className="rail-pct">{pct == null ? 'n/a' : `${fmtPct(pct)} on time`}</span>
          <span className="rail-bar" aria-hidden="true">
            {pct != null && <span className="rail-fill" style={{ width: `${clamp(pct)}%`, background: BAR[p.spec] || 'var(--map-nodata)' }} />}
            {goal != null && <span className="rail-goal" style={{ left: `${clamp(goal)}%` }} />}
          </span>
        </span>
        <span className="rail-foot">
          {signal
            ? <span className="rail-signal"><span aria-hidden="true">⚡</span> Signal {fmtDate(signal.start)}</span>
            : <span>{(CONTROL[p.control] && CONTROL[p.control].label) || p.control}</span>}
          <WatchChip p={p} />
          <span className="sr-only">. {fmtInt(p.valid)} valid calls, goal {fmtPct(goal, 0)}.</span>
        </span>
      </button>
    </li>
  )
}

export default function InvestigateRail({ open, onClose, summaryState, parent, selected, onPick }) {
  const headRef = useRef(null)
  const railRef = useRef(null)
  const s = summaryState.data
  const places = (s && s.places) || []
  const noun = parent.level === 'state' ? 'counties' : 'ZIP areas'
  const rows = s ? investigationRows(places) : []
  const split = s ? attentionSplit(s) : null
  const qc = (s && s.queue_counts) || {}

  // As a drawer (narrow screens) the rail closes once a place is picked, so the map and numbers show.
  const choose = (p, drill) => {
    onPick(p, drill)
    if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(max-width: 1023px)').matches) onClose()
  }

  // Desktop: the list runs from its top down to the bottom of the screen (when the page is scrolled to the top), with
  // the cards scrolling inside. Its height goes in --rail-h, which also keeps the page tall enough to hold it.
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
            <p className="rail-count">{split.total} of {places.length} {noun} need review</p>
            <p className="rail-split">
              Act now <b className="n-act">{qc.act_now || 0}</b> · Recent change <b className="n-recent">{qc.recent_change || 0}</b> · Ongoing gap <b className="n-gap">{qc.ongoing_gap || 0}</b>
            </p>
          </div>
        )}
        {s && (rows.length === 0
          ? <p className="rail-note">No area in this view is flagged.</p>
          : (
            <ul className="rail-list" aria-label={`Flagged ${noun}, most urgent first`}>
              {rows.map((p) => <Card key={p.id} p={p} active={selected.id === p.id} onPick={choose} />)}
            </ul>
          ))}
      </aside>
    </>
  )
}
