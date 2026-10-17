import { useState } from 'react'
import { isFixtureMode } from './api.js'
import { fmtInt, fmtMin, fmtNum, fmtPct, fmtRange } from './format.js'
import { URGENCY, URGENCY_KEYS, attentionCount } from './status.js'
import { useEndpoint } from './useApi.js'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import FixSection from './components/FixSection.jsx'
import MapSection from './components/MapSection.jsx'
import MinutesSection from './components/MinutesSection.jsx'
import { Kpi, Messages } from './components/common.jsx'

const DATASETS = [
  { key: 'baseline', label: 'baseline (yearly pattern only)' },
  { key: 'station_closure', label: 'station_closure (a ZIP slows from Sep 1)' },
  { key: 'summer_surge', label: 'summer_surge (one county, Jul to Aug)' },
]
const STATE = { level: 'state', id: undefined, name: 'New York State' }

export default function App() {
  const fixtures = isFixtureMode()
  const [dataset, setDataset] = useState('baseline')
  const [urgency, setUrgency] = useState(['red'])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  // parent = what the map draws children of (state -> counties, county -> its ZIP areas).
  // selected = the place sections 3 to 5 describe.
  const [parent, setParent] = useState(STATE)
  const [selected, setSelected] = useState({ ...STATE, place: null })
  const [fix, setFix] = useState('closer')
  const [pct, setPct] = useState(25)

  const filters = { dataset, from, to, urgency }
  const parentParams = { ...filters, level: parent.level, id: parent.id }
  const selParams = { ...filters, level: selected.level, id: selected.id }

  const summary = useEndpoint('summary', parentParams)
  const anom = useEndpoint('anom', parentParams)
  const pchart = useEndpoint('pchart', selParams)
  const imr = useEndpoint('imr', selParams)
  const delays = useEndpoint('delays', selParams)
  const google = useEndpoint('google', selParams)
  const whatif = useEndpoint('whatif', { ...selParams, fix, pct }, { delay: 250 })

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
            <div className="eyebrow mono">EMS response monitor &middot; Quality supervisor view</div>
            <h1>Statistical analysis</h1>
            <p className="lede">
              Read top to bottom: <strong>1</strong> which places need attention, <strong>2</strong> which are consistently slower (for planners),
              <strong> 3</strong> whether the problem is real, <strong>4</strong> where the extra minutes come from, <strong>5</strong> which fix would help most.
            </p>
          </div>
          <div className="header-tags">
            {fixtures && <div className="fixture-flag" role="status">FIXTURE DATA: invented numbers, not from the API</div>}
            <div className="pill-blue">Dataset: {dataset}{sel ? ` · ${fmtRange(sel)}` : ''}</div>
          </div>
        </div>

        <form className="filters" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
          <label>Dataset
            <select value={dataset} onChange={(e) => { setDataset(e.target.value); resetScope() }}>
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
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <span className="small muted filter-note">Blank dates = the dataset's last 30 days.</span>
        </form>

        {summary.error ? (
          <div className="error" role="alert">
            <p><strong>The numbers are not available yet.</strong> {summary.error}</p>
            <button type="button" className="btn" onClick={summary.reload}>Try again</button>
          </div>
        ) : (
          <div className="kpis" aria-busy={summary.loading}>
            <Kpi label="Places needing attention" sub={s ? sel.name : ''}>{s ? <>{attentionCount(s)} <small>of {(s.places || []).length}</small></> : '...'}</Kpi>
            <Kpi label="Urgent calls in range">{t ? fmtInt(t.calls) : '...'}</Kpi>
            <Kpi label="Arrived after the target">{t ? <>{fmtInt(t.late)} <small>&middot; {fmtPct(t.pct_late)}</small></> : '...'}</Kpi>
            <Kpi label="Longest waits (P95)" sub={t && t.p95_ci ? `95% CI ${fmtNum(t.p95_ci[0])} to ${fmtNum(t.p95_ci[1])} min` : ''}>{t ? fmtMin(t.p95_min) : '...'}</Kpi>
            <Kpi label="Median wait / median dispatch to scene">{t ? <>{fmtMin(t.median_min)} <small>/ {fmtMin(t.median_dispatch_to_scene_min)}</small></> : '...'}</Kpi>
          </div>
        )}
        {s && <Messages messages={s.messages} />}
      </header>

      <MapSection summaryState={summary} parent={parent} urgency={urgency} selected={selected}
        onPick={pick} onDrill={drill} onBack={resetScope} />
      <AnomSection anomState={anom} />
      <ChangeSection pState={pchart} imrState={imr} selectedName={selectedName} />
      <MinutesSection delaysState={delays} googleState={google} selectedName={selectedName} />
      <FixSection whatifState={whatif} fix={fix} pct={pct} onFix={setFix} onPct={setPct} selectedName={selectedName} />

      <footer className="small muted">
        Every number on this page is computed by the API (<code>/api/*</code>); the page only draws and formats it.
      </footer>
    </div>
  )
}
