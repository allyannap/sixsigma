import { fmtDate, fmtInt, mmss } from '../format.js'
import { Async } from './common.jsx'

/**
 * Simulation / Replay (baselineDays comes from the API: 60, or 120 when volume is low): plays the backend's synthetic file forward one simulated day per tick.
 * Read-only: it only moves the date window and shows the calls the file already holds for that day.
 */
export default function ReplayBar({ replay, feedState, baselineDays, onStart, onToggle, onStep, onStop }) {
  return (
    <div className="replay" role="region" aria-label="Simulation / Replay">
      <div className="replay-head">
        <span className="replay-tag">Simulation / Replay</span>
        <span className="small">Synthetic data played back from the server, one simulated day per tick. Not live CAD or FDNY data; nothing can be entered or edited.</span>
      </div>
      {!replay.on ? (
        <button type="button" className="btn" onClick={onStart}>Start replay</button>
      ) : (
        <>
          <div className="chips">
            <button type="button" className="btn" onClick={onToggle} aria-pressed={replay.playing}>{replay.playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="btn" onClick={onStep} disabled={replay.playing}>+1 day</button>
            <button type="button" className="btn" onClick={onStop}>Stop replay</button>
            <span className="pill-blue">Simulated day: {fmtDate(replay.day)}, {String(replay.day).slice(0, 4)} &middot; period {fmtDate(replay.start)} to {fmtDate(replay.day)}; baseline fixed: {baselineDays ? `the ${baselineDays} days` : 'the days'} before {fmtDate(replay.start)}</span>
          </div>
          <Async state={feedState}>
            {(f) => (
              <div className="table-scroll">
                <table className="places compact">
                  <caption className="small muted">
                    {fmtInt(f.received)} calls received on {fmtDate(f.day)} in this area ({fmtInt(f.valid)} valid, {fmtInt(f.late)} late, {fmtInt(f.cancelled)} cancelled). Newest first. Source: {f.source}.
                  </caption>
                  <thead><tr><th scope="col">Received</th><th scope="col">Call</th><th scope="col">ZIP area</th><th scope="col">Urgency</th><th scope="col">Total wait</th><th scope="col">Late?</th></tr></thead>
                  <tbody>
                    {(f.events || []).map((e) => (
                      <tr key={e.incident_id}>
                        <td className="mono">{String(e.t_received).slice(11, 19)}</td>
                        <td className="mono">{e.incident_id}</td>
                        <td className="mono">{e.zcta} <span className="muted">{e.county}</span></td>
                        <td>{e.urgency_group}</td>
                        <td className="mono">{e.valid ? mmss(e.total_s) : <span className="muted">{e.disposition === 'CANCELLED' ? 'cancelled' : 'not valid'}</span>}</td>
                        <td>{e.valid ? (e.late ? 'late' : 'on time') : ''}{e.held ? ' (held)' : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
        </>
      )}
    </div>
  )
}
