import { dotsPath, linear, linePath, logScale, logTicks } from '../charts.js'
import { fmtDate, fmtInt, fmtMin } from '../format.js'
import { Async, Messages, Section } from './common.jsx'

const L = 56
const R = 704

function PChart({ d }) {
  const pts = d.points || []
  if (!pts.length) return <p>No days in this selection.</p>
  // The API may send fractions (0.12) or percents (12); show percents either way.
  const k = Math.max(d.p_bar, ...pts.map((p) => p.ucl)) > 1 ? 1 : 100
  const top = Math.max(...pts.map((p) => Math.max(p.ucl, p.p))) * k * 1.1
  const H = 280
  const x = (i) => L + ((R - L) * (pts.length < 2 ? 0.5 : i / (pts.length - 1)))
  const y = linear(0, top, H - 36, 14)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top)
  const signals = pts.filter((p) => p.signal).length
  return (
    <svg viewBox={`0 0 720 ${H}`} className="chart" role="img"
      aria-label={`p chart of the percent of calls that were late, per ${d.unit}. ${signals} ${d.unit}s are above the upper limit.`}>
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
  const flagged = (p) => (p.tests && p.tests.length > 0)
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
        aria-label={`Dot plot of every call, log scale. ${bad.length} calls fall outside the normal range.${worst ? ` The longest wait was ${fmtMin(worst.minutes)}.` : ''}`}>
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
        <summary>Show the moving range (MR) chart and the special-cause tests</summary>
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
            <strong>Special-cause tests (I chart)</strong>
            <div className="small muted">All 8 run. Only tests marked "alerts" count toward a recent-change flag.</div>
            <ul className="tests">
              {(d.tests || []).map((t) => (
                <li key={t.id}>
                  <span className="mono muted">{t.id}</span>
                  <span className="grow">{t.rule}</span>
                  <span className={`chip ${t.fired ? (t.alert ? 'chip-bad' : 'chip-warn') : 'chip-ok'}`}>
                    {t.fired ? (t.alert ? 'Fired: alerts' : 'Fired') : 'Clear'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </>
  )
}

export default function ChangeSection({ pState, imrState, selectedName }) {
  return (
    <Section num={3} id="section-3" title={`${selectedName}: a real change, or just a few bad days?`}>
      <Async state={pState}>
        {(p) => {
          const signals = (p.points || []).filter((q) => q.signal).length
          return (
            <>
              <p className={`callout ${signals || p.run_signal ? 'orange' : 'green'}`} role="status">
                {signals || p.run_signal
                  ? <><strong>The late share rose beyond what chance explains.</strong> {signals} {p.unit}{signals === 1 ? '' : 's'} above the upper limit{p.run_signal ? ', and a run of 9 in a row above the center line' : ''}.</>
                  : <><strong>No clear change.</strong> No {p.unit} is above its limit and there is no long run above the center line.</>}
              </p>
              <figure className="figure">
                <figcaption>
                  <strong>Share of urgent calls that were late, by {p.unit}</strong> <code className="analyst">p chart, varying limits</code>
                  <span className="caption">
                    The solid line is the baseline average ({(Math.max(p.p_bar, 0) * (p.p_bar > 1 ? 1 : 100)).toFixed(1)}% late, from {fmtInt(p.base_n)} calls). Dashed lines are the limits;
                    they move with the number of calls in each {p.unit}. <strong className="red">Red squares</strong> are {p.unit}s above the upper limit.
                  </span>
                </figcaption>
                <PChart d={p} />
              </figure>
              <Messages messages={p.messages} />
            </>
          )
        }}
      </Async>
      <Async state={imrState}>
        {(d) => (
          <>
            <figure className="figure">
              <figcaption>
                <strong>Every urgent call, one dot each</strong> <code className="analyst">individuals (I) chart, log scale</code>
                <span className="caption">
                  Higher dot = longer wait. The <strong className="green">green band</strong> is the normal range from the baseline; the dark line is the typical wait.
                  <strong className="red"> Red dots</strong> are calls where a special-cause test fired; each deserves a look.
                </span>
              </figcaption>
              <ImrCharts d={d} sel={d.selection} />
            </figure>
            <Messages messages={d.messages} />
          </>
        )}
      </Async>
    </Section>
  )
}
