import { urgencyText } from '../status.js'
import { useEffect, useRef, useState } from 'react'
import { linear, linePath } from '../charts.js'
import { fmtDate, fmtInt, fmtNum, fmtP, fmtPct, mmss, periodBounds } from '../format.js'
import { useEndpoint } from '../useApi.js'
import { Async, BaselineCheck, JudgmentBadge, Messages, Section, WatchChip } from './common.jsx'
import EvidenceDrawer from './EvidenceDrawer.jsx'

const isFlaggedPeriod = (point) => point.p > point.ucl || point.p < point.lcl || point.signal

const periodLabel = (start, unit, selection) => {
  const range = periodBounds(start, unit, selection)
  return range.from === range.to ? fmtDate(range.from) : `${fmtDate(range.from)}–${fmtDate(range.to)}`
}

export function PChart({ d, selected, onSelect }) {
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 640, height: 310 })
  useEffect(() => {
    if (!ref.current) return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const pts = d.points || []
  if (!pts.length) return <p>No periods in this selection.</p>
  const W = size.width, H = Math.max(90, size.height)
  const left = 36, right = W - 12, bottom = H - 29
  const highest = Math.max(d.p_bar || 0, ...pts.flatMap((p) => [p.ucl, p.p])) * 100
  const step = highest <= 20 ? 5 : highest <= 40 ? 10 : highest <= 75 ? 20 : 25
  const top = Math.min(100, Math.max(step * 2, Math.ceil(highest * 1.12 / step) * step))
  const y = linear(0, top, bottom, 26)
  const times = pts.map((p) => Date.parse(periodBounds(p.start, d.unit, d.selection).from))
  const x = (i) => pts.length === 1 ? (left + right) / 2 : left + (times[i] - times[0]) / (times.at(-1) - times[0]) * (right - left)
  const envelope = pts.length === 1 ? [[left, pts[0]], [right, pts[0]]] : pts.map((point, i) => [x(i), point])
  const aboveBand = [[left, y(top)], [right, y(top)], ...envelope.map(([px, p]) => [px, y(p.ucl * 100)]).reverse()]
  const lowerLabelY = y(pts.at(-1).lcl * 100)
  const upperLabelY = y(pts.at(-1).ucl * 100)
  const band = [...envelope.map(([px, p]) => [px, y(p.ucl * 100)]), ...envelope.map(([px, p]) => [px, y(p.lcl * 100)]).reverse()]
  const dateIndices = [...new Set(W < 420 ? [0, Math.floor((pts.length - 1) / 2), pts.length - 1] : [0, Math.floor((pts.length - 1) / 3), Math.floor(2 * (pts.length - 1) / 3), pts.length - 1])]
  const describe = (p) => {
    const position = p.p > p.ucl ? 'Over the upper limit' : p.p < p.lcl ? 'Below the lower limit' : 'Within the control limits'
    return `${periodLabel(p.start, d.unit, d.selection)}: ${position}. ${fmtPct(p.p * 100)} late (${fmtInt(p.late)} of ${fmtInt(p.n)} calls). Upper limit: ${fmtPct(p.ucl * 100)}; lower limit: ${fmtPct(p.lcl * 100)}.${p.signal ? ' Unusual period (exact binomial signal).' : ''}`
  }
  const activate = (event, i) => {
    let next = i
    if (event.key === 'ArrowRight') next = Math.min(pts.length - 1, i + 1)
    else if (event.key === 'ArrowLeft') next = Math.max(0, i - 1)
    else if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onSelect(pts[next].start)
    event.currentTarget.parentNode.querySelector(`[data-period="${pts[next].start}"]`)?.focus()
  }
  return <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart control-chart" role="group" aria-label={`Late calls by ${d.unit}. Select a point to see its calls; use left and right arrows to move between periods.`}>
    <text x={left} y="13" className="control-axis-title">Calls missing target (%)</text>
    {Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step).map((t) => <g key={t} aria-hidden="true">
      <line x1={left} x2={right} y1={y(t)} y2={y(t)} stroke="#E3E6EB" />
      <text x={left - 10} y={y(t) + 4} textAnchor="end" className="control-tick">{t}%</text>
    </g>)}
    <path d={linePath(aboveBand) + ' Z'} fill="#FFF5ED" />
    <path d={linePath(band) + ' Z'} fill="#E8EDF3" opacity="0.85" />
    <path d={linePath(envelope.map(([px, p]) => [px, y(p.ucl * 100)]))} fill="none" stroke="#C2410C" strokeWidth="2.5" strokeDasharray="6 4" />
    <path d={linePath(envelope.map(([px, p]) => [px, y(p.lcl * 100)]))} fill="none" stroke="#28745A" strokeWidth="2.5" strokeDasharray="6 4" />
    <line x1={left} x2={right} y1={y(d.p_bar * 100)} y2={y(d.p_bar * 100)} stroke="#344256" strokeWidth="1.5" />
    <path d={linePath(pts.map((p, i) => [x(i), y(p.p * 100)]))} fill="none" stroke="#0072B2" strokeWidth="2.5" />
    <text x={right - 6} y={upperLabelY > 55 ? upperLabelY - 7 : upperLabelY + 16} textAnchor="end" className="control-limit-label">Upper control limit</text>
    <text x={left + 8} y={lowerLabelY - 6} className="control-limit-label control-lower-label">Lower control limit</text>
    {pts.map((p, i) => p.start === selected && p.p > p.ucl && <line key={`excess-${p.start}`} x1={x(i)} x2={x(i)} y1={y(p.p * 100)} y2={y(p.ucl * 100)} stroke="#C2410C" strokeWidth="1.5" strokeDasharray="3 4" />)}
    {pts.map((p, i) => <g key={p.start} data-period={p.start} role="button" tabIndex={selected === p.start ? 0 : -1}
      aria-pressed={selected === p.start} aria-controls="control-selected"
      aria-label={`${describe(p)} Show period details.`}
      onClick={() => onSelect(p.start)} onKeyDown={(event) => activate(event, i)} className="control-point">
      <title>{describe(p)}</title>
      <circle cx={x(i)} cy={y(p.p * 100)} r="22" fill="transparent" />
      {p.p > p.ucl && <circle cx={x(i)} cy={y(p.p * 100)} r="9" fill="#FFF5ED" stroke="#C2410C" strokeWidth="2" />}
      {p.p < p.lcl && <circle cx={x(i)} cy={y(p.p * 100)} r="9" fill="#EFF8F3" stroke="#28745A" strokeWidth="2" />}
      {selected === p.start && <circle cx={x(i)} cy={y(p.p * 100)} r="13" fill="none" stroke="#1F2933" strokeWidth="2" />}
      {p.signal ? <rect x={x(i) - 5} y={y(p.p * 100) - 5} width="10" height="10" rx="1" fill="#C2410C" />
        : <circle cx={x(i)} cy={y(p.p * 100)} r="4" fill="#0072B2" />}
    </g>)}
    {dateIndices.map((i) => <text key={i} x={x(i)} y={bottom + 17} textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} className="control-tick">{fmtDate(periodBounds(pts[i].start, d.unit, d.selection).from)}</text>)}
  </svg>
}

