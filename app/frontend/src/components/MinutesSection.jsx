import { linear } from '../charts.js'
import { fmtInt, fmtPct, mmss } from '../format.js'
import { Async, Messages, Section } from './common.jsx'

const STEP_COLORS = { dispatch_s: '#B9C9DE', turnout_s: '#4A6E99', drive_s: '#1F3A5F' }
const STEP_TEXT = { dispatch_s: '#17201C', turnout_s: '#FFFFFF', drive_s: '#FFFFFF' }
const STEP_NAMES = {
  dispatch_s: '911 center: call answered to ambulance assigned',
  turnout_s: 'Crew: assigned to rolling',
  drive_s: 'Drive: rolling to on scene',
}

function StepBars({ steps }) {
  const keys = ['dispatch_s', 'turnout_s', 'drive_s']
  const max = Math.max(steps.now.total_s, steps.baseline.total_s, 1)
  const row = (label, s) => {
    const sum = keys.reduce((a, k) => a + s[k], 0) || 1
    return (
      <div className="step-row" key={label}>
        <div className="step-label">{label}</div>
        <div className="step-track">
          <div className="step-bar" style={{ width: `${(sum / max) * 100}%` }} role="img"
            aria-label={`${label}: 911 center ${mmss(s.dispatch_s)}, crew ${mmss(s.turnout_s)}, drive ${mmss(s.drive_s)}`}>
            {keys.map((k) => (
              <div key={k} style={{ width: `${(s[k] / sum) * 100}%`, background: STEP_COLORS[k], color: STEP_TEXT[k] }}>{mmss(s[k])}</div>
            ))}
          </div>
        </div>
        <div className="step-total mono">{mmss(s.total_s)}</div>
      </div>
    )
  }
  return (
    <div className="stack">
      <strong className="h3">A typical call, step by step</strong>
      <div className="caption">Each call has three steps. The bar shows how long each step usually takes (median).</div>
      <div className="legend-row">
        {keys.map((k) => <span key={k}><span className="swatch" style={{ background: STEP_COLORS[k] }} />{STEP_NAMES[k]}</span>)}
      </div>
      {row('Now', steps.now)}
      {row('Baseline', steps.baseline)}
      <div className="chips">
        <span className="pill">911 center: <strong>{mmss(steps.now.dispatch_s)}</strong> (baseline {mmss(steps.baseline.dispatch_s)})</span>
        <span className="pill">Crew: <strong>{mmss(steps.now.turnout_s)}</strong> (baseline {mmss(steps.baseline.turnout_s)})</span>
        <span className="pill pill-warn">Drive: <strong>{mmss(steps.now.drive_s)}</strong> (baseline {mmss(steps.baseline.drive_s)})</span>
      </div>
    </div>
  )
}

function Causes({ d }) {
  const c = d.causes
  const max = Math.max(1, ...Object.values(c))
  const bar = (label, n, color) => (
    <div className="cause" key={label}>
      <div>{label}</div>
      <div className="cause-track"><div style={{ width: `${(n / max) * 100}%`, background: color }} /></div>
      <div className="mono"><strong>{fmtInt(n)}</strong> <span className="muted">calls</span></div>
    </div>
  )
  return (
    <div className="stack grow">
      <strong className="h3">What held up each of the {fmtInt(d.late_calls)} late calls?</strong>
      <div className="caption">Each late call is assigned to the step that was most unusual for this place.</div>
      <div className="eyebrow">The trip itself</div>
      {bar('Long trip (Google expected longer)', c.long_trip, '#B42318')}
      {bar('Drive slower than Google', c.slow_drive, '#B45309')}
      <div className="eyebrow">People on the call</div>
      {bar('911 center took longer', c.dispatch, '#4A6E99')}
      {bar('Crew took longer to roll', c.turnout, '#4A6E99')}
      {bar('No ambulance was free', c.held, '#4A6E99')}
      <div className="eyebrow">No single step stands out</div>
      {bar('Typical call is already late (long distance)', c.typical_late || 0, '#7A857E')}
    </div>
  )
}

function Worst({ d, g }) {
  const w = d.worst_call
  if (!w) return null
  const b = d.steps.baseline
  const eta = g && g.available ? g.baseline.eta_med_s : null
  const line = (label, now, normal) => (
    <div className="kv"><span>{label}</span><span className="mono">{mmss(now)}{normal != null && <span className="muted"> (normal {mmss(normal)})</span>}</span></div>
  )
  return (
    <div className="worst stack">
      <strong className="h3">Check one call: the longest wait</strong>
      <div className="small muted">{w.incident_id} &middot; {String(w.t_received).slice(0, 16).replace('T', ' ')} &middot; total {mmss(w.total_s)}</div>
      {line('911 center', w.dispatch_s, b.dispatch_s)}
      {line('Crew getting rolling', w.turnout_s, b.turnout_s)}
      {w.eta_google_s != null && line("Google's estimate for this trip", w.eta_google_s, eta)}
      <div className="kv strong"><span>Actual drive</span><span className="mono">{mmss(w.drive_s)}</span></div>
    </div>
  )
}

