// Top bar: brand, dataset picker, replay controls, the "simulated data" pill and the user chip.
import { fmtDate } from '../format.js'
import SirenLogo from './SirenLogo.jsx'
import badgeUrl from '../assets/team-badge.svg'
import '../topbar.css'

// What each synthetic file is about (a tooltip only). The dataset LIST comes from /api/meta; this is the fallback
// while it loads, or in an old API reply.
export const DATASET_NOTES = {
  baseline: 'normal year; rural travel gaps',
  station_closure: 'ZIP 11368 travel longer from Sep 1',
  summer_surge: 'Monroe County, Jul to Aug',
}
const FALLBACK_DATASETS = Object.keys(DATASET_NOTES)

/** Simulation / Replay controls, compact. Read-only: they only move the end date forward. */
export function ReplayControls({ replay, onStart, onToggle, onStep, onStop }) {
  if (!replay.on) {
    return <button type="button" className="tb-btn" onClick={onStart}>Start replay</button>
  }
  return (
    <div className="replay-controls" role="group" aria-label="Simulation / Replay controls">
      <span className="replay-day" title={`Period ${fmtDate(replay.start)} to ${fmtDate(replay.day)}`}>
        Replay day {fmtDate(replay.day)}, {String(replay.day).slice(0, 4)}
      </span>
      <button type="button" className="tb-btn" onClick={onToggle} aria-pressed={replay.playing}>{replay.playing ? 'Pause' : 'Play'}</button>
      <button type="button" className="tb-btn" onClick={onStep} disabled={replay.playing}>+1 day</button>
      <button type="button" className="tb-btn" onClick={onStop}>Stop</button>
    </div>
  )
}

export default function TopBar({ dataset, datasets, onDataset, replay, fixtures, replayHandlers }) {
  const note = DATASET_NOTES[dataset]
  const keys = datasets && datasets.length ? datasets : FALLBACK_DATASETS
  return (
    <header className="topbar">
      <div className="brand">
        <SirenLogo />
        <div>
          <div className="brand-name">On<span className="brand-accent">Scene</span></div>
          <div className="brand-sub">New York State · EMS response quality</div>
        </div>
      </div>
      <div className="topbar-controls">
        <label className="tb-field">
          <span>Dataset</span>
          <select className="tb-select" value={dataset} disabled={replay.on} title={note} onChange={(e) => onDataset(e.target.value)}>
            {keys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <ReplayControls replay={replay} {...replayHandlers} />
      </div>
      <div className="topbar-meta">
        <span className="sample-pill" title="SYNTHETIC DATA: invented calls on real 2020 Census geography. Not real patients, not live CAD.">
          <span className="dot" aria-hidden="true" />
          <span><span className="sr-only">SYNTHETIC DATA: </span>Simulated service data</span>
        </span>
        {/* About the data (was the page footer): same "i" button and tooltip style as the map legend */}
        <span className="legend-info data-info">
          <button type="button" className="legend-info-btn" aria-label="About the data and targets" aria-describedby="data-def">i</button>
          <span className="legend-tip tip-below" id="data-def" role="tooltip">
            Every number on this page is computed by the API (<code>/api/*</code>, read-only); the page only draws and formats it.
            {' '}Source: synthetic incidents replayed from the server. The response clock start (<code>t_received</code>) is provisional: it may be the 911 answer or the CAD record, and that is not yet confirmed.
            {' '}Targets are NFPA 1720-based placeholders, configurable and not certified standards: red 8 minutes in urban areas, 10 suburban, 14 rural and remote; yellow 15; green 30; 90% on time.
            {' '}The tool reviews the response process, not individual dispatchers or crews.
          </span>
        </span>
        {fixtures && <span className="fixture-flag" role="status">FIXTURE DATA: canned numbers, not from the API</span>}
        <div className="user">
          <img className="team-badge" src={badgeUrl} width="36" height="36" alt="Team Powerpuff Girls" />
          <div className="user-role" aria-hidden="true">Team Powerpuff Girls</div>
        </div>
      </div>
    </header>
  )
}