export function ControlView({ p, params, selectedName, stagesState }) {
  const pts = p.points || []
  const initial = [...pts].reverse().find((pt) => pt.signal) || pts.at(-1)
  const [selected, setSelected] = useState(initial?.start)
  const [panel, setPanel] = useState('period')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const point = pts.find((pt) => pt.start === selected) || initial
  const flagged = pts.filter(isFlaggedPeriod)
  const above = pts.filter((pt) => pt.p > pt.ucl)
  const over = point && point.p > point.ucl
  const under = point && point.p < point.lcl
  const nextAbove = () => {
    const current = pts.findIndex((pt) => pt.start === point.start)
    const next = above.find((pt) => pts.indexOf(pt) > current) || above[0]
    if (next) choose(next.start)
  }
  const b = p.baseline || {}
  const insufficient = p.control === 'insufficient_baseline'
  const headline = insufficient ? 'More history needed' : p.control === 'out_of_control' ? 'Recent increase detected' : p.watch ? 'Watching one signal' : 'No confirmed increase'
  const count = (p.signals || []).length
  const finding = insufficient ? p.control_reason : p.watch ? 'Change not confirmed.' : p.control === 'out_of_control' ? `${count} statistical signals.` : ''
  const tone = insufficient ? 'data' : p.control === 'out_of_control' || p.watch ? 'signal' : 'calm'
  const choose = (start) => { setSelected(start) }
  const review = (start) => { setSelected(start); setPanel('calls'); setDetailsOpen(true) }
  const openDetails = (tab = 'period') => { setPanel(tab); setDetailsOpen(true) }
  const tabs = [{ id: 'period', label: 'Period' }, { id: 'signals', label: `Flagged periods (${flagged.length})` }, { id: 'calls', label: 'Calls' }, ...(stagesState ? [{ id: 'stages', label: 'Stage times' }] : []), { id: 'method', label: 'Method' }]
  const navigateTabs = (event, index) => {
    let next
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setPanel(tabs[next].id)
    event.currentTarget.parentNode.querySelector(`#control-tab-${tabs[next].id}`)?.focus()
  }
  const range = point && periodBounds(point.start, p.unit, p.selection)
  const start = range?.from
  const end = range?.to
  return <div className="simple-comparison control-view">
    <div className={`control-finding finding-${tone}`} role="status">
      <span className="control-finding-icon" aria-hidden="true">{tone === 'signal' ? '!' : tone === 'data' ? '…' : '—'}</span>
      <div><p className="control-headline">{headline}</p>{finding && <p className="control-summary">{finding}</p>}</div>
      {!insufficient && above.length > 0 && <button type="button" className="trend-next" onClick={nextAbove}>{above.length} above limit · Next <span aria-hidden="true">→</span></button>}
    </div>
    <p className="control-baseline">{p.selection?.name || selectedName} · Baseline {fmtDate(b.from)}–{fmtDate(b.to)} · {fmtInt(p.base_n)} calls</p>
    {insufficient ? <div className="control-empty">
      <h3>We cannot judge change yet</h3>
      <p>{b.stable === false ? 'The baseline is not stable. Open Method to review the baseline checks or choose another period.' : 'There is not enough usable history. Try a larger area or a period with more baseline calls.'}</p>

    </div> : point && p.unit ? <div className="simple-split control-split">
      <figure className="figure">
        <PChart d={p} selected={point.start} onSelect={choose} />
        <figcaption className="simple-key control-key">
          <span><i className="control-key-line" />Missed targets</span>
          <span><i className="control-key-baseline" />Baseline: {fmtPct(100 * p.p_bar)}</span>
          <span><i className="control-key-upper" />Upper</span><span><i className="control-key-lower" />Lower</span><span><i className="control-key-signal" />Signal</span>
        </figcaption>
      </figure>
      <aside id="control-selected" className={`trend-selection comparison-selection selection-${over || point.signal ? 'below' : under ? 'improvement' : 'inconclusive'}`} aria-label="Selected period overview" aria-live="polite">
        <label htmlFor="control-period">Explore a {p.unit}</label>
        <select id="control-period" value={point.start} onChange={(event) => choose(event.target.value)}>
          {pts.map((pt) => <option key={pt.start} value={pt.start}>{periodLabel(pt.start, p.unit, p.selection)}</option>)}
        </select>
        <div className="trend-selected-rate"><strong className={over ? 'rate-below' : under ? 'control-improvement-rate' : 'rate-inconclusive'}>{fmtPct(point.p * 100)}</strong><span>missed target · {fmtInt(point.late)} of {fmtInt(point.n)}</span></div>
        <div className="trend-selected-limit"><strong>{fmtPct(point.ucl * 100)}</strong><span>Upper limit</span></div>
        <span className={`card-badge badge-${over ? 'below' : under ? 'improvement' : 'inconclusive'}`}>{over ? 'Over upper limit' : under ? 'Below lower limit' : 'Within limits'}</span>
      </aside>
      <div className="trend-actions comparison-actions"><button type="button" onClick={() => openDetails()}>Details & evidence <span aria-hidden="true">↗</span></button></div>
    </div> : <p>No periods available in this selection.</p>}
    {insufficient && <button type="button" className="trend-baseline-button" onClick={() => openDetails('method')}>View baseline checks <span aria-hidden="true">↗</span></button>}
    {!insufficient && (!point || !p.unit) && <button type="button" className="trend-baseline-button" onClick={() => openDetails('method')}>Details & evidence <span aria-hidden="true">↗</span></button>}
    <EvidenceDrawer open={detailsOpen} onClose={() => setDetailsOpen(false)} title="Response details" titleId="trend-drawer-title" className="trend-evidence-drawer">
      <p className="comparison-context">{p.selection?.name || selectedName} · {p.selection?.from} – {p.selection?.to} · {(p.selection?.urgency || []).map(urgencyText).join(', ')}</p>
      <div className="control-support">
        <div className="control-tabs" role="tablist" aria-label="Control chart supporting information">
          {tabs.map((tab, index) => <button type="button" key={tab.id} id={`control-tab-${tab.id}`} role="tab" aria-selected={panel === tab.id} aria-controls="control-support-panel" tabIndex={panel === tab.id ? 0 : -1} onClick={() => setPanel(tab.id)} onKeyDown={(event) => navigateTabs(event, index)}>{tab.label}</button>)}
        </div>
        <div id="control-support-panel" className="control-tab-panel" role="tabpanel" aria-labelledby={`control-tab-${panel}`} tabIndex={0}>
          {panel === 'period' && (point && !insufficient ? <>      <aside id="control-full-selected" className={`simple-card control-card card-${over || point.signal ? 'below' : under ? 'improvement' : 'inconclusive'}`} aria-label="Selected period details" aria-live="polite">
        <label className="eyebrow" htmlFor="control-period-details">Explore a {p.unit}</label>
        <select id="control-period-details" value={point.start} onChange={(event) => choose(event.target.value)}>
          {pts.map((pt) => <option key={pt.start} value={pt.start}>{periodLabel(pt.start, p.unit, p.selection)}{pt.p > pt.ucl ? ' · above upper limit' : pt.p < pt.lcl ? ' · below lower limit' : pt.signal ? ' · statistical signal' : ''}</option>)}
        </select>
        <div className="card-head"><h3>{periodLabel(point.start, p.unit, p.selection)}</h3><span className={`card-badge badge-${over || point.signal ? 'below' : under ? 'improvement' : 'inconclusive'}`}>{over ? 'Over upper limit' : point.p < point.lcl ? 'Below lower limit' : 'Within limits'}</span></div>
        <p className="card-rate"><strong className={`card-big ${over || point.signal ? 'rate-below' : under ? 'control-improvement-rate' : 'control-rate'}`}>{fmtPct(point.p * 100)}</strong> missed target</p>
        <p><strong>{fmtInt(point.late)} of {fmtInt(point.n)}</strong> calls missed their response target.</p>
        <div className="card-pair control-limit-values"><div><strong>{fmtPct(p.p_bar * 100)}</strong><span>Historical rate</span></div><div><strong>{fmtPct(point.ucl * 100)}</strong><span>Upper limit</span></div><div><strong>{fmtPct(point.lcl * 100)}</strong><span>Lower limit</span></div></div>
        <p className="control-limit-comparison">{fmtPct(point.p * 100)} is <strong>{under ? 'below' : over ? 'above' : 'at or below'}</strong> {fmtPct((under ? point.lcl : point.ucl) * 100)} {under ? 'lower' : 'upper'} limit.</p>
        {isFlaggedPeriod(point) && params && <button type="button" className="btn control-calls-btn" aria-controls="control-support-panel" onClick={() => review(point.start)}>Review calls <span aria-hidden="true">→</span></button>}
      </aside></> : <p className="small muted">No usable control chart for this selection. Open Method for baseline checks.</p>)}
          {panel === 'signals' && <SignalList p={p} onReview={review} />}
          {detailsOpen && panel === 'calls' && (point && params ? <><p className="control-panel-caption"><strong>{periodLabel(point.start, p.unit, p.selection)}</strong> · {fmtInt(point.late)} of {fmtInt(point.n)} late</p><SignalCalls key={point.start} params={params} start={start} end={end} /></> : <p className="small muted">Select a period with calls to review.</p>)}
          {panel === 'stages' && stagesState && <Async state={stagesState}>{(d) => <><StageTable data={d} /><Messages messages={d.messages} /></>}</Async>}
          {panel === 'method' && <ControlMethod p={p} />}
        </div>
      </div>
    </EvidenceDrawer>

  </div>
}