function GoogleBlock({ g }) {
  const maxS = Math.max(g.now.eta_med_s, g.now.drive_med_s, g.baseline.eta_med_s, g.baseline.drive_med_s, 1)
  const rowFor = (label, s) => (
    <div className="g-row" key={label}>
      <div className="strong">{label}</div>
      <div className="g-grid">
        <div>Google estimate</div>
        <div className="g-est" style={{ width: `${(s.eta_med_s / maxS) * 100}%` }} />
        <div className="mono">{mmss(s.eta_med_s)}</div>
        <div>Ambulance</div>
        <div className="g-amb" style={{ width: `${(s.drive_med_s / maxS) * 100}%` }} />
        <div className="mono strong">{mmss(s.drive_med_s)}</div>
      </div>
      <div className={s.eta_med_s >= s.drive_med_s ? 'green strong' : 'red strong'}>
        {s.eta_med_s >= s.drive_med_s ? `Beat Google by ${mmss(s.eta_med_s - s.drive_med_s)}` : `Slower than Google by ${mmss(s.drive_med_s - s.eta_med_s)}`}
      </div>
    </div>
  )
  return (
    <div className="stack grow">
      <strong className="h3">Ambulance vs Google Maps: a typical drive</strong>
      <div className="caption">When an ambulance is assigned we save Google's drive estimate for that trip, with traffic. With lights and sirens the ambulance should beat it.</div>
      {rowFor('Now', g.now)}
      {rowFor('Baseline', g.baseline)}
      <p className="note-box">Google's estimate moved from {mmss(g.baseline.eta_med_s)} to {mmss(g.now.eta_med_s)}. {fmtPct(g.pct_slower_than_google)} of drives now took longer than Google said.</p>
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
              <title>{`${mmss(e[i])} to ${mmss(e[i + 1])} vs Google: ${c} drives (${slow ? 'slower' : 'faster'})`}</title>
            </rect>
          )
        })}
      </g>
    )
  }
  const ticks = e.filter((_, i) => i % 2 === 0)
  return (
    <svg viewBox={`0 0 ${W} 290`} className="chart" role="img"
      aria-label="Two histograms of actual drive time minus Google's estimate, now and baseline. Bars left of zero mean the ambulance beat Google.">
      {panel(hist.now, 8, 'Now')}
      {panel(hist.baseline, 140, 'Baseline')}
      <line x1={x(0)} x2={x(0)} y1="20" y2="250" stroke="#17201C" strokeWidth="1.5" />
      {ticks.map((t) => (
        <text key={t} x={x(t)} y="266" fontSize="11" textAnchor="middle" fill="#56615B" fontWeight={t === 0 ? 600 : 400}>{t === 0 ? 'same as Google' : mmss(t)}</text>
      ))}
      <text x={x(e[0]) + 80} y="284" fontSize="11" fontWeight="600" fill="#1E6B3A" textAnchor="middle">&larr; faster than Google</text>
      <text x={x(e[e.length - 1]) - 80} y="284" fontSize="11" fontWeight="600" fill="#B42318" textAnchor="middle">slower than Google &rarr;</text>
    </svg>
  )
}

export default function MinutesSection({ delaysState, googleState, selectedName }) {
  return (
    <Section num={4} title={`${selectedName}: where did the extra minutes come from?`}>
      <Async state={delaysState}>
        {(d) => (
          <>
            <StepBars steps={d.steps} />
            <Messages messages={d.messages} />
          </>
        )}
      </Async>
      <Async state={googleState}>
        {(g) => (g.available ? (
          <div className="split top-rule">
            <GoogleBlock g={g} />
            <figure className="figure grow">
              <figcaption>
                <strong>Every drive compared with Google</strong>
                <span className="caption">Each bar counts drives. <strong className="green">Green, left of the line:</strong> the ambulance beat Google. <strong className="red">Red, right of the line:</strong> it took longer than Google said.</span>
              </figcaption>
              <Hist hist={g.hist} />
              <p className="small muted">A drive in the red is worth a question to the crew, not proof of a problem: detours do not always show up in Google.</p>
              <Messages messages={g.messages} />
            </figure>
          </div>
        ) : (
          // The data has no Google estimates: hide this part (only the API's notes remain).
          <Messages messages={g.messages} />
        ))}
      </Async>
      <Async state={delaysState}>
        {(d) => (
          <div className="split top-rule">
            <Causes d={d} />
            <Worst d={d} g={googleState.data} />
          </div>
        )}
      </Async>
    </Section>
  )
}
