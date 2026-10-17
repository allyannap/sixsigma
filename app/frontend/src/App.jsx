import { useEffect, useState } from 'react'
import { isFixtureMode } from './api.js'
import { addDays, fmtCi, fmtChanceBelow, fmtInt, fmtMin, fmtNum, fmtPct, fmtRange, fmtVolume } from './format.js'
import { QUEUE_ORDER, URGENCY, URGENCY_KEYS, attentionSplit } from './status.js'
import { useEndpoint } from './useApi.js'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import InvestigationSection, { flaggedSelection } from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import ReplayBar from './components/ReplayBar.jsx'
import { Judgments, Kpi, Messages, Section, StatusBadge } from './components/common.jsx'

const DATASETS = [
  { key: 'baseline', label: 'baseline (normal year; rural travel gaps)' },
  { key: 'station_closure', label: 'station_closure (ZIP 11368 travel longer from Sep 1)' },
  { key: 'summer_surge', label: 'summer_surge (Monroe County, Jul to Aug)' },
]
const STATE = { level: 'state', id: undefined, name: 'New York State' }
// Replay keeps the monitoring period's START (and so its baseline, the 60 days before it) fixed and moves only
// the end forward, one simulated day per tick: a rolling window would let the baseline drift into a change.
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
  const datasetLastDay = meta.data ? meta.data.date_max : '2026-10-15'
  const lastDay = to && to < datasetLastDay ? to : datasetLastDay
  const datesReady = Boolean(from && to && from <= to)
  const emptyTitle = from && to && from > to ? 'Check date range' : 'No date selected'
  const emptyHint = from && to && from > to ? 'From must be on or before To.' : !from && !to ? 'Select From and To.' : !from ? 'Select From.' : 'Select To.'

  // During replay the period runs from the fixed start to the simulated day; otherwise the date inputs.
  const winFrom = replay.on ? replay.start : from
  const winTo = replay.on ? replay.day : to
  const filters = { dataset, from: winFrom, to: winTo, urgency }
  const parentParams = { ...filters, level: parent.level, id: parent.id }
  const selParams = { ...filters, level: selected.level, id: selected.id }

  const summary = useEndpoint('summary', parentParams, { skip: !datesReady })
  const pchart = useEndpoint('pchart', selParams, { skip: !datesReady })
  // Statewide list of ZIP areas with a confirmed signal: same dates, dataset and urgency, but level and id are ignored.
  const flagged = useEndpoint('flagged', filters, { skip: !datesReady })
  const stages = useEndpoint('stages', selParams, { skip: !datesReady })
  const feed = useEndpoint('replay', { ...parentParams, day: replay.day, limit: 12 }, { skip: !replay.on || !datesReady })

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
  // A row of the statewide flagged list: the map shows the ZIP's county, and the selected place is the ZIP.
  const pickFlagged = (row) => {
    const next = flaggedSelection(row)
    setParent(next.parent)
    setSelected(next.selected)
  }
  const drill = (place) => place && setParent({ level: 'county', id: place.id, name: place.name })

  const s = datesReady ? summary.data : null
  const sel = s && s.selection
  const t = s && s.totals
  const selectedName = selected.name || 'New York State'
  const split = s ? attentionSplit(s) : null
  const unitNoun = parent.level === 'state' ? 'counties' : 'ZIP areas'

  return (
    <div className="page">
      <header className="card header">
        <div className="header-top">
          <div>
            <div className="eyebrow mono">EMS response monitor &middot; Quality supervisor view &middot; read-only</div>
            <h1>New York State EMS response quality</h1>
            <p className="lede">Find service gaps and changes in EMS response times.</p>
          </div>
          <div className="header-tags">
            <div className="synthetic-flag" role="note">SYNTHETIC DATA · Simulated calls, real NY geography.</div>
            {fixtures && <div className="fixture-flag" role="status">FIXTURE DATA · Saved examples</div>}
            <div className="pill-blue">Dataset: {dataset}{!datesReady ? ` · ${emptyTitle}` : sel ? ` · ${fmtRange(sel)}` : ` · ${from}–${to}`}</div>
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
          <span className="small muted filter-note">Choose dates and one urgency group.</span>
        </form>

        <ReplayBar disabled={!datesReady} replay={replay} feedState={feed} baselineDays={sel ? sel.baseline_days : null}
          onStart={() => { if (datesReady) setReplay({ on: true, playing: true, start: from, day: from }) }}
          onToggle={() => setReplay((r) => ({ ...r, playing: !r.playing }))}
          onStep={() => setReplay((r) => (r.day >= lastDay ? r : { ...r, day: addDays(r.day, 1) }))}
          onStop={() => setReplay({ on: false, playing: false, start: '', day: '' })} />

        {!datesReady ? <div className="date-empty" role="status"><strong>{emptyTitle}</strong><p>{emptyHint}</p></div> : summary.error ? (
          <div className="error" role="alert">
            <p><strong>The numbers are not available yet.</strong> {summary.error}</p>
            <button type="button" className="btn" onClick={summary.reload}>Try again</button>
          </div>
        ) : (
          <>
            <div className="kpis" aria-busy={summary.loading}>
              <Kpi label="Areas needing review"
                sub={split ? <>
                  <span>{split.recent} with a recent signal (Act now + Recent change) &middot; {split.ongoing} ongoing gaps</span>
                  {fmtChanceBelow(s.chance_below, unitNoun) && <span className="kpi-chance"> {fmtChanceBelow(s.chance_below, unitNoun)}</span>}
                </> : ''}>
                {split ? <>{split.total} <small>of {(s.places || []).length}</small></> : '...'}
              </Kpi>
              <Kpi label={`On time: ${sel ? sel.name : ''}`} sub={t ? `${fmtInt(t.on_time)} of ${fmtInt(t.valid)} valid calls · 95% CI ${fmtCi(t.on_time_ci, '%')} · goal ${fmtPct(t.goal_pct, 0)}` : ''}>{t ? fmtPct(t.on_time_pct) : '...'}</Kpi>
              <Kpi label="Median wait (call received to on scene)" sub={t ? `95% CI ${fmtCi(t.median_ci)} min` : ''}>{t ? fmtMin(t.median_min) : '...'}</Kpi>
              <Kpi label="P95 wait (1 call in 20 waited longer)" sub={t ? `95% CI ${fmtCi(t.p95_ci)} min · P90 ${fmtMin(t.p90_min)}` : ''}>{t ? fmtMin(t.p95_min) : '...'}</Kpi>
              <Kpi label="Very late (over 2x the target)"
                sub={t ? <>
                  <span>of {fmtInt(t.valid)} valid calls. Left out: {fmtInt(t.cancelled)} cancelled ({fmtPct(t.cancel_pct)}), {fmtInt(t.invalid)} invalid.</span>
                  <span className="kpi-chance"> {fmtVolume(t.calls_per_day, t.base_calls_per_day)}. Late calls beyond the goal's allowance: {fmtNum(t.excess_late, 1)}.</span>
                </> : ''}>
                {t ? fmtInt(t.very_late) : '...'}
              </Kpi>
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

      {datesReady ? <>
      <MapSection summaryState={summary} parent={parent} urgency={urgency} selected={selected}
        onPick={pick} onDrill={drill} onBack={resetScope} />
      <ChangeSection pState={pchart} stagesState={stages} params={selParams} selectedName={selectedName} />
      <InvestigationSection summaryState={summary} flaggedState={flagged} onPick={pick} onPickFlagged={pickFlagged} />
      <AnomSection summaryState={summary} />
      </> : [
        ['Which areas need review?', 'section-1'],
        ['Are more calls missing their response target?', 'section-2'],
        ['Investigation list', 'section-3'],
        ['Are calls arriving on time?', 'section-4'],
      ].map(([title, id], index) => <Section key={id} num={index + 1} id={id} title={title}><p className="date-section-empty">{emptyTitle}</p></Section>)}

      <footer className="small muted">
        Synthetic data. Response clock (<code>t_received</code>) is provisional: 911 answer vs CAD creation.
        {' '}NFPA 1720-based targets are configurable placeholders, not certified standards. Process review only.
      </footer>
    </div>
  )
}
