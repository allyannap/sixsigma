import { useEffect, useState } from 'react'
import { isFixtureMode } from './api.js'
import { addDays, fmtCi, fmtInt, fmtMin, fmtPct, fmtRange } from './format.js'
import { QUEUE_ORDER, URGENCY, URGENCY_KEYS, attentionCount } from './status.js'
import { useEndpoint } from './useApi.js'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import InvestigationSection from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import ReplayBar from './components/ReplayBar.jsx'
import { Judgments, Kpi, Messages, StatusBadge } from './components/common.jsx'

const DATASETS = [
  { key: 'baseline', label: 'baseline (normal year; rural travel gaps)' },
  { key: 'station_closure', label: 'station_closure (ZIP 11368 travel longer from Sep 1)' },
  { key: 'summer_surge', label: 'summer_surge (Monroe County, Jul to Aug)' },
]
const STATE = { level: 'state', id: undefined, name: 'New York State' }
// Replay keeps the monitoring period's START (and so its baseline, the 60 days before it) fixed and moves only
// the end forward, one simulated day per tick: a rolling window would let the baseline drift into a change.
// Default start per dataset: a week before its planted change, with a clean baseline behind it.
const REPLAY_START = { baseline: '2026-08-25', station_closure: '2026-08-25', summer_surge: '2026-06-25' }
const TICK_MS = 3000

