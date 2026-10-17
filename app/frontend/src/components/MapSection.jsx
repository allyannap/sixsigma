// Left column of the OnScene page: the map card (map, search, back/reset, breadcrumb, NYC borough panel, legend, tooltip)
// and the collapsible ranked table. Every number comes from /api/summary; this file only draws and formats it.
// Map fill = the queue label's colour group (status.js tierOf): no statistic is computed here.
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { getGeo } from '../api.js'
import { rewindForD3 } from '../geo.js'
import GlMap from './GlMap.jsx'
import { fmtChanceBelow, fmtCi, fmtDate, fmtGoalOneIn, fmtInt, fmtNum, fmtOneIn, fmtPct, mmss } from '../format.js'
import { CONTROL, QUEUE, SPEC, URGENCY_KEYS, attentionSplit, legendRows, rankPlaces, tierOf } from '../status.js'
import { Icon, Judgments, Messages, Spinner, StatusBadge, WatchChip } from './common.jsx'
import { placeFor } from './PlaceHead.jsx'

const NYC_BOROUGHS = ['36005', '36047', '36061', '36081', '36085'] // Bronx, Kings, New York, Queens, Richmond

// Map shapes load once per page view.
const geoCache = {}
function useGeo(kind, enabled) {
  const [state, setState] = useState({ data: geoCache[kind] || null, error: null })
  useEffect(() => {
    if (!enabled || geoCache[kind]) {
      setState({ data: geoCache[kind] || null, error: null })
      return undefined
    }
    const ctl = new AbortController()
    getGeo(kind, { signal: ctl.signal })
      .then((data) => {
        geoCache[kind] = data
        setState({ data, error: null })
      })
      .catch((e) => e.name !== 'AbortError' && setState({ data: null, error: e.message }))
    return () => ctl.abort()
  }, [kind, enabled])
  return state
}

/** Shapes -> [{id, name, d}] with one projection that fits the given features into the box. */
function project(features, box) {
  if (!features.length) return []
  const projection = geoMercator().fitExtent(box, { type: 'FeatureCollection', features })
  const path = geoPath(projection)
  return features.map((f) => ({ id: f.properties.GEOID, name: f.properties.NAME, d: path(f) }))
}

/** The place's colour class: t-critical, t-watch, t-stable or t-nodata (gray, also when it has no calls). */
const tierClass = (p) => `t-${p ? tierOf(p.queue) : 'nodata'}`

const URGENCY_WORD = { red: 'Red', yellow: 'Yellow', green: 'Green' }
const URGENCY_DOT = { red: 'critical', yellow: 'watch', green: 'stable' }
const county = (name) => (name ? `${name} County` : '')

/**
 * The hover card of one place, built from the summary reply:
 * {title, sub, status: {label, tier} | null, rows: [{label, value, note}], urgency: [{key, label, count}], text}.
 * rows: the late share against the goal, and the median wait beside the area the map is drawn for (county or state).
 * urgency: calls in each urgency group, whatever the filter. text: the same in one string, for screen readers.
 */
export function makeTip(summary, parent) {
  const groups = (summary && summary.selection && summary.selection.urgency) || []
  const lateLabel = groups.length === 1 ? `Late ${groups[0]} calls` : 'Late calls'
  const parentMedian = summary && summary.totals ? summary.totals.median_min : null
  const parentWord = parent.level === 'state' ? 'state' : 'county'
  return (p, name) => {
    const atState = parent.level === 'state'
    const title = atState ? county(name) : `ZIP ${name}`
    const sub = atState ? '' : county(parent.name)
    if (!p) {
      return { title, sub, status: null, rows: [], urgency: [], empty: 'No calls in this selection', text: `${title}: no calls in this selection` }
    }
    const status = { label: QUEUE[p.queue]?.short || p.queue, tier: tierOf(p.queue) }
    const goal = fmtGoalOneIn(p.goal_pct)
    const rows = [{
      label: lateLabel,
      value: fmtOneIn(p.late, p.valid).replace(/ late$/, ''),
      note: goal && p.valid >= 30 ? `goal ${goal}` : '',
    }]
    if (p.median_min != null) {
      rows.push({ label: 'Typical wait', value: mmss(p.median_min * 60), note: parentMedian != null ? `${parentWord} ${mmss(parentMedian * 60)}` : '' })
    }
    const byU = p.calls_by_urgency
    const urgency = byU ? URGENCY_KEYS.map((k) => ({ key: k, dot: URGENCY_DOT[k], label: URGENCY_WORD[k], count: fmtInt(byU[k] || 0) })) : []
    const text = [
      `${title}${sub ? `, ${sub}` : ''}: ${status.label}`,
      ...rows.map((r) => `${r.label} ${r.value}${r.note ? ` (${r.note})` : ''}`),
      ...(urgency.length ? [`calls ${urgency.map((u) => `${u.label} ${u.count}`).join(', ')}`] : []),
    ].join('; ')
    return { title, sub, status, rows, urgency, text }
  }
}

