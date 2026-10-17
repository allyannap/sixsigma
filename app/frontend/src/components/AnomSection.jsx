import { useState } from 'react'
import SimpleComparison from './SimpleComparison.jsx'
import { fmtInt, fmtMin, fmtPct, fmtCi } from '../format.js'
import { SPEC } from '../status.js'
import { useEndpoint } from '../useApi.js'
import { Async, JudgmentBadge, Section } from './common.jsx'

const PAGE_SIZE = 5
export function rankResponsePlaces(places, sort) {
  return [...places].sort((a, b) => {
    const av = a.response_profile?.[sort], bv = b.response_profile?.[sort]
    return (bv ?? -Infinity) - (av ?? -Infinity) || a.name.localeCompare(b.name)
  })
}

export function responsePage(rows, page) {
  const current = Math.max(0, Math.min(page, Math.ceil(rows.length / PAGE_SIZE) - 1))
  return { current, start: current * PAGE_SIZE, rows: rows.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE) }
}

function PeerComparison({ selection, id }) {
  const state = useEndpoint('anom', { dataset: selection.dataset, from: selection.from, to: selection.to,
    urgency: selection.urgency, level: selection.level, id: selection.id, baseline_days: selection.baseline_days })
  return <Async state={state}>{(d) => {
    const places = d.places || []
    const p = places.find((p) => p.id === id)
    return <div className="caption">
      <p>Of {places.length} areas with enough data, {places.filter((p) => p.verdict === 'slower').length} have typical waits above the comparison range and {places.filter((p) => p.verdict === 'faster').length} below it. Overall typical wait: {fmtMin(d.grand_mean_min)}.</p>
      {p ? <p>{p.name}: {p.verdict === 'slower' ? 'slower than the rest' : p.verdict === 'faster' ? 'faster than the rest' : 'within the comparison range'}. Geometric mean {fmtMin(p.mean_min)}, 95% interval {fmtCi(p.ci_min)} min; comparison limits {fmtMin(p.lower_min)}–{fmtMin(p.upper_min)} (n={fmtInt(p.n)}).</p> : <p>This area is not included: the original comparison requires at least two areas with 30 valid calls each.</p>}
      <p>Original analysis of means (ANOM) on log minutes. This compares areas with one another, not with the service target, and does not set an alert.</p>
      <details><summary>Calculation details</summary><p>Comparison factor h = {d.h}; {d.k} areas, {fmtInt(d.N)} calls. One-way ANOVA: F({d.df1}, {d.df2}) = {d.F}.</p></details>
    </div>
  }}</Async>
}

function AreaCard({ p, selection }) {
  const [peersOpen, setPeersOpen] = useState(false)
  const r = p.response_profile
  return <aside id="response-selected" className="response-place-card" aria-live="polite" aria-label={`Details for ${p.name}`}>
    <div className="eyebrow">Selected area · {fmtInt(r.n)} valid calls</div>
    <h3>{p.name}</h3>
    <JudgmentBadge kind="spec" value={p.spec} />
    {r.n > 0 ? <>
      <p className="response-story"><strong>{fmtPct(r.over_target_pct)}</strong> of calls missed {r.target_min != null ? `the ${fmtMin(r.target_min)} target` : 'their configured target'}.</p>
      <div className="response-facts">
        <div><strong>{fmtMin(r.median_min)}</strong><span>Half of calls arrive by</span></div>
        <div><strong>{fmtMin(r.p90_min)}</strong><span>Slowest 1 in 10 start at</span></div>
      </div>
      <p className="small muted">Longest observed wait: <strong>{fmtMin(r.max_min)}</strong>. Calls beyond the slow-call marker are included in this maximum.</p>
    </> : <p>No valid completed calls. Widen the dates or review the county.</p>}
    {r.low_n && <p className="response-caution"><strong>Limited data.</strong> Under 30 valid calls; the slow-call estimate may change greatly with the next call.</p>}
    <details className="response-explanation"><summary>How certain is this?</summary>
      <p>{SPEC[p.spec]?.label}: {p.spec_reason}. On-time rate {fmtPct(p.on_time_pct)}, 95% uncertainty interval {fmtCi(p.on_time_ci, '%')}, goal {fmtPct(p.goal_pct)}. These are the same judgments as Section 1. Recent-change alerts remain in Sections 2–3.</p>
      <p>The slow-call marker is the observed 90th percentile (P90), not a worst-case guarantee or an uncertainty interval. Even larger samples have uncertain tails.</p>
    </details>
    <details className="response-explanation" onToggle={(e) => setPeersOpen(e.currentTarget.open)}><summary>Compare with other areas · original analysis</summary>
      {peersOpen && <PeerComparison selection={selection} id={p.id} />}
    </details>
  </aside>
}

