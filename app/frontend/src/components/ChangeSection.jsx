import { useState } from 'react'
import { dotsPath, linear, linePath, logScale, logTicks } from '../charts.js'
import { fmtDate, fmtInt, fmtMin, fmtNum, fmtP, fmtPct, mmss, periodEnd } from '../format.js'
import { useEndpoint } from '../useApi.js'
import { Async, BaselineCheck, JudgmentBadge, Messages, Section, WatchChip } from './common.jsx'

const L = 56
const R = 704

function PChart({ d }) {
  const pts = d.points || []
  if (!pts.length) return <p>No days in this selection.</p>
  // The API sends fractions 0-1 (docs/api.md); the chart shows percents.
  const k = 100
  const top = Math.max(...pts.map((p) => Math.max(p.ucl, p.p))) * k * 1.1
  const H = 280
  const x = (i) => L + ((R - L) * (pts.length < 2 ? 0.5 : i / (pts.length - 1)))
  const y = linear(0, top, H - 36, 14)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const signals = pts.filter((p) => p.signal).length
  return (
    <svg viewBox={`0 0 720 ${H}`} className="chart" role="img"
      aria-label={`p chart of the percent of calls that were late, per ${d.unit}. ${signals} bad ${d.unit}s are above the upper limit.`}>
      {ticks.map((t) => (
        <g key={t}><line x1={L} x2={R} y1={y(t)} y2={y(t)} stroke="#E3E6E1" /><text x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#56615B">{t.toFixed(0)}%</text></g>
      ))}
      <path d={linePath(pts.map((p, i) => [x(i), y(p.ucl * k)]))} fill="none" stroke="#B42318" strokeWidth="1.5" strokeDasharray="5 4" />
      <path d={linePath(pts.map((p, i) => [x(i), y(p.lcl * k)]))} fill="none" stroke="#B42318" strokeWidth="1.5" strokeDasharray="5 4" />
      <line x1={L} x2={R} y1={y(d.p_bar * k)} y2={y(d.p_bar * k)} stroke="#17201C" strokeWidth="1.5" />
      <text x={R + 4} y={y(d.p_bar * k) + 4} fontSize="11" fill="#17201C">CL</text>
      <text x={R + 4} y={y(pts[pts.length - 1].ucl * k) + 4} fontSize="11" fill="#B42318">UCL</text>
      <path d={linePath(pts.map((p, i) => [x(i), y(p.p * k)]))} fill="none" stroke="#5C7FA8" strokeWidth="1.2" />
      {pts.map((p, i) => p.signal
        ? <rect key={p.start} x={x(i) - 6} y={y(p.p * k) - 6} width="12" height="12" fill="#B42318"><title>{`${fmtDate(p.start)}: ${(p.p * k).toFixed(1)}% late (${p.late} of ${p.n}), above the limit`}</title></rect>
        : <circle key={p.start} cx={x(i)} cy={y(p.p * k)} r="3.5" fill="#1F3A5F"><title>{`${fmtDate(p.start)}: ${(p.p * k).toFixed(1)}% late (${p.late} of ${p.n})`}</title></circle>)}
      <text x={L} y={H - 8} fontSize="11" fill="#56615B">{fmtDate(pts[0].start)}</text>
      <text x={R} y={H - 8} fontSize="11" fill="#56615B" textAnchor="end">{fmtDate(pts[pts.length - 1].start)}</text>
    </svg>
  )
}