export function ControlMethod({ p }) {
  const b = p.baseline || {}
  return <div className="control-method-text">
    <div className="control-evidence-facts">
      <p><JudgmentBadge kind="control" value={p.control} /> <WatchChip p={p} /></p>
      <p><strong>Baseline:</strong> {fmtDate(b.from)}–{fmtDate(b.to)} · {b.days} days{b.stretched ? ' (extended for low volume)' : ''} · {fmtInt(p.base_late)} of {fmtInt(p.base_n)} late ({p.p_bar == null ? 'n/a' : fmtPct(100 * p.p_bar)}). <BaselineCheck b={b} /></p>
    </div>
        <p>{p.control_reason}.</p>
        <p>A confirmed increase needs two unusual periods, or one exceptionally strong signal after allowing for the number of periods checked. Orange squares are identified by the exact binomial test; a visual crossing alone may not be a statistical signal.</p>
        <p>No confirmed increase does not mean the service goal is met. See Part 1 for the service-goal judgment.</p>
        <p>Orange outlines mark points above the upper limit; green outlines mark points below the lower limit. Crossings alone do not confirm a change. Select a point to inspect its counts and limits.</p>
        <p>The baseline never overlaps the selected range. It is screened for unusual periods and assumed to represent normal operation. This is a p chart, limits vary with n.</p>
        {p.dispersion && <p>Baseline dispersion: {fmtNum(p.dispersion.ratio, 2)} (p = {fmtP(p.dispersion.p_value)}){p.dispersion.overdispersed ? ' — more variable than binomial; treat signals with caution.' : ' — no overdispersion detected; limited power with few periods.'}{p.run_signal ? ' Run of 9 above the center line (information only).' : ''}</p>}
        <Messages messages={p.messages} />
  </div>
}

