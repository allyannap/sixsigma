import { linear } from '../charts.js'
import { fmtDate, fmtInt, fmtPct, mmss } from '../format.js'
import { STAGES, STAGE_KEYS } from '../status.js'
import { Async, Messages, Section } from './common.jsx'

const signed = (s) => (s == null ? 'n/a' : `${s > 0 ? '+' : ''}${mmss(s)}`)

function StageTable({ d }) {
  const t = d.total
  return (
    <div className="table-scroll">
      <table className="places compact">
        <caption className="small muted">Recorded time per stage, {fmtInt(d.late_calls)} late calls vs the baseline (m:ss)</caption>
        <thead>
          <tr><th scope="col">Stage</th><th scope="col">Baseline median</th><th scope="col">Late calls, average</th><th scope="col">Extra time</th><th scope="col">Largest extra in</th></tr>
        </thead>
        <tbody>
          {STAGE_KEYS.map((k) => (
            <tr key={k} className={d.top_stage === k ? 'row-selected' : ''}>
              <th scope="row">{STAGES[k].label}<div className="small muted">{STAGES[k].who}</div></th>
              <td className="mono">{mmss(d.base_median[k])}</td>
              <td className="mono">{mmss(d.late_mean[k])}</td>
              <td className="mono strong">{signed(d.mean_excess[k])}</td>
              <td className="mono">{fmtInt(d.counts[k])} calls</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Total (received to on scene)</th>
            <td className="mono">{mmss(t.base_median_sum)} <span className="muted small">sum of medians</span></td>
            <td className="mono">{mmss(t.late_mean)}</td>
            <td className="mono strong">{signed(t.excess)}</td>
            <td className="mono">{fmtInt(d.counts.none)} calls: no stage above typical</td>
          </tr>
        </tbody>
      </table>
      <p className="small muted">
        Arithmetic check: each call's total is the sum of its three stages, so the extra times add up to the total extra
        ({signed(d.mean_excess.dispatch_s)} {signed(d.mean_excess.turnout_s)} {signed(d.mean_excess.drive_s)} &asymp; {signed(t.excess)}, rounded to the second).
      </p>
    </div>
  )
}

function Contributors({ d }) {
  const top = d.top_stage ? STAGES[d.top_stage] : null
  return (
    <div className="stack grow">
      <strong className="h3">Possible contributors to review</strong>
      {top ? (
        <>
          <p>Late calls spent the most extra recorded time in <strong>{top.label}</strong> ({top.who}). Topics to look into:</p>
          <ul>{top.topics.map((x) => <li key={x}>{x}</li>)}</ul>
        </>
      ) : <p>No stage is above its baseline median on average: late calls here look like typical calls that were already near the target.</p>}
      <p className="small">
        {d.held == null ? 'Held calls (no unit free) are not recorded in this data.'
          : <>{fmtInt(d.held)} of {fmtInt(d.late_calls)} late calls are marked <strong>held</strong> in the record (no unit was free).</>}
      </p>
      <p className="small muted">These are measured stage times, not proven causes. Confirm with the call records before acting.</p>
    </div>
  )
}

function Worst({ d }) {
  const w = d.worst_call
  if (!w) return null
  return (
    <div className="worst stack">
      <strong className="h3">One call to check: the longest wait</strong>
      <div className="small muted">{w.incident_id} &middot; {fmtDate(w.t_received)} {String(w.t_received).slice(11, 16)} &middot; total {mmss(w.total_s)}{w.held ? ' · held: no unit free' : ''}</div>
      {STAGE_KEYS.map((k) => (
        <div className="kv" key={k}><span>{STAGES[k].label}</span><span className="mono">{mmss(w[k])} <span className="muted">({signed(w.excess[k])} vs median)</span></span></div>
      ))}
      <div className="kv strong"><span>Total</span><span className="mono">{mmss(w.total_s)}</span></div>
    </div>
  )
}

function TravelBlock({ g }) {
  const d = g.diff
  return (
    <div className="stack grow">
      <strong className="h3">Unusual travel-time difference</strong>
      <div className="caption">Actual en-route-to-on-scene time minus the travel estimate stored at assignment. Ambulances can be faster or slower than the estimate.</div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-label">Median difference now</div><div className="kpi-value">{signed(d.median_s)}</div><div className="kpi-sub">baseline {signed(d.base_median_s)}</div></div>
        <div className="kpi"><div className="kpi-label">Slower / faster than the estimate</div><div className="kpi-value">{fmtPct(d.pct_slower, 0)} <small>/ {fmtPct(d.pct_faster, 0)}</small></div><div className="kpi-sub">{fmtInt(d.n)} calls</div></div>
        <div className="kpi"><div className="kpi-label">Unusual (above the baseline's 95th percentile, {signed(d.threshold_s)})</div><div className="kpi-value">{fmtInt(d.n_unusual)}</div><div className="kpi-sub">{fmtPct(d.pct_unusual)} of calls; about 5% expected if nothing changed</div></div>
      </div>
      <p className="note-box">Interpret cautiously. A drive slower than the estimate is a clue to review, not a failure. {g.provenance}.</p>
    </div>
  )
}

function Hist({ hist }) {
  const e = hist.edges_s
  const W = 560
  const L = 48
  const R = 540
  const x = linear(e[0], e[e.length - 1], L, R)
  const max = Math.max(1, ...hist.now, ...hist.baseline)
  const panel = (counts, top, label) => {
    const base = top + 100
    const y = linear(0, max, base, top + 14)
    return (
      <g>
        <text x={L} y={top + 6} fontSize="12" fontWeight="700" fill="#17201C">{label}</text>
        <line x1={L} x2={R} y1={base} y2={base} stroke="#9AA39D" />
        {counts.map((c, i) => {
          const slow = e[i] >= 0
          return (
            <rect key={i} x={x(e[i]) + 1} y={y(c)} width={Math.max(1, x(e[i + 1]) - x(e[i]) - 2)} height={base - y(c)}
              fill={slow ? '#B42318' : '#2E7D4A'}>
              <title>{`${mmss(e[i])} to ${mmss(e[i + 1])} vs estimate: ${c} drives (${slow ? 'slower' : 'faster'})`}</title>
            </rect>
          )
        })}
      </g>
    )
  }
  const ticks = e.filter((_, i) => i % 2 === 0)
  return (
    <svg viewBox={`0 0 ${W} 290`} className="chart" role="img"
      aria-label="Two histograms of actual drive time minus the stored estimate, now and baseline. Bars left of zero are faster than the estimate.">
      {panel(hist.now, 8, 'Now')}
      {panel(hist.baseline, 140, 'Baseline')}
      <line x1={x(0)} x2={x(0)} y1="20" y2="250" stroke="#17201C" strokeWidth="1.5" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y="266" fontSize="11" textAnchor="middle" fill="#56615B" fontWeight={t === 0 ? 600 : 400}>{t === 0 ? 'same as estimate' : mmss(t)}</text>
      ))}
      <text x={x(e[0]) + 80} y="284" fontSize="11" fontWeight="600" fill="#1E6B3A" textAnchor="middle">&larr; faster than estimate</text>
      <text x={x(e[e.length - 1]) - 80} y="284" fontSize="11" fontWeight="600" fill="#B42318" textAnchor="middle">slower than estimate &rarr;</text>
    </svg>
  )
}

export default function DelaySection({ delaysState, googleState, selectedName }) {
  return (
    <Section num={3} id="section-3" title={`What Held Up the Call: ${selectedName}`}
      intro="Where the recorded minutes of late calls went, stage by stage, compared with typical (median) stage times in the baseline.">
      <Async state={delaysState}>
        {(d) => (
          <>
            {d.late_calls > 0 ? (
              <>
                <StageTable d={d} />
                <div className="split top-rule">
                  <Contributors d={d} />
                  <Worst d={d} />
                </div>
              </>
            ) : <p>No late calls in this selection.</p>}
            <Messages messages={d.messages} />
          </>
        )}
      </Async>
      <Async state={googleState}>
        {(g) => (g.available ? (
          <div className="split top-rule">
            <TravelBlock g={g} />
            <figure className="figure grow">
              <figcaption>
                <strong>Every drive compared with its estimate</strong>
                <span className="caption"><strong className="green">Left of the line:</strong> faster than the estimate. <strong className="red">Right:</strong> slower.</span>
              </figcaption>
              <Hist hist={g.hist} />
              <Messages messages={g.messages} />
            </figure>
          </div>
        ) : (
          <div className="top-rule">
            <p className="callout gray"><strong>Comparison unavailable.</strong> No comparable travel-time estimate for these calls.</p>
            <Messages messages={g.messages} />
          </div>
        ))}
      </Async>
    </Section>
  )
}