function ImrCharts({ d, sel }) {
  const pts = d.points || []
  if (!pts.length) return <p>No timed calls in this selection.</p>
  const n = pts.length
  const x = (i) => L + ((R - L) * (n < 2 ? 0.5 : i / (n - 1)))
  const mins = pts.map((p) => p.minutes)
  const lo = Math.min(d.lcl_min, ...mins) * 0.9
  const hi = Math.max(d.ucl_min, ...mins) * 1.1
  const H = 280
  const y = logScale(lo, hi, H - 36, 14)
  const flagged = (p) => p.beyond_3_sigma
  const normal = []
  const bad = []
  pts.forEach((p, i) => (flagged(p) ? bad : normal).push([x(i), y(p.minutes)]))
  // where the baseline ends and the selected range begins (for the two median lines)
  let split = pts.findIndex((p) => String(p.t_received).slice(0, 10) >= (sel?.from || ''))
  if (split < 0) split = 0
  const hasSplit = split > 0 && d.before_median_min != null && d.after_median_min != null
  const mr = pts.map((p) => p.mr)
  const mrTop = Math.max(d.mr_ucl, ...mr.filter((v) => v != null)) * 1.1
  const MH = 150
  const my = linear(0, mrTop, MH - 24, 10)
  const mrNormal = []
  const mrBad = []
  pts.forEach((p, i) => { if (p.mr != null) (p.mr > d.mr_ucl ? mrBad : mrNormal).push([x(i), my(p.mr)]) })
  const worst = [...pts].sort((a, b) => b.minutes - a.minutes)[0]
  return (
    <>
      <svg viewBox={`0 0 720 ${H}`} className="chart" role="img"
          aria-label={`Dot plot of every call, log scale. ${bad.length} calls are beyond 3 sigma.${worst ? ` The longest wait was ${fmtMin(worst.minutes)}.` : ''}`}>
        <rect x={L} y={y(d.ucl_min)} width={R - L} height={Math.max(0, y(d.lcl_min) - y(d.ucl_min))} fill="#DDEFE2" />
        <line x1={L} x2={R} y1={H - 36} y2={H - 36} stroke="#9AA39D" />
        {logTicks(lo, hi).map((t) => (
          <text key={t} x={L - 6} y={y(t) + 4} fontSize="11" textAnchor="end" fill="#56615B">{t}</text>
        ))}
        <text x="12" y="120" fontSize="11" fill="#56615B" transform="rotate(-90 12 120)" textAnchor="middle">minutes to arrive</text>
        <path d={dotsPath(normal)} stroke="#1F3A5F" strokeOpacity="0.5" strokeWidth="5" strokeLinecap="round" fill="none" />
        <path d={dotsPath(bad)} stroke="#B42318" strokeWidth="9" strokeLinecap="round" fill="none" />
        {hasSplit ? (
          <>
            <line x1={L} x2={x(split)} y1={y(d.before_median_min)} y2={y(d.before_median_min)} stroke="#17201C" strokeWidth="3" />
            <line x1={x(split)} x2={R} y1={y(d.after_median_min)} y2={y(d.after_median_min)} stroke="#17201C" strokeWidth="3" />
            <text x={L + 4} y={y(d.before_median_min) - 6} fontSize="11" fontWeight="600" fill="#17201C">typical {fmtMin(d.before_median_min)}</text>
            <text x={R - 4} y={y(d.after_median_min) - 6} fontSize="11" fontWeight="600" fill="#17201C" textAnchor="end">typical {fmtMin(d.after_median_min)}</text>
          </>
        ) : (
          <line x1={L} x2={R} y1={y(d.cl_min)} y2={y(d.cl_min)} stroke="#17201C" strokeWidth="2" />
        )}
        <text x={L} y={H - 8} fontSize="11" fill="#56615B">{fmtDate(pts[0].t_received)}</text>
        <text x={R} y={H - 8} fontSize="11" fill="#56615B" textAnchor="end">{fmtDate(pts[n - 1].t_received)}</text>
      </svg>
      <p className="small muted">
        I chart on ln(minutes), limits from the baseline: center {fmtMin(d.cl_min)}, upper limit {fmtMin(d.ucl_min)}, lower limit {fmtMin(d.lcl_min)}.
        Log scale because response times are right-skewed.
      </p>
      <details className="math">
        <summary>Show the moving range (MR) chart and the assumption checks</summary>
        <div className="split">
          <div className="grow">
            <strong>Moving range chart: call-to-call jumps in log minutes</strong>
            <svg viewBox={`0 0 720 ${MH}`} className="chart" role="img" aria-label={`Moving range chart. ${mrBad.length} jumps are above the upper limit.`}>
              <line x1={L} x2={R} y1={my(0)} y2={my(0)} stroke="#9AA39D" />
              <path d={dotsPath(mrNormal)} stroke="#5C7FA8" strokeWidth="3" strokeLinecap="round" fill="none" />
              <path d={dotsPath(mrBad)} stroke="#B42318" strokeWidth="6" strokeLinecap="round" fill="none" />
              <line x1={L} x2={R} y1={my(d.mr_ucl)} y2={my(d.mr_ucl)} stroke="#B42318" strokeWidth="1.5" strokeDasharray="5 4" />
              <text x={L - 6} y={my(0) + 4} fontSize="11" textAnchor="end" fill="#56615B">0</text>
              <text x={L - 6} y={my(d.mr_ucl) + 4} fontSize="11" textAnchor="end" fill="#B42318">UCL</text>
            </svg>
          </div>
          <div className="grow">
            <strong>Assumption checks on the baseline (log minutes)</strong>
            <ul className="tests">
              <li><span className="grow">Calls in the baseline</span><span className="mono">{fmtInt(d.assumptions?.n)}</span></li>
              <li><span className="grow">Skewness (0 = symmetric; the I chart assumes about 0)</span><span className="mono">{fmtNum(d.assumptions?.skew, 2)}</span></li>
              <li><span className="grow">Lag-1 autocorrelation (0 = independent calls)</span><span className="mono">{fmtNum(d.assumptions?.lag1, 2)}</span></li>
            </ul>
            <div className="small muted">Only test 1 (a call beyond 3 sigma) is marked. Other Nelson run rules are not used: their false-alarm rate on this data was not validated.</div>
          </div>
        </div>
      </details>
    </>
  )
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
            {fmtInt(data.returned)} of {fmtInt(data.valid)} valid calls received {fmtDate(data.start)} to {fmtDate(data.end)} ({fmtInt(data.late)} late), newest first, at most {CALL_LIMIT}.
            Read-only. Stage times are plain seconds from the call record.
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

function SignalList({ p, params, selection }) {
  const [open, setOpen] = useState(null)
  const sig = p.signals || []
  if (!sig.length) return null
  const from = selection && selection.from
  const to = selection && selection.to
  return (
    <table className="places compact">
      <caption className="small muted">Evidence: each {p.unit} above its upper control limit (exact binomial p-value, one-sided)</caption>
      <thead><tr><th scope="col">{p.unit} starting</th><th scope="col">Late</th><th scope="col">Late share</th><th scope="col">Upper limit</th><th scope="col">p-value</th><th scope="col">Calls</th></tr></thead>
      <tbody>
        {sig.map((s) => {
          // A period can start before the selected range (weeks start on Monday): only calls inside the range are in it.
          const start = from && s.start < from ? from : s.start
          const end = periodEnd(s.start, p.unit, to)
          const isOpen = open === s.start
          return [
            <tr key={s.start}>
              <td className="mono">{fmtDate(s.start)}</td><td className="mono">{fmtInt(s.late)} of {fmtInt(s.n)}</td>
              <td className="mono">{fmtPct(100 * s.p)}</td><td className="mono">{fmtPct(100 * s.ucl)}</td>
              <td className="mono">{fmtP(s.p_value)}</td>
              <td>
                <button type="button" className="btn btn-small" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.start)}>
                  {isOpen ? 'hide calls' : 'show calls'}
                </button>
              </td>
            </tr>,
            isOpen && <tr key={`${s.start}-calls`}><td colSpan={6}><SignalCalls params={params} start={start} end={end} /></td></tr>,
          ]
        })}
      </tbody>
    </table>
  )
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
        Medians only (m:ss; the last row is a percent). They show where time was spent in this period and in the baseline; they do not explain why.
        The earlier delay-breakdown card was removed, and nothing here ranks or blames a crew.
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

