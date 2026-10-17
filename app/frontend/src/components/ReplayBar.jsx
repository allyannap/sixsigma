import { fmtDate, fmtInt, mmss } from '../format.js'
import { Async } from './common.jsx'

/**
 * Simulation / Replay feed (baselineDays comes from the API: 60, or 120 when volume is low). The controls (start, play,
 * +1 day, stop) are in the top bar; this card shows only while the replay is on, with the calls the file already holds
 * for the simulated day. Read-only.
 */
export default function ReplayBar({ replay, feedState, baselineDays }) {
  if (!replay.on) return null
  return (
    <div className="card section-card replay" role="region" aria-label="Simulation / Replay">
      <div className="replay-head">
        <span className="replay-tag">Simulation / Replay</span>
        <span className="small">Synthetic data played back from the server, one simulated day per tick. Not live CAD or FDNY data; nothing can be entered or edited.</span>
      </div>
      <div className="chips">
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
    </div>
  )
}
