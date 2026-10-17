import { useEffect, useMemo, useState } from 'react'
import { isFixtureMode } from './api.js'
import { addDays } from './format.js'
import { useEndpoint } from './useApi.js'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import InvestigationSection, { flaggedSelection } from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import { InsightsSection, MetricsSection } from './components/MetricsSection.jsx'
import PlaceHead from './components/PlaceHead.jsx'
import ReplayBar from './components/ReplayBar.jsx'
import TopBar from './components/TopBar.jsx'
import { LoadingBar } from './components/common.jsx'

const STATE = { level: 'state', id: undefined, name: 'New York State' }
// Replay keeps the monitoring period's START (and so its baseline, the 60 days before it) fixed and moves only
// the end forward, one simulated day per tick: a rolling window would let the baseline drift into a change.
// Default start per dataset: a week before its planted change, with a clean baseline behind it.
const REPLAY_START = { baseline: '2026-08-25', station_closure: '2026-08-25', summer_surge: '2026-06-25' }
const TICK_MS = 3000

export default function App() {
  const fixtures = isFixtureMode()
  const [mobileView, setMobileView] = useState('overview')
  const [dataset, setDataset] = useState('baseline')
  const [urgency, setUrgency] = useState(['red'])
  const [from, setFrom] = useState('') // applied by Search; blank still means the API's default last 90 days
  const [to, setTo] = useState('')
  // parent = what the map draws children of (state -> counties, county -> its ZIP areas).
  // selected = the place the right column and the two chart cards describe.
  const [parent, setParent] = useState(STATE)
  const [selected, setSelected] = useState({ ...STATE, place: null })
  const [replay, setReplay] = useState({ on: false, playing: false, start: '', day: '' })

  const meta = useEndpoint('meta', {})
  const lastDay = meta.data ? meta.data.date_max : '2026-10-15'

  // During replay the period runs from the fixed start to the simulated day; otherwise the date inputs.
  const winFrom = replay.on ? replay.start : from
  const winTo = replay.on ? replay.day : to
  // The page loads that default window before the user picks dates, so show it in the boxes.
  const shownFrom = winFrom || (meta.data && meta.data.default_from) || ''
  const shownTo = winTo || (meta.data && meta.data.default_to) || ''
  const filters = { dataset, from: winFrom, to: winTo, urgency }
  const parentParams = { ...filters, level: parent.level, id: parent.id }
  const selParams = { ...filters, level: selected.level, id: selected.id }

  const summary = useEndpoint('summary', parentParams)
  const pchart = useEndpoint('pchart', selParams)
  const imr = useEndpoint('imr', selParams)
  // Statewide list of ZIP areas with a confirmed signal: same dates, dataset and urgency, but level and id are ignored.
  const flagged = useEndpoint('flagged', filters)
  const stages = useEndpoint('stages', selParams)
  const aiEnabled = Boolean(winFrom && winTo && winFrom <= winTo)
  const aiSummary = useEndpoint('ai_summary', selParams, {
    delay: 600, skip: !aiEnabled || fixtures || replay.playing,
  })
  const feed = useEndpoint('replay', { ...parentParams, day: replay.day, limit: 12 }, { skip: !replay.on })

  useEffect(() => {
    if (!replay.on || !replay.playing) return undefined
    const timer = setTimeout(() => {
      setReplay((r) => (r.day >= lastDay ? { ...r, playing: false } : { ...r, day: addDays(r.day, 1) }))
    }, TICK_MS)
    return () => clearTimeout(timer)
  }, [replay, lastDay])

  const toggleUrgency = (key) => {
    setUrgency([key])
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

  // Search box: a county opens its ZIP areas; a ZIP area shows its county on the map and is selected.
  const countyOptions = useMemo(
    () => ((meta.data && meta.data.counties) || []).map((c) => ({
      level: 'county', id: c.county_fips, name: c.county_name, sub: 'County · opens its ZIP areas',
    })),
    [meta.data],
  )
  const searchPick = (o) => {
    if (o.level === 'county') {
      setParent({ level: 'county', id: o.id, name: o.name })
      setSelected({ level: 'county', id: o.id, name: o.name, place: null })
    } else {
      const county = countyOptions.find((c) => c.id === o.countyId)
      if (o.countyId && o.countyId !== parent.id) setParent({ level: 'county', id: o.countyId, name: county ? county.name : '' })
      setSelected({ level: 'zcta', id: o.id, name: o.name, place: null })
    }
  }

  const replayHandlers = {
    onStart: () => { const start = from || REPLAY_START[dataset]; setReplay({ on: true, playing: true, start, day: start }) },
    onToggle: () => setReplay((r) => ({ ...r, playing: !r.playing })),
    onStep: () => setReplay((r) => (r.day >= lastDay ? r : { ...r, day: addDays(r.day, 1) })),
    onStop: () => setReplay({ on: false, playing: false, start: '', day: '' }),
  }

  const s = summary.data
  const sel = s && s.selection
  const selectedName = selected.name || 'New York State'

  return (
    <div className="shell">
      <TopBar dataset={dataset} datasets={meta.data && meta.data.datasets} onDataset={(d) => { setDataset(d); resetScope() }}
        replay={replay} fixtures={fixtures} replayHandlers={replayHandlers} />
      <LoadingBar active={[meta, summary, pchart, imr, flagged, stages].some((x) => x.loading)} />
      <div className="app">
        <main className="workspace">
          <div className="left-col">
            <MapSection summaryState={summary} parent={parent} selected={selected} countyOptions={countyOptions}
              onPick={pick} onReset={resetScope} onSearch={searchPick} />
          </div>
          <div className={`right-col mobile-${mobileView}`}>
            <PlaceHead summaryState={summary} selected={selected} parent={parent} from={shownFrom} to={shownTo} replayOn={replay.on}
              dateMin={meta.data ? meta.data.date_min : undefined} dateMax={meta.data ? meta.data.date_max : undefined}
              onApply={(a, b) => { setFrom(a); setTo(b) }} onDrill={drill} />
            <div className="mobile-view-switch" role="group" aria-label="Dashboard view">
              <button type="button" aria-pressed={mobileView === 'overview'} onClick={() => setMobileView('overview')}>Overview</button>
              <button type="button" aria-pressed={mobileView === 'charts'} onClick={() => setMobileView('charts')}>Charts</button>
            </div>
            <MetricsSection summaryState={summary} selected={selected} parent={parent} urgency={urgency}
              onToggleUrgency={toggleUrgency} selection={sel} dataset={dataset}
              aiState={aiSummary} aiEnabled={aiEnabled} aiPaused={replay.playing} fixtures={fixtures} />
            <InsightsSection placeName={selectedName} selection={sel} dataset={dataset}>
              <AnomSection summaryState={summary} />
              <ChangeSection pState={pchart} imrState={imr} stagesState={stages} params={selParams} selectedName={selectedName} />
            </InsightsSection>
          </div>
        </main>

        <div className="below">
          <ReplayBar replay={replay} feedState={feed} baselineDays={sel ? sel.baseline_days : null} />
          <InvestigationSection summaryState={summary} flaggedState={flagged} onPick={pick} onPickFlagged={pickFlagged} />

          <footer className="small muted">
            Every number on this page is computed by the API (<code>/api/*</code>, read-only); the page only draws and formats it.
            {' '}Source: synthetic incidents replayed from the server. The response clock start (<code>t_received</code>) is provisional: it may be the 911 answer or the CAD record, and that is not yet confirmed.
            {' '}Targets are NFPA 1720-based placeholders, configurable and not certified standards: red 8 minutes in urban areas, 10 suburban, 14 rural and remote; yellow 15; green 30; 90% on time.
            {' '}The tool reviews the response process, not individual dispatchers or crews.
          </footer>
        </div>
      </div>
    </div>
  )
}