export default function ChangeSection({ pState, imrState, stagesState, params, selectedName }) {
  return (
    <Section num={2} id="section-2" title={`${selectedName}: has the process changed from its own history?`}
      intro="Statistical control compares the late share in each period with a fixed baseline: the days just before the selected range. It answers 'did something change?', not 'is the service good enough?' (that is the target check in Section 1).">
      <Async state={pState}>
        {(p) => {
          const b = p.baseline || {}
          return (
            <>
              <p className={`callout ${p.control === 'out_of_control' ? 'orange' : p.control === 'in_control' ? 'green' : 'gray'}`} role="status">
                <JudgmentBadge kind="control" value={p.control} /> {p.control_reason}.
                {p.watch && p.control === 'in_control' && <> <WatchChip p={p} /></>}
                {p.control === 'insufficient_baseline' && (b.stable === false
                  ? ' The baseline was screened and is not stable, so the chart cannot judge change here.'
                  : ' The chart cannot judge change here; widen the date range or look at a larger area.')}
              </p>
              <p className="small">
                <strong>Baseline:</strong> {fmtDate(b.from)} to {fmtDate(b.to)} ({b.days} days{b.stretched ? ', stretched from 60 because of low volume' : ''}),
                {' '}{fmtInt(p.base_late)} late of {fmtInt(p.base_n)} valid calls = {p.p_bar == null ? 'n/a' : fmtPct(100 * p.p_bar)} late.
                It never overlaps the selected range. It is screened for unusual periods and assumed to represent normal operation; if it does not, the limits do not either.
                {' '}<BaselineCheck b={b} />
              </p>
              {p.unit != null && p.points && p.points.length > 0 && (
                <figure className="figure">
                  <figcaption>
                    <strong>Share of calls that were late, by {p.unit}</strong> <code className="analyst">p chart, limits vary with n</code>
                    <span className="caption">
                      Solid line: the baseline late share. Dashed lines: 3-sigma limits, wider when a {p.unit} has fewer calls.
                      {' '}<strong className="red">Red squares</strong>: {p.unit}s above the upper limit (the rule that sets the control status).
                    </span>
                  </figcaption>
                  <PChart d={p} />
                </figure>
              )}
              <SignalList p={p} params={params} selection={p.selection} />
              {p.dispersion && (
                <p className="small muted">
                  Assumption check (kept baseline {p.unit}s): spread of late counts vs binomial, chi-square / df = {fmtNum(p.dispersion.ratio, 2)}
                  {' '}(p = {fmtP(p.dispersion.p_value)}){p.dispersion.overdispersed ? ': more variable than binomial, so treat signals with caution.' : ': no overdispersion detected (this check has little power with few periods).'}
                  {p.run_signal ? ' A run of 9 periods above the center line is also present (information only).' : ''}
                </p>
              )}
              <Messages messages={p.messages} />
            </>
          )
        }}
      </Async>
      {stagesState && <Async state={stagesState}>{(d) => <><StageTable data={d} /><Messages messages={d.messages} /></>}</Async>}
      <details className="math">
        <summary>Optional, secondary: every call on a log scale (I chart)</summary>
        <Async state={imrState}>
          {(d) => (
            <>
              <figure className="figure">
                <figcaption>
                  <strong>Every call, one dot each</strong> <code className="analyst">individuals (I) chart, ln(minutes)</code>
                  <span className="caption">
                    The <strong className="green">green band</strong> is the baseline's 3-sigma range on the log scale. <strong className="red">Red dots</strong> are
                    single calls beyond it: worth a look one by one. This chart does not set any status.
                  </span>
                </figcaption>
                <ImrCharts d={d} sel={d.selection} />
              </figure>
              <Messages messages={d.messages} />
            </>
          )}
        </Async>
      </details>
    </Section>
  )
}