const CALL_LIMIT = 50

/** The valid calls behind one signal: read-only, newest first (the API caps it at CALL_LIMIT). */
export function SignalCallsTable({ data }) {
  const calls = data.calls || []
  return (
    <div className="signal-calls">
      <div className="table-scroll short" tabIndex={0} role="region" aria-label="Calls behind this signal">
        <table className="places compact">
          <caption className="small muted">
            {fmtInt(data.returned)} of {fmtInt(data.valid)} calls · {fmtDate(data.start)}–{fmtDate(data.end)} · {fmtInt(data.late)} late · Read-only · Newest first · Times m:ss
          </caption>
          <thead>
            <tr>
              <th scope="col">Received</th><th scope="col">Call</th><th scope="col">ZIP area</th><th scope="col">Total wait</th><th scope="col">Late?</th>
              <th scope="col">Received to assigned</th><th scope="col">Assigned to en route</th><th scope="col">En route to on scene</th><th scope="col">Waited for a unit</th>
            </tr>
          </thead>
          <tbody>
            {calls.length === 0 && <tr><td colSpan={9}>No valid calls in this period.</td></tr>}
            {calls.map((c) => (
              <tr key={c.incident_id}>
                <td className="mono">{fmtDate(c.t_received)} {String(c.t_received).slice(11, 16)}</td>
                <td className="mono">{c.incident_id}</td>
                <td className="mono">{c.zcta}</td>
                <td className="mono">{mmss(c.total_s)}</td>
                <td>{c.late ? 'late' : 'on time'}</td>
                <td className="mono">{mmss(c.dispatch_s)}</td>
                <td className="mono">{mmss(c.turnout_s)}</td>
                <td className="mono">{mmss(c.drive_s)}</td>
                <td>{c.held ? 'yes' : 'no'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SignalCalls({ params, start, end }) {
  const state = useEndpoint('signal_calls', { ...params, start, end, limit: CALL_LIMIT })
  return <Async state={state}>{(d) => <SignalCallsTable data={d} />}</Async>
}

export function SignalList({ p, onReview }) {
  const flagged = (p.points || []).filter(isFlaggedPeriod)
  if (!flagged.length) return <p className="small muted">No periods outside the control limits or flagged by the statistical test.</p>
  return <div className="table-scroll short" tabIndex={0} role="region" aria-label="Flagged periods">
    <table className="places compact">
      <caption className="small muted">All highlighted periods. Signals require the statistical test.</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Late calls</th><th scope="col">Control limit</th><th scope="col">Signal (p-value)</th><th scope="col">Calls</th></tr></thead>
      <tbody>{flagged.map((s) => <tr key={s.start}>
        <td className="mono">{periodLabel(s.start, p.unit, p.selection)}</td>
        <td><strong>{fmtPct(100 * s.p)}</strong><span className="control-table-sub">{fmtInt(s.late)} of {fmtInt(s.n)}</span></td>
        <td className={s.p > s.ucl ? 'control-upper-text' : s.p < s.lcl ? 'control-lower-text' : ''}>{s.p > s.ucl ? 'Above upper limit' : s.p < s.lcl ? 'Below lower limit' : 'Within limits'}<span className="control-table-sub">{s.p > s.ucl ? fmtPct(100 * s.ucl) : s.p < s.lcl ? fmtPct(100 * s.lcl) : 'Flagged by exact test'}</span></td>
        <td>{s.signal ? <>Yes <span className="mono">({fmtP(s.p_value)})</span></> : 'No'}</td>
        <td><button type="button" className="btn btn-small" aria-controls="control-support-panel" onClick={() => onReview(s.start)}>show calls</button></td>
      </tr>)}</tbody>
    </table>
  </div>
}

/** Plain medians of the three stages and the share of calls that waited for a unit: the period beside its baseline. */
export function StageTable({ data }) {
  const now = data.now || {}
  const base = data.base || {}
  const rows = [
    { label: 'Received to assigned', a: mmss(now.dispatch_s), b: mmss(base.dispatch_s) },
    { label: 'Assigned to en route', a: mmss(now.turnout_s), b: mmss(base.turnout_s) },
    { label: 'En route to on scene', a: mmss(now.drive_s), b: mmss(base.drive_s) },
    { label: 'Calls that waited for a unit (held)', a: fmtPct(now.held_pct), b: fmtPct(base.held_pct) },
  ]
  return (
    <div className="sub-block">
      <h3>Stage times (descriptive)</h3>
      <p className="small muted">
        Medians only (m:ss); held calls are a percent. These comparisons do not explain why times changed.
      </p>
      <div className="table-scroll short" tabIndex={0} role="region" aria-label="Stage times, descriptive">
        <table className="places narrow compact">
          <thead><tr><th scope="col">Stage</th><th scope="col">This period (median)</th><th scope="col">Baseline (median)</th><th scope="col">n (calls)</th></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th><td className="mono">{r.a}</td><td className="mono">{r.b}</td>
                <td className="mono">{i === 0 ? `${fmtInt(now.n)} now / ${fmtInt(base.n)} baseline` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function ChangeSection({ pState, stagesState, params, selectedName }) {
  return (
    <Section num={2} id="section-2" title="Are more calls missing their response target?" tag="Change over time"
      intro="Track missed targets that averages can hide—and spot unusual increases.">
      <Async state={pState}>{(p) => <ControlView key={JSON.stringify(p.selection)} p={p} params={params} selectedName={selectedName} stagesState={stagesState} />}</Async>
    </Section>
  )
}