/** The hover card drawn from makeTip's fields. */
function TipCard({ tip }) {
  return (
    <>
      <div className="tip-head">
        <strong className="tip-title">{tip.title}</strong>
        {tip.sub && <span className="tip-sub">{tip.sub}</span>}
      </div>
      {tip.empty && <p className="tip-empty">{tip.empty}</p>}
      {tip.status && <p className="tip-status"><i className={`dot dot-${tip.status.tier}`} aria-hidden="true" />{tip.status.label}</p>}
      {tip.rows.length > 0 && (
        <dl className="tip-rows">
          {tip.rows.map((r) => (
            <div key={r.label} className="tip-row">
              <dt>{r.label}</dt>
              <dd><b>{r.value}</b>{r.note && <span className="tip-note">{r.note}</span>}</dd>
            </div>
          ))}
        </dl>
      )}
      {tip.urgency.length > 0 && (
        <div className="tip-urgency">
          <span className="tip-urgency-label">Calls</span>
          {tip.urgency.map((u) => (
            <span key={u.key} className="tip-u"><i className={`dot dot-${u.dot}`} aria-hidden="true" />{u.label} <b>{u.count}</b></span>
          ))}
        </div>
      )}
    </>
  )
}

/** Search box with a suggestion list: a county, or a ZIP area. Keyboard: arrows, Enter, Escape. */
function SearchBox({ options, onChoose, onType }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const q = query.trim().toLowerCase()
  const shown = useMemo(() => {
    if (!q) return options.filter((o) => o.level === 'county').slice(0, 8)
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.id.startsWith(q)).slice(0, 8)
  }, [options, q])
  useEffect(() => setActive(0), [q])
  const choose = (o) => {
    onChoose(o)
    setQuery('')
    setOpen(false)
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); choose(shown[active]) }
    else if (e.key === 'Escape') setOpen(false)
  }
  return (
    <div className="map-search">
      <div className="search-box">
        <Icon name="search" />
        <input type="text" role="combobox" aria-expanded={open} aria-controls="search-results" aria-autocomplete="list"
          aria-activedescendant={open && shown[active] ? `opt-${shown[active].level}-${shown[active].id}` : undefined}
          aria-label="Search for a New York ZIP code or county" placeholder="Search ZIP or county"
          autoComplete="off" spellCheck="false" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); onType(e.target.value) }}
          onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onKeyDown={onKeyDown} />
      </div>
      {open && (
        <div className="search-results" id="search-results" role="listbox" aria-label="Search suggestions">
          {shown.length === 0 && <div className="search-empty">No county or ZIP area matches. ZIP areas load when you type digits.</div>}
          {shown.map((o, i) => (
            <div key={`${o.level}-${o.id}`} id={`opt-${o.level}-${o.id}`} role="option" aria-selected={i === active}
              className={`search-option${i === active ? ' is-active' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); choose(o) }} onMouseEnter={() => setActive(i)}>
              <span>
                <span className="opt-main">{o.name}</span>
                <span className="opt-sub">{o.sub}</span>
              </span>
              <span className="opt-val">{o.id}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** One clickable place on a map. Colour = queue label group; keyboard: Enter or Space opens it. */
function Shape({ s, p, selected, onPick, setTip, tipFor, cls, noFocus = false }) {
  const tip = tipFor(p, p ? p.name : s.name)
  const label = tip.text
  const open = () => p && onPick(p, true)
  return (
    <path d={s.d} className={`${cls} ${tierClass(p)}${selected.id === s.id ? ' is-selected' : ''}`}
      tabIndex={p && !noFocus ? 0 : -1} role={noFocus ? undefined : 'button'} aria-label={noFocus ? undefined : label}
      onClick={open}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}
      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, ...tip })}
      onMouseLeave={() => setTip(null)}
      onFocus={(e) => {
        const r = e.currentTarget.getBoundingClientRect()
        setTip({ x: r.left + r.width / 2, y: r.top + r.height / 2, ...tip })
      }}
      onBlur={() => setTip(null)} />
  )
}

const TIER_WORD = { critical: 'Critical', watch: 'Watch', stable: 'Stable', nodata: 'Needs more data' }
// Everyday borough names for the county FIPS codes (Census calls them Bronx, Kings, New York, Queens, Richmond).
const BOROUGH_NAME = { 36005: 'Bronx', 36047: 'Brooklyn', 36061: 'Manhattan', 36081: 'Queens', 36085: 'Staten Is.' }

/** Late share for sorting only (most late first); places without valid calls go last. */
const lateShare = (p) => (p && p.valid > 0 ? p.late / p.valid : -1)

/**
 * New York City card: the five boroughs as a small map, and beside it a list with a status dot and "1 in N" late calls
 * for each, worst first, so all five can be compared without hovering. Rows are buttons (keyboard users pick a borough
 * there); hovering or focusing a row outlines that borough on the map.
 */
function Boroughs({ boroughs, byId, selected, onPick, setTip, tipFor, busy }) {
  const [hot, setHot] = useState(null)
  const shapes = useMemo(() => project(boroughs, [[8, 8], [172, 172]]), [boroughs])
  if (!shapes.length) return null
  const rows = shapes
    .map((s) => ({ id: s.id, p: byId[s.id], name: BOROUGH_NAME[s.id] || s.name }))
    .sort((x, y) => lateShare(y.p) - lateShare(x.p))
  const marked = hot || selected.id
  return (
    <div className="map-inset borough-panel">
      <div className="borough-title">New York City</div>
      <div className="borough-body">
        <svg className="inset-map" viewBox="0 0 180 180" aria-hidden="true" focusable="false">
          {shapes.map((s) => <Shape key={s.id} s={s} p={byId[s.id]} selected={selected} onPick={onPick} setTip={setTip} tipFor={tipFor} cls="zip" noFocus />)}
          {shapes.filter((s) => s.id === marked).map((s) => <path key="hot" d={s.d} className="borough-hot" />)}
        </svg>
        <div className="borough-table">
          <div className="borough-cols" aria-hidden="true"><span>Borough</span><span>Late Calls</span></div>
          <ul className="borough-list" aria-label="New York City boroughs, most late calls first">
            {rows.map((r) => {
              const tier = r.p ? tierOf(r.p.queue) : 'nodata'
              const val = busy ? '…' : r.p ? fmtOneIn(r.p.late, r.p.valid).replace(/ late$/, '') : 'no calls'
              return (
                <li key={r.id}>
                  <button type="button" className={`borough-row${marked === r.id ? ' is-selected' : ''}`} disabled={!r.p}
                    aria-pressed={selected.id === r.id}
                    aria-label={`${r.name}: ${TIER_WORD[tier]}, ${r.p ? fmtOneIn(r.p.late, r.p.valid) : 'no calls'}. Open its ZIP areas.`}
                    onMouseEnter={() => setHot(r.id)} onMouseLeave={() => setHot(null)}
                    onFocus={() => setHot(r.id)} onBlur={() => setHot(null)}
                    onClick={() => r.p && onPick(r.p, true)}>
                    <i className={`dot dot-${tier}`} aria-hidden="true" />
                    <span className="borough-name">{r.name}</span>
                    <span className="borough-val">{val}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}

function MapCard({ summaryState, parent, selected, countyOptions = [], onPick, onReset, onSearch }) {
  const drillIn = parent.level !== 'state'
  const [zipWanted, setZipWanted] = useState(false) // the ZIP shapes (about 0.9 MB) load when needed
  const counties = useGeo('counties', true)
  const zctas = useGeo('zcta', drillIn || zipWanted)
  const [tip, setTip] = useState(null)
  const cardRef = useRef(null)
  const s = summaryState.data
  const places = (s && s.places) || []
  const byId = useMemo(() => Object.fromEntries(places.map((p) => [p.id, p])), [places])
  const tipFor = useMemo(() => makeTip(s, parent), [s, parent])

  const [fitKey, setFitKey] = useState(0) // bumped by the reset button so the map flies back to the state
  // Raw GeoJSON for the map (drilled in: the ZIP areas of the open county; other counties stay as gray context).
  const rawCounties = useMemo(() => (counties.data ? counties.data.features : []), [counties.data])
  const rawZctas = useMemo(
    () => (drillIn && zctas.data ? zctas.data.features.filter((f) => f.properties.county_fips === parent.id) : []),
    [drillIn, zctas.data, parent.id],
  )
  // The NYC card draws its own small d3 map, which wants the winding d3 expects.
  const countyFeatures = useMemo(() => rawCounties.map(rewindForD3), [rawCounties])

  const boroughs = useMemo(() => (drillIn ? [] : countyFeatures.filter((f) => NYC_BOROUGHS.includes(f.properties.GEOID))), [drillIn, countyFeatures])
  const geoError = counties.error || ((drillIn || zipWanted) && zctas.error)
  const loading = !counties.error && (!counties.data || (drillIn && !zctas.error && !zctas.data))

  // Search suggestions: every county, the ZIP areas of the open county, and (once the ZIP shapes are loaded) any ZIP.
  const options = useMemo(() => {
    const countyName = Object.fromEntries(countyOptions.map((c) => [c.id, c.name]))
    const byZip = new Map()
    if (zctas.data) {
      for (const f of zctas.data.features) {
        const id = f.properties.GEOID
        byZip.set(id, { level: 'zcta', id, name: id, sub: `ZIP area in ${countyName[f.properties.county_fips] || 'New York'}`, countyId: f.properties.county_fips })
      }
    }
    for (const p of places) {
      if (drillIn && p.id.length === 5 && parent.id) byZip.set(p.id, { level: 'zcta', id: p.id, name: p.id, sub: `ZIP area in ${parent.name || 'this county'}`, countyId: parent.id })
    }
    return [...countyOptions, ...byZip.values()]
  }, [drillIn, places, parent.id, parent.name, countyOptions, zctas.data])

  const rows = legendRows(s && s.queue_counts)
  const rect = cardRef.current ? cardRef.current.getBoundingClientRect() : { left: 0, top: 0 }

  return (
    <section className={`mapcard card${summaryState.loading ? ' is-loading' : ''}`} aria-labelledby="map-heading" aria-busy={summaryState.loading} ref={cardRef}>
      <h2 id="map-heading" className="sr-only">{drillIn ? `${parent.name} ZIP area map` : 'New York State county map'}</h2>
      <GlMap counties={rawCounties} zctas={rawZctas} drillIn={drillIn} parentId={parent.id} byId={byId}
        selectedId={selected.id} label={tipFor} onPick={onPick} setTip={setTip} fitKey={fitKey} busy={summaryState.loading}
        ariaLabel={drillIn ? 'Map of ZIP areas, colored by queue label. Select one to see it on the right. Gray areas outside New York are for orientation only.' : 'Map of New York counties, colored by queue label. Select one to open its ZIP areas. Gray areas outside New York are for orientation only.'} />

      <SearchBox options={options} onChoose={onSearch} onType={(text) => /^\d/.test(text.trim()) && setZipWanted(true)} />

      <div className="map-tools">
        {drillIn && (
          <button type="button" className="map-tool" title="Back to all counties" aria-label="Back to all counties" onClick={onReset}>
            <Icon name="back" />
          </button>
        )}
        <button type="button" className="map-tool" title="Reset to New York State" aria-label="Reset map to New York State" onClick={() => { onReset(); setFitKey((k) => k + 1) }}>
          <Icon name="reset" />
        </button>
      </div>

      {drillIn && (
        <nav className="breadcrumb" aria-label="Map drilldown">
          <button type="button" onClick={onReset}>New York State</button>
          <Icon name="chev-right" />
          <span className="crumb-now" aria-current="page">{parent.name || 'County'}</span>
        </nav>
      )}

      {boroughs.length > 0 && <Boroughs boroughs={boroughs} byId={byId} selected={selected} onPick={onPick} setTip={setTip} tipFor={tipFor} busy={summaryState.loading} />}

      <div className="map-legend" aria-label="Status legend">
        <div className="legend-head">
          <div className="legend-title">Status</div>
          <span className="legend-info">
            <button type="button" className="legend-info-btn" aria-label="What the status colours mean" aria-describedby="legend-def">i</button>
            <span className="legend-tip" id="legend-def" role="tooltip">
              <span className="tip-line"><strong>Critical</strong> = act now</span>
              <span className="tip-line"><strong>Watch</strong> = ongoing gap or recent change</span>
              <span className="tip-line"><strong>Stable</strong> = meets goal</span>
              <span className="tip-line"><strong>Needs data</strong> = needs more data</span>
            </span>
          </span>
        </div>
        {rows.map((r) => (
          <div key={r.key} className="legend-row">
            <i className={`dot dot-${r.key}`} aria-hidden="true" /><span>{r.label}</span><span className="legend-val">{summaryState.loading ? '…' : r.count}</span>
          </div>
        ))}
      </div>

      {tip && (
        <div className="map-tooltip is-visible" role="presentation" style={{ left: tip.x - rect.left, top: tip.y - rect.top }}>
          <TipCard tip={tip} />
        </div>
      )}
      {(loading || summaryState.loading) && (
        <p className="map-note map-loading" role="status"><Spinner />{loading ? 'Loading map...' : 'Loading the map colours...'}</p>
      )}
      {geoError && <p className="map-note error" role="alert">{geoError}</p>}
      {summaryState.error && (
        <div className="map-note error" role="alert">
          <p><strong>The numbers are not available yet.</strong> {summaryState.error}</p>
          <button type="button" className="btn" onClick={summaryState.reload}>Try again</button>
        </div>
      )}
    </section>
  )
}

/** The ranked table (the team's full table). Place name selects the place; ranking comes from status.js rankPlaces. */
function PlaceTable({ places, selected, onPick }) {
  const ranked = rankPlaces(places)
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Ranked places (scrolls sideways on small screens)">
      <table className="places">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Place</th><th scope="col">Valid calls</th><th scope="col">On time</th>
            <th scope="col">On-time rate [95% CI]</th><th scope="col">Target</th><th scope="col">Control</th>
            <th scope="col">Queue</th>
            <th scope="col" title="Late calls beyond what the goal allows: late - (1 - goal) x valid. Negative = fewer than allowed. The ranking inside a queue label uses it.">Excess late vs goal</th>
            <th scope="col">Cancelled / invalid</th><th scope="col">Calls per day: now (baseline)</th>
            <th scope="col">P95 min [95% CI]</th><th scope="col" title="Secondary; assumes lognormal times; never sets the queue">Cpk [upper] (secondary)</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr key={p.id} className={selected.id === p.id ? 'row-selected' : ''}>
              <td className="mono">{i + 1}</td>
              <th scope="row">
                <button type="button" className="link-btn" onClick={() => onPick(p, false)} aria-pressed={selected.id === p.id}>{p.name}</button>
                {p.signals && p.signals[0] && <div className="small muted">signal: {p.unit} of {fmtDate(p.signals[0].start)}</div>}
              </th>
              <td className="mono">{fmtInt(p.valid)}</td>
              <td className="mono">{fmtInt(p.on_time)}</td>
              <td className="mono">{fmtPct(p.on_time_pct)} <span className="muted">[{fmtCi(p.on_time_ci)}]</span> <span className="muted">vs {fmtNum(p.goal_pct, 0)}</span></td>
              <td><span className="chip" style={{ background: SPEC[p.spec]?.bg, color: SPEC[p.spec]?.fg }}>{SPEC[p.spec]?.label}</span></td>
              <td><span className="chip" style={{ background: CONTROL[p.control]?.bg, color: CONTROL[p.control]?.fg }}>{CONTROL[p.control]?.label}</span></td>
              <td><StatusBadge status={p.queue} short /><WatchChip p={p} /></td>
              <td className="mono">{fmtNum(p.excess_late, 1)}</td>
              <td className="mono">{fmtInt(p.cancelled)} ({fmtPct(p.cancel_pct)}) / {fmtInt(p.invalid)}</td>
              <td className="mono">{fmtNum(p.calls_per_day, 1)} ({fmtNum(p.base_calls_per_day, 1)})</td>
              <td className="mono">{p.p95_min == null ? 'n/a' : fmtNum(p.p95_min)}{p.p95_ci && p.p95_min != null && <span className="muted"> [{fmtCi(p.p95_ci)}]</span>}</td>
              <td className="mono muted" title={p.cpk == null ? 'Cpk undefined (under 30 calls or no spread)' : ''}>
                {p.cpk == null ? 'n/a' : fmtNum(p.cpk, 2)}{p.cpk_upper != null && <> [{fmtNum(p.cpk_upper, 2)}]</>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** "Toggle table for map": collapsed by default; the headline stays visible above it. */
function TableCard({ summaryState, parent, selected, onPick }) {
  const [open, setOpen] = useState(false)
  const s = summaryState.data
  const places = (s && s.places) || []
  const noun = parent.level === 'state' ? 'counties' : 'ZIP areas'
  const split = s ? attentionSplit(s) : null
  const chance = s ? fmtChanceBelow(s.chance_below, noun) : ''
  const p = placeFor(s, selected, parent)
  const name = selected.name || (s && s.selection && s.selection.name) || 'New York State'
  return (
    <div className="tablecard card">
      {p && (
        <div className="place-badges table-badges" aria-label={`Labels for ${name}`}>
          <span className="badges-for">{name}:</span>
          <StatusBadge status={p.queue} />
          <Judgments p={p} />
        </div>
      )}
      {split && (
        <div className="table-headline">
          <p role="status">
            {split.total} of {places.length} {noun} need review: {split.recent} with a recent signal (Act now + Recent change) &middot; {split.ongoing} ongoing gaps{split.total > 0 ? '. Start at the top of the table.' : '.'}
          </p>
          {chance && <p className="small muted" role="note">{chance}</p>}
        </div>
      )}
      <button className="table-toggle" type="button" aria-expanded={open} aria-controls="table-wrap" onClick={() => setOpen(!open)}>
        <span className="toggle-icon" aria-hidden="true"><Icon name="chev" /></span>
        <span className="toggle-text">
          <span className="toggle-title">Toggle table for map</span>
          <span className="toggle-sub">{s ? `Ranked by queue label, then late calls beyond the goal` : 'Places ranked by queue label'}</span>
        </span>
        <span className="toggle-count">{s ? `${places.length} ${noun}` : ''}</span>
      </button>
      <div className="table-wrap" id="table-wrap" hidden={!open}>
        {places.length > 0 && <PlaceTable places={places} selected={selected} onPick={onPick} />}
        {s && !places.length && <p className="table-empty">No place has calls in this selection.</p>}
        <div className="table-note">
          <p>
            Two separate questions. <strong>Target</strong>: is the on-time rate confidently at or above the goal? Meets = the lower end
            of its 95% interval is at or above the goal; Below = the upper end is below it; anything else, or under 30 valid calls, is Inconclusive.
            {' '}<strong>Control</strong>: is the late share confirmed above its p-chart upper limit, set from the baseline before the period (two or more periods, or one very strong one; a single weaker period is only marked watch)?
            Being in control does not mean the service is good, and no alert does not mean the target is met.
            Rows are ranked inside each queue label by excess late calls vs the goal, so a big place with a modest gap is not buried under a tiny place with a high rate.
            Map colour is the queue label: Critical = Act now, Watch = Ongoing gap or Recent change, Stable = Meets goal, gray = Needs more data.
          </p>
          {s && <Messages messages={s.messages} />}
        </div>
      </div>
    </div>
  )
}

export default function MapSection(props) {
  return (
    <>
      <MapCard {...props} />
      <TableCard summaryState={props.summaryState} parent={props.parent} selected={props.selected} onPick={props.onPick} />
    </>
  )
}
