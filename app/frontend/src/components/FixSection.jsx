import { fmtInt, fmtMin, fmtPct } from '../format.js'
import { Async, Messages, Section } from './common.jsx'

export const FIXES = [
  { key: 'closer', label: 'Post an ambulance closer', hint: "Brings Google's trip estimates back toward the baseline (for example, by posting an ambulance in the area again).", slider: false },
  { key: 'add_ambulance', label: 'Add an ambulance', hint: 'Removes the waits when no ambulance was free.', slider: false },
  { key: 'center_faster', label: 'Speed up the 911 center', hint: 'Shortens the call-answered to assigned step.', slider: true },
  { key: 'crew_faster', label: 'Speed up the crew', hint: 'Shortens the assigned to rolling step.', slider: true },
]

export default function FixSection({ whatifState, fix, pct, onFix, onPct, selectedName }) {
  const current = FIXES.find((f) => f.key === fix) || FIXES[0]
  return (
    <Section num={5} title={`${selectedName}: which fix would help most?`}
      intro="Pick a fix. We replay the selected calls with that change and count how many would still be late.">
      <div className="split">
        <div className="stack grow">
          <div className="eyebrow" id="fix-label">Fix to try</div>
          <div className="chips" role="group" aria-labelledby="fix-label">
            {FIXES.map((f) => (
              <button key={f.key} type="button" className={`btn${f.key === fix ? ' btn-on' : ''}`} aria-pressed={f.key === fix} onClick={() => onFix(f.key)}>{f.label}</button>
            ))}
          </div>
          <p className="note-box">{current.hint}</p>
          {current.slider && (
            <label className="slider">
              <span className="eyebrow">Make that step faster by {pct}%</span>
              <input type="range" min="5" max="50" step="5" value={pct} onChange={(e) => onPct(Number(e.target.value))} />
            </label>
          )}
        </div>
        <div className="stack grow2">
          <Async state={whatifState}>
            {(w) => {
              const top = Math.max(w.now.pct_late, w.with_fix.pct_late, 1)
              return (
                <>
                  <div className="kpis">
                    <div className="kpi"><div className="kpi-label">Late calls</div><div className="kpi-value">{fmtInt(w.with_fix.late)}</div><div className="kpi-sub">{fmtPct(w.with_fix.pct_late)}, now {fmtInt(w.now.late)} ({fmtPct(w.now.pct_late)})</div></div>
                    <div className="kpi"><div className="kpi-label">Longest waits (P95)</div><div className="kpi-value">{fmtMin(w.with_fix.p95_min)}</div><div className="kpi-sub">now {fmtMin(w.now.p95_min)}</div></div>
                    <div className="kpi"><div className="kpi-label">Late calls avoided</div><div className="kpi-value">{fmtInt(w.avoided)}</div><div className="kpi-sub">of {fmtInt(w.n)} calls replayed</div></div>
                  </div>
                  <div className="bars2">
                    {[['Now', w.now.pct_late, '#B42318'], ['With fix', w.with_fix.pct_late, '#1E6B3A']].map(([label, v, c]) => (
                      <div key={label} className="bar2"><div className="muted">{label}</div>
                        <div className="bar2-track" role="img" aria-label={`${label}: ${fmtPct(v)} late`}><div style={{ width: `${(v / top) * 100}%`, background: c }} /></div>
                        <div className="mono">{fmtPct(v)}</div></div>
                    ))}
                  </div>
                  <Messages messages={w.messages} />
                </>
              )
            }}
          </Async>
        </div>
      </div>
      <p className="small muted">Scenario estimate, not a prediction. It assumes everything else about each call stays the same.</p>
    </Section>
  )
}
