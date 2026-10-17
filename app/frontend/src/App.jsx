import { useCallback, useEffect, useMemo, useState } from 'react'
import { isFixtureMode } from './api.js'
import { addDays } from './format.js'
import { useEndpoint } from './useApi.js'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import MapSection from './components/MapSection.jsx'
import { investigationRows } from './components/InvestigationSection.jsx'
import { InsightsSection, MetricsSection } from './components/MetricsSection.jsx'
import PlaceHead from './components/PlaceHead.jsx'
import ReplayBar from './components/ReplayBar.jsx'
import TopBar from './components/TopBar.jsx'
import InvestigateRail from './components/InvestigateRail.jsx'
import { LoadingBar } from './components/common.jsx'

const STATE = { level: 'state', id: undefined, name: 'New York State' }
// Replay keeps the monitoring period's START (and so its baseline, the 60 days before it) fixed and moves only
// the end forward, one simulated day per tick: a rolling window would let the baseline drift into a change.
// Default start per dataset: a week before its planted change, with a clean baseline behind it.
const REPLAY_START = { baseline: '2026-08-25', station_closure: '2026-08-25', summer_surge: '2026-06-25' }
const TICK_MS = 3000

export default function App() {
  const fixtures = isFixtureMode()
  const [dataset, setDataset] = useState('baseline')
  const [priority, setPriority] = useState('red')
  const urgency = [priority] // The API accepts a list; the dashboard permits exactly one priority.
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
  const stages = useEndpoint('stages', selParams)
  // Match the dates displayed in the form, including its initial dataset default window.
  const aiEnabled = Boolean(shownFrom && shownTo && shownFrom <= shownTo)
  const aiSummary = useEndpoint('ai_summary', { ...selParams, from: shownFrom, to: shownTo }, {
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
    setPriority(key)
  }
  const resetScope = () => { setParent(STATE); setSelected({ ...STATE, place: null }) }

  // Map click (drill = true) opens a county's ZIP areas; table click only selects.
  // The Investigate sidebar (closed by default; the button in the top bar opens it).
  const [railOpen, setRailOpen] = useState(false)
  const closeRail = useCallback(() => setRailOpen(false), [])

  const pick = (place, drill) => {
    const level = parent.level === 'state' ? 'county' : 'zcta'
    setSelected({ level, id: place.id, name: place.name, place })
    if (drill && level === 'county') setParent({ level: 'county', id: place.id, name: place.name })
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
      <LoadingBar active={[meta, summary, pchart, imr, stages].some((x) => x.loading)} />
      <div className="app">
        <main className={`workspace${railOpen ? ' has-rail' : ''}`}>
          <InvestigateRail open={railOpen} onClose={closeRail} summaryState={summary} parent={parent} selected={selected} onPick={pick} />
          <div className="left-col">
            <MapSection summaryState={summary} parent={parent} selected={selected} countyOptions={countyOptions}
              onPick={pick} onReset={resetScope} onSearch={searchPick}
              railOpen={railOpen} onRail={() => setRailOpen((o) => !o)} reviewCount={summary.data ? investigationRows(summary.data.places || []).length : null} />
          </div>
          {/* Slides out to the right while the Investigate list is open; inert then, so Tab skips it. */}
          <div className="right-col" inert={railOpen ? '' : undefined} aria-hidden={railOpen || undefined}>
            <PlaceHead summaryState={summary} selected={selected} parent={parent} from={shownFrom} to={shownTo} replayOn={replay.on}
              dateMin={meta.data ? meta.data.earliest_from || meta.data.date_min : undefined} dateMax={meta.data ? meta.data.date_max : undefined}
              onApply={(a, b) => { setFrom(a); setTo(b) }} onDrill={drill} />
            <MetricsSection summaryState={summary} selected={selected} parent={parent} urgency={urgency}
              onToggleUrgency={toggleUrgency} aiState={aiSummary} aiEnabled={aiEnabled}
              aiPaused={replay.playing} fixtures={fixtures} />
            <InsightsSection placeName={selectedName}>
              <AnomSection summaryState={summary} selected={selected} onPick={pick} />
              <ChangeSection pState={pchart} imrState={imr} stagesState={stages} params={selParams} selectedName={selectedName} />
            </InsightsSection>
          </div>
        </main>

        <div className="below">
          <ReplayBar replay={replay} feedState={feed} baselineDays={sel ? sel.baseline_days : null} />

        </div>
      </div>
    </div>
  )
}