function Comparison({ d }) {
  const [sort, setSort] = useState('p90_min')
  const [page, setPage] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  if (d.selection?.urgency?.length !== 1) return <p role="status">Select one urgency group to compare response times against its target.</p>
  const places = d.places || []
  if (places.some((p) => !p.response_profile)) return <div className="error" role="alert">
    <p>The dashboard server needs a restart to load the updated geographic analysis. Your calls have not been lost.</p>
    <p>Stop the dashboard with Ctrl+C in its terminal, run <code>bash app/testme.sh</code> again, then refresh this page.</p>
  </div>
  const rows = rankResponsePlaces(places, sort)
  const valid = places.filter((p) => p.response_profile.n > 0)
  if (!valid.length) return <p role="status">No valid completed calls in this selection. Widen the dates or choose another area.</p>
  const targets = [...new Set(valid.map((p) => p.response_profile.target_min))]
  const target = targets.length === 1 ? targets[0] : null
  // Keep one scale for every page, so changing pages never changes apparent wait lengths.
  const max = Math.max(1, target || 0, ...valid.map((p) => p.response_profile.p90_min)) * 1.12
  const x = (v) => 8 + v / max * 284
  const view = responsePage(rows, page)
  const selected = view.rows.find((p) => p.id === selectedId) || view.rows[0]
  const below = places.filter((p) => p.spec === 'below').length
  return <>
    <div className="response-overview">
      <p role="status"><strong>{below} of {places.length} areas</strong> are below the on-time goal for {d.selection.urgency[0]} calls.</p>
      <span className="response-target">{target != null ? `${fmtMin(target)} target` : 'Targets vary by call'} · {fmtPct(valid[0].goal_pct, 0)} on-time goal</span>
    </div>
    <div className="response-layout">
      <div className="response-ranking">
        <div className="response-toolbar">
          <label>Rank areas by <select value={sort} onChange={(e) => { setSort(e.target.value); setPage(0); setSelectedId(null) }}>
            <option value="p90_min">Slowest 1 in 10 (P90)</option>
            <option value="over_target_pct">% of calls over target</option>
            <option value="median_min">Half of calls (median)</option>
          </select></label>
          <span className="small muted">Highest first</span>
        </div>
        <div className="response-list" role="group" aria-label="Ranked response times by area" aria-describedby="response-read">
          <div className="response-axis" aria-hidden="true"><span>Area / valid calls</span><span className="response-scale"><span>0</span><span>{Math.ceil(max)} min</span></span><span>Over target</span></div>
          {view.rows.map((p) => {
            const r = p.response_profile
            const color = p.spec === 'meets' ? '#0072B2' : p.spec === 'below' ? '#A94300' : '#59616B'
            return <button type="button" className={`response-row ${p.id === selected.id ? 'response-chosen' : ''}`} key={p.id}
              aria-pressed={p.id === selected.id} aria-controls="response-selected" onClick={() => setSelectedId(p.id)}
              aria-label={`${p.name}, ${fmtInt(r.n)} calls${r.low_n ? ', limited data' : ''}; half within ${fmtMin(r.median_min)}, slowest 1 in 10 at ${fmtMin(r.p90_min)}; ${fmtPct(r.over_target_pct)} over target; ${SPEC[p.spec]?.label}. Show details.`}>
              <span className="response-name"><strong>{p.name}</strong><span>{fmtInt(r.n)} calls{r.low_n ? ' · Limited data' : ''}</span></span>
              {r.n ? <span className="response-plot"><svg viewBox="0 0 300 28" aria-hidden="true">
                {target != null && <line x1={x(target)} x2={x(target)} y1="0" y2="28" stroke="#78818A" strokeDasharray="3 3" />}
                <line x1={x(r.median_min)} x2={x(r.p90_min)} y1="14" y2="14" stroke={color} strokeWidth="4" strokeDasharray={r.low_n ? '3 3' : undefined} />
                <circle cx={x(r.median_min)} cy="14" r="5" fill={color} />
                <line x1={x(r.p90_min)} x2={x(r.p90_min)} y1="7" y2="21" stroke={color} strokeWidth="3" />
              </svg><span className="response-tail">Slow calls: {fmtMin(r.p90_min)}</span></span> : <span className="small muted">No valid calls</span>}
              <strong className="response-late">{fmtPct(r.over_target_pct)}<span>{p.spec === 'below' ? 'Below goal' : p.spec === 'meets' ? 'Meets goal' : 'Uncertain'}</span></strong>
            </button>
          })}
        </div>
        <div className="response-pagination">
          <span className="small" role="status">Areas {view.start + 1}–{view.start + view.rows.length} of {places.length}</span>
          <div><button className="btn" disabled={view.current === 0} onClick={() => setPage(view.current - 1)} aria-label="Previous five areas">← Previous</button><button className="btn" disabled={view.start + PAGE_SIZE >= places.length} onClick={() => setPage(view.current + 1)} aria-label="Next five areas">Next →</button></div>
        </div>
        <p id="response-read" className="response-key">● Half of calls <span>━┃ Slowest 1 in 10</span> <span>┆ Call target</span></p>
      </div>
      <AreaCard key={selected.id} p={selected} selection={d.selection} />
    </div>
    <details className="response-explanation"><summary>How to read this comparison</summary>
      <p>Read from left to right: the dot marks when half of calls have arrived; the end marks when the slowest 1 in 10 begin. The connecting range describes waits, not uncertainty. Tap an area for its full numbers. All {places.length} areas are available through Previous / Next; the scale stays the same on every page.</p>
      <p>Targets are configurable placeholders, not certified standards.{target == null ? ' Targets vary by call; late percentages use each call’s configured target.' : ''} Comparisons are not adjusted for traffic, distance, call mix or resources. A slower area is not evidence of unfair service. Cancelled and invalid-time calls do not enter these time statistics.</p>
    </details>
  </>
}

export default function AnomSection({ summaryState }) {
  return <><Section num={4} id="section-4" title="Where are calls taking too long?" tag="Geographic comparison · Version 1">
    <Async state={summaryState}>{(d) => <Comparison key={JSON.stringify(d.selection)} d={d} />}</Async>
  </Section>
    <Section num="4b" id="section-4-simple" title="Are calls arriving on time?" tag="Version 2 · At a glance">
      <Async state={summaryState}>{(d) => <SimpleComparison key={JSON.stringify(d.selection)} d={d} />}</Async>
    </Section>
  </>
}
