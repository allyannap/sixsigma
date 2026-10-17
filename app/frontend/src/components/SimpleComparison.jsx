import { useState } from 'react'
import { fmtInt, fmtMin, fmtPct, fmtCi } from '../format.js'

const LABELS = { below: 'Below goal', meets: 'Meets goal', inconclusive: 'Uncertain' }

export function goalGap(p) {
  if (p.on_time_pct == null || p.goal_pct == null) return 'No valid rate'
  const gap = p.on_time_pct - p.goal_pct
  if (Math.abs(gap) < .05) return 'At the observed goal'
  return `${Math.abs(gap).toFixed(1)} percentage points ${gap < 0 ? 'below' : 'above'} goal`
}

export function comparisonAreas(places, extraId) {
  const valid = places.filter((p) => p.response_profile?.n > 0)
  const worst = [...valid].sort((a, b) => b.response_profile.over_target_pct - a.response_profile.over_target_pct || a.name.localeCompare(b.name)).slice(0, 3)
  const extra = valid.find((p) => p.id === extraId)
  return extra && !worst.some((p) => p.id === extra.id) ? [...worst, extra] : worst
}

/** Directly labeled choices avoid interpreting an axis or matching distant markers. */
export function AreaChoices({ areas, selectedId, onSelect }) {
  return <div className="area-choices" role="group" aria-label="Three lowest on-time rates">
    {areas.map((p) => <button type="button" key={p.id} className={`area-choice ${p.id === selectedId ? 'choice-selected' : ''}`}
      aria-pressed={p.id === selectedId} aria-controls="simple-selected" onClick={() => onSelect(p.id)}
      aria-label={`${p.name}: ${fmtPct(p.on_time_pct)} on time; ${LABELS[p.spec] || 'Uncertain'}${p.response_profile.low_n ? '; limited data' : ''}. Select area.`}>
      <span>{p.name}</span><strong>{fmtPct(p.on_time_pct, 0)}</strong>
      {p.response_profile.low_n && <small>Limited data</small>}
    </button>)}
  </div>
}

export default function SimpleComparison({ d }) {
  const [selectedId, setSelectedId] = useState('')
  if (d.selection?.urgency?.length !== 1) return <p className="muted">Choose one urgency group to see this view.</p>
  const places = d.places || []
  if (places.some((p) => !p.response_profile)) return <p className="muted">Restart the dashboard server to load the updated analysis.</p>
  const valid = places.filter((p) => p.response_profile.n > 0)
  if (!valid.length || d.totals?.on_time_pct == null) return <p className="muted">No valid completed calls in this selection.</p>
  const areas = comparisonAreas(places, '')
  const selected = valid.find((p) => p.id === selectedId) || areas[0]
  const r = selected.response_profile
  const deadline = r.target_min != null ? `${Number(r.target_min.toFixed(2))} min` : 'the configured call target'
  return <div className="simple-comparison">
    <p className="simple-goal"><strong>Goal: {fmtPct(selected.goal_pct, 0)} of calls arrive within {deadline} of call receipt.</strong></p>
    <p className="simple-caption">Lowest on-time rates · Select an area</p>
    <AreaChoices areas={areas} selectedId={selected.id} onSelect={setSelectedId} />
    <div id="simple-selected" className={`simple-result result-${selected.spec}`} aria-live="polite">
      <strong className="simple-result-rate">{fmtPct(selected.on_time_pct, 0)}</strong>
      <span>arrive on time in <strong>{selected.name}</strong></span>
      <p>{goalGap(selected)} · {fmtInt(r.n)} calls</p>
      <span className="simple-result-status">{LABELS[selected.spec] || 'Uncertain'}{r.low_n ? ' · Limited data' : ''}</span>
    </div>
    <div className="simple-actions"><label>Other area <select value={selected.id} onChange={(e) => setSelectedId(e.target.value)}>
      {[...places].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.id} disabled={!p.response_profile.n}>{p.name}{!p.response_profile.n ? ' (no valid calls)' : ''}</option>)}
    </select></label></div>
    <details className="simple-more">
      <summary>Details</summary>
      <p className="simple-proof">{fmtPct(selected.on_time_pct)} on time against a {fmtPct(selected.goal_pct)} goal. 95% on-time uncertainty interval: {fmtCi(selected.on_time_ci, '%')}. {selected.spec_reason}.{r.low_n ? ' Under 30 calls: do not over-trust this estimate.' : ''}</p>
      <p className="simple-proof">Half arrive within {fmtMin(r.median_min)}; the slowest 1 in 10 start at {fmtMin(r.p90_min)}. Longest wait: {fmtMin(r.max_min)}.</p>
      <p className="simple-proof">{fmtPct(r.over_target_pct)} exceeded {r.target_min != null ? `the ${fmtMin(r.target_min)} call target` : 'their call-specific targets'}. The three buttons show the lowest observed on-time rates. Red = confirmed below goal, green = meets goal, gray = uncertain. A rate above the goal may still be uncertain. “Percentage points” means the direct difference between two rates.</p>
      <p className="simple-proof">Overall: {fmtPct(d.totals.on_time_pct)} on time, 95% interval {fmtCi(d.totals.on_time_ci, '%')}, {fmtInt(d.totals.valid)} valid calls. This is weighted by calls, not an average of area percentages. Targets are configurable placeholders. Cancelled and invalid-time calls are excluded. Process-change alerts and full peer analysis remain in version 1 above.</p>
    </details>
  </div>
}
