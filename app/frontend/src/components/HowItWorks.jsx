// "How to read this dashboard": a short three-page guide that opens on the first visit and from the top bar's
// "How it works" button. Page 1 defines target (minutes per call) and goal (share of calls on time) with the target
// table read from /api/meta, page 2 the map colours, page 3 how to use the page and what the data is.
import { useEffect, useRef, useState } from 'react'
import { fmtPct } from '../format.js'
import { TIERS, URGENCY, URGENCY_KEYS } from '../status.js'
import { Icon } from './common.jsx'

const AREAS = ['urban', 'suburban', 'rural', 'remote']
const SEEN_KEY = 'onscene.howto.seen'

/** Has this browser seen the guide? Storage can be blocked (private window, tests): then the answer is no. */
export function seenGuide() {
  try { return typeof window !== 'undefined' && window.localStorage.getItem(SEEN_KEY) === '1' } catch { return false }
}
export function markGuideSeen() {
  try { window.localStorage.setItem(SEEN_KEY, '1') } catch { /* the guide just shows again next visit */ }
}

/** Minutes as "8" or "8–10" when one urgency group has several targets in an area type. */
const minutes = (vals) => {
  if (!vals.length) return '—'
  const lo = Math.min(...vals) / 60
  const hi = Math.max(...vals) / 60
  const f = (m) => String(Number(m.toFixed(1)))
  return lo === hi ? f(lo) : `${f(lo)}–${f(hi)}`
}

/**
 * The /api/meta target rows (urgency_code, urban_rural, urgency_group, target_s, goal_on_time_pct) as one row per
 * call urgency: { key, num, label, codes, cells: { urban: '8', ... } }, plus the goal(s) in percent.
 */
export function targetGrid(targets) {
  const rows = (targets || []).filter((t) => t && t.target_s != null)
  const grid = URGENCY_KEYS.map((key) => ({
    key, num: URGENCY[key].num, label: URGENCY[key].label, codes: URGENCY[key].codes,
    cells: Object.fromEntries(AREAS.map((a) => [a, minutes(rows.filter((t) => t.urgency_group === key && t.urban_rural === a).map((t) => Number(t.target_s)))])),
  }))
  const goals = [...new Set(rows.map((t) => Number(t.goal_on_time_pct)).filter((g) => Number.isFinite(g)))].sort((a, b) => a - b)
  return { grid, goals, empty: rows.length === 0 }
}

// One line per map colour, in the legend's order.
const TIER_MEANING = {
  critical: 'below the goal, and late calls rose recently. Act now.',
  watch: 'below the goal, or late calls rose recently.',
  near: 'enough calls, but too close to the goal to call it either way.',
  stable: 'meets the goal.',
  nodata: 'under 30 calls, so not judged yet.',
}

function TargetsPage({ targets }) {
  const { grid, goals, empty } = targetGrid(targets)
  const goal = goals.length === 1 ? fmtPct(goals[0], 0) : goals.length ? goals.map((g) => fmtPct(g, 0)).join(' to ') : '90%'
  return (
    <>
      <dl className="guide-defs">
        <div><dt>Target</dt><dd>how fast one call should be reached.</dd></div>
        <div><dt>Goal</dt><dd>at least {goal} of calls reached within their target.</dd></div>
      </dl>
      {empty ? <p className="guide-note">The target table loads with the data.</p> : (
        <div className="guide-table-wrap">
          <table className="guide-table">
            <caption className="sr-only">Response target in minutes, by call urgency and area type</caption>
            <thead>
              <tr><th scope="col">Call urgency</th>{AREAS.map((a) => <th scope="col" key={a}>{a[0].toUpperCase() + a.slice(1)}{a === 'remote' ? '*' : ''}</th>)}</tr>
            </thead>
            <tbody>
              {grid.map((r) => (
                <tr key={r.key}>
                  <th scope="row"><span className="guide-num">{r.num}</span>{r.label}</th>
                  {AREAS.map((a) => <td key={a}>{r.cells[a]}<span className="guide-unit"> min</span></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="guide-note">*NFPA 1720 sets no fixed time for remote areas, so the rural time is used. All targets are placeholders based on NFPA 1720, not certified standards.</p>
    </>
  )
}

function ColoursPage() {
  return (
    <ul className="guide-tiers">
      {TIERS.map((t) => (
        <li key={t.key}><i className={`dot dot-${t.key}`} aria-hidden="true" /><strong>{t.label}</strong><span>{TIER_MEANING[t.key]}</span></li>
      ))}
    </ul>
  )
}

function UsePage() {
  return (
    <>
      <ol className="guide-steps">
        <li>Pick the <strong>call urgency</strong> and the <strong>dates</strong>.</li>
        <li>Click a county on the <strong>map</strong> to see its ZIP areas.</li>
        <li>Open <strong>Investigate</strong> for the ranked table, most urgent first.</li>
        <li>Check <strong>Response trends</strong> to see when late calls rose.</li>
      </ol>
      <p className="guide-note">Simulated data: invented calls on real 2020 Census areas, no real patients or crews. The clock starts when the call is received (the 911 answer or the CAD record: not yet confirmed). This tool reviews the response process, not individual dispatchers or crews. Every number comes from the read-only API; the page only draws it.</p>
    </>
  )
}

const PAGES = [
  { title: 'Target and goal', body: (t) => <TargetsPage targets={t} /> },
  { title: 'What the map colours mean', body: () => <ColoursPage /> },
  { title: 'How to use it', body: () => <UsePage /> },
]

/** props: open, onClose, targets (the /api/meta target rows), initialPage (tests). */
export default function HowItWorks({ open, onClose, targets, initialPage = 0 }) {
  const ref = useRef(null)
  const nextRef = useRef(null)
  const [page, setPage] = useState(initialPage)
  useEffect(() => {
    const dialog = ref.current
    if (!dialog || typeof dialog.showModal !== 'function') return
    // Focus starts on Next (the browser would otherwise pick the close button and ring it).
    if (open && !dialog.open) { setPage(0); dialog.showModal(); if (nextRef.current) nextRef.current.focus() }
    if (!open && dialog.open) dialog.close()
  }, [open])
  const last = page === PAGES.length - 1
  return (
    <dialog ref={ref} className="guide" aria-labelledby="guide-title" onCancel={(e) => { e.preventDefault(); onClose() }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="guide-inner">
        <header className="guide-head">
          <div>
            <span className="eyebrow">How to read this dashboard · {page + 1} of {PAGES.length}</span>
            <h2 id="guide-title">{PAGES[page].title}</h2>
          </div>
          <button type="button" className="comparison-close" aria-label="Close the guide" onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div className="guide-body">{PAGES[page].body(targets)}</div>
        <div className="guide-foot">
          <span className="guide-dots" aria-hidden="true">{PAGES.map((p, i) => <i key={p.title} className={i === page ? 'is-on' : ''} />)}</span>
          {page > 0 ? <button type="button" className="btn" onClick={() => setPage(page - 1)}>Back</button> : <button type="button" className="btn btn-quiet" onClick={onClose}>Skip</button>}
          <button type="button" className="btn-primary" ref={nextRef} onClick={() => (last ? onClose() : setPage(page + 1))}>{last ? 'Start' : 'Next'}</button>
        </div>
      </div>
    </dialog>
  )
}