export default function App() {
  const fixtures = isFixtureMode()
  const [dataset, setDataset] = useState('baseline')
  const [urgency, setUrgency] = useState(['red'])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // parent = what the map draws children of (state -> counties, county -> its ZIP areas).
  // selected = the place section 2 describes.
  const [parent, setParent] = useState(STATE)
  const [selected, setSelected] = useState({ ...STATE, place: null })
  const [replay, setReplay] = useState({ on: false, playing: false, start: '', day: '' })

  const meta = useEndpoint('meta', {})
  const lastDay = meta.data ? meta.data.date_max : '2026-10-15'

  // During replay the period runs from the fixed start to the simulated day; otherwise the date inputs.
  const winFrom = replay.on ? replay.start : from
  const winTo = replay.on ? replay.day : to
  const filters = { dataset, from: winFrom, to: winTo, urgency }
  const parentParams = { ...filters, level: parent.level, id: parent.id }
  const selParams = { ...filters, level: selected.level, id: selected.id }

  const summary = useEndpoint('summary', parentParams)
  const pchart = useEndpoint('pchart', selParams)
  const imr = useEndpoint('imr', selParams)
  const feed = useEndpoint('replay', { ...parentParams, day: replay.day, limit: 12 }, { skip: !replay.on })

  useEffect(() => {
    if (!replay.on || !replay.playing) return undefined
    const timer = setTimeout(() => {
      setReplay((r) => (r.day >= lastDay ? { ...r, playing: false } : { ...r, day: addDays(r.day, 1) }))
    }, TICK_MS)
    return () => clearTimeout(timer)
  }, [replay, lastDay])

  const toggleUrgency = (key) => {
    const next = urgency.includes(key) ? urgency.filter((k) => k !== key) : [...urgency, key]
    if (next.length) setUrgency(URGENCY_KEYS.filter((k) => next.includes(k)))
  }
  const resetScope = () => { setParent(STATE); setSelected({ ...STATE, place: null }) }

  // Map click (drill = true) opens a county's ZIP areas; table click only selects.
  const pick = (place, drill) => {
    const level = parent.level === 'state' ? 'county' : 'zcta'
    setSelected({ level, id: place.id, name: place.name, place })
    if (drill && level === 'county') setParent({ level: 'county', id: place.id, name: place.name })
  }
  const drill = (place) => place && setParent({ level: 'county', id: place.id, name: place.name })

  const s = summary.data
  const sel = s && s.selection
  const t = s && s.totals
  const selectedName = selected.name || 'New York State'

  return (
    <div className="page">
      <header className="card header">
        <div className="header-top">
          <div>
            <div className="eyebrow mono">EMS response monitor &middot; Quality supervisor view &middot; read-only</div>
            <h1>New York State EMS response quality</h1>
            <p className="lede">
              <strong>1</strong> which areas need review, and whether they miss the on-time goal, show a recent change, or both;
              {' '}<strong>2</strong> the control chart behind a change; <strong>3</strong> the investigation list;
              {' '}<strong>4</strong> a descriptive comparison between places.
            </p>
          </div>
          <div className="header-tags">
            <div className="synthetic-flag" role="note">SYNTHETIC DATA: invented calls on real 2020 Census geography. Not real patients, not live CAD.</div>
            {fixtures && <div className="fixture-flag" role="status">FIXTURE DATA: canned numbers, not from the API</div>}
            <div className="pill-blue">Dataset: {dataset}{sel ? ` · ${fmtRange(sel)}` : ''}</div>
          </div>
        </div>

        <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
          <label>Dataset
            <select value={dataset} disabled={replay.on} onChange={(e) => { setDataset(e.target.value); resetScope() }}>
              {DATASETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <fieldset>
            <legend>Urgency</legend>
            <div className="chips">
              {URGENCY_KEYS.map((k) => (
                <button key={k} type="button" className={`chip-btn${urgency.includes(k) ? ' on' : ''}`} aria-pressed={urgency.includes(k)}
                  style={urgency.includes(k) ? { background: URGENCY[k].chip, color: '#fff', borderColor: URGENCY[k].chip } : undefined}
                  onClick={() => toggleUrgency(k)}>
                  <span aria-hidden="true">{urgency.includes(k) ? '✓ ' : ''}</span>{URGENCY[k].label}
                </button>
              ))}
            </div>
          </fieldset>
          <label>From
            <input type="date" value={from} disabled={replay.on} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>To
            <input type="date" value={to} disabled={replay.on} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="small muted filter-note">Blank dates = the dataset's last 90 days. Replay starts at From (or a week before the dataset's planted change). Pick one urgency group for the control chart. No time-of-day filter or adjustment.</span>
        </form>

        <ReplayBar replay={replay} feedState={feed}
          onStart={() => { const start = from || REPLAY_START[dataset]; setReplay({ on: true, playing: true, start, day: start }) }}
          onToggle={() => setReplay((r) => ({ ...r, playing: !r.playing }))}
          onStep={() => setReplay((r) => (r.day >= lastDay ? r : { ...r, day: addDays(r.day, 1) }))}
          onStop={() => setReplay({ on: false, playing: false, start: '', day: '' })} />

        {summary.error ? (
          <div className="error" role="alert">
            <p><strong>The numbers are not available yet.</strong> {summary.error}</p>
            <button type="button" className="btn" onClick={summary.reload}>Try again</button>
          </div>
        ) : (
          <>
            <div className="kpis" aria-busy={summary.loading}>
              <Kpi label="Areas needing review" sub={s ? `${sel.name}: act now, ongoing gap or recent change` : ''}>{s ? <>{attentionCount(s)} <small>of {(s.places || []).length}</small></> : '...'}</Kpi>
              <Kpi label={`On time: ${sel ? sel.name : ''}`} sub={t ? `${fmtInt(t.on_time)} of ${fmtInt(t.valid)} valid calls · 95% CI ${fmtCi(t.on_time_ci, '%')} · goal ${fmtPct(t.goal_pct, 0)}` : ''}>{t ? fmtPct(t.on_time_pct) : '...'}</Kpi>
              <Kpi label="Median wait (call received to on scene)" sub={t ? `95% CI ${fmtCi(t.median_ci)} min` : ''}>{t ? fmtMin(t.median_min) : '...'}</Kpi>
              <Kpi label="P95 wait (1 call in 20 waited longer)" sub={t ? `95% CI ${fmtCi(t.p95_ci)} min · P90 ${fmtMin(t.p90_min)}` : ''}>{t ? fmtMin(t.p95_min) : '...'}</Kpi>
              <Kpi label="Very late (over 2x the target)" sub={t ? `of ${fmtInt(t.valid)} valid; ${fmtInt(t.calls - t.valid)} cancelled or invalid calls left out` : ''}>{t ? fmtInt(t.very_late) : '...'}</Kpi>
            </div>
            {s && s.place && (
              <div className="queue-row" aria-label="Areas by decision status">
                <span className="small"><strong>{sel.name} itself:</strong></span> <StatusBadge status={s.place.queue} short /> <Judgments p={s.place} />
                <span className="queue-counts">
                  {QUEUE_ORDER.map((k) => <span key={k} className="small"><StatusBadge status={k} short /> {s.queue_counts ? s.queue_counts[k] : 0}</span>)}
                </span>
              </div>
            )}
          </>
        )}
        {s && <Messages messages={s.messages} />}
      </header>

      <MapSection summaryState={summary} parent={parent} urgency={urgency} selected={selected}
        onPick={pick} onDrill={drill} onBack={resetScope} />
      <ChangeSection pState={pchart} imrState={imr} selectedName={selectedName} />
      <InvestigationSection summaryState={summary} onPick={pick} />
      <AnomSection summaryState={summary} />

      <footer className="small muted">
        Every number on this page is computed by the API (<code>/api/*</code>, read-only); the page only draws and formats it.
        {' '}Source: synthetic incidents replayed from the server. Targets (red 8, yellow 15, green 30 minutes; 90% on time) are configurable placeholders, not certified standards.
        {' '}The tool reviews the response process, not individual dispatchers or crews.
      </footer>
    </div>
  )
}
