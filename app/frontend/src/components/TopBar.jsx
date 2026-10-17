// Top bar: brand, dataset picker, replay controls, the "How it works" guide button (the guide says the data is
// simulated) and the user chip.
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

export default function TopBar({ dataset, datasets, onDataset, replay, fixtures, replayHandlers, onHelp }) {
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
        {/* Target, goal, map colours and the data caveats live in the guide (HowItWorks.jsx) */}
        {onHelp && <button type="button" className="tb-btn tb-help" aria-haspopup="dialog" onClick={onHelp}>How it works</button>}
        {fixtures && <span className="fixture-flag" role="status">FIXTURE DATA: canned numbers, not from the API</span>}
        <div className="user">
          <img className="team-badge" src={badgeUrl} width="36" height="36" alt="Team Powerpuff Girls" />
          <div className="user-role" aria-hidden="true">Team Powerpuff Girls</div>
        </div>
      </div>
    </header>
  )
}
