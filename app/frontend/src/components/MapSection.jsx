import { useEffect, useMemo, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { getGeo } from '../api.js'
import { rewindForD3 } from '../geo.js'
import { fmtCi, fmtDate, fmtInt, fmtMin, fmtNum, fmtPct } from '../format.js'
import { QUEUE, SPEC, CONTROL, STAGES, URGENCY, attentionCount, fillFor, latePct, rankPlaces } from '../status.js'
import { Async, Judgments, Messages, Section, StatusBadge, StatusIcon, StatusLegend } from './common.jsx'

const MIN_N = 30 // under this many valid calls a place is drawn gray (insufficient data)
const W = 640
const H = 440

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

function PlaceMap({ parent, places, urgency, selected, onPick, onBack }) {
  const drillIn = parent.level !== 'state'
  const counties = useGeo('counties', !drillIn)
  const zctas = useGeo('zcta', drillIn)
  const geo = drillIn ? zctas : counties

  const features = useMemo(() => {
    if (!geo.data) return []
    const all = geo.data.features
    const picked = drillIn ? all.filter((f) => f.properties.county_fips === parent.id) : all
    return picked.map(rewindForD3)
  }, [geo.data, drillIn, parent.id])

  const byId = useMemo(() => Object.fromEntries((places || []).map((p) => [p.id, p])), [places])
  const maxLate = Math.max(1, ...(places || []).filter((p) => p.valid >= MIN_N).map((p) => latePct(p) || 0))
  const mainUrgency = urgency[0] || 'red'

  const shapes = useMemo(() => {
    if (!features.length) return []
    const collection = { type: 'FeatureCollection', features }
    const projection = geoMercator().fitSize([W, H], collection)
    const path = geoPath(projection)
    return features.map((f) => ({ id: f.properties.GEOID, name: f.properties.NAME, d: path(f), c: path.centroid(f) }))
  }, [features])

  const selectedShape = shapes.find((s) => s.id === selected.id)

  return (
    <figure className="map-figure">
      <div className="map-bar">
        {drillIn ? (
          <button type="button" className="btn" onClick={onBack} aria-label="Back to all counties">
            &larr; All counties
          </button>
        ) : (
          <span className="map-hint">Click a county to see its ZIP areas.</span>
        )}
        <strong>{drillIn ? `${parent.name || 'County'}: ZIP areas` : 'New York counties'}</strong>
      </div>
      {geo.error && <p className="error" role="alert">{geo.error}</p>}
      {!geo.data && !geo.error && <p className="loading" role="status">Loading map...</p>}
      {shapes.length > 0 && (
        <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="group"
          aria-label={drillIn ? 'Map of ZIP areas, colored by share of late calls' : 'Map of counties, colored by share of late calls'}>
          <rect x="0" y="0" width={W} height={H} rx="10" fill="#F6F7F5" />
          {shapes.map((s) => {
            const p = byId[s.id]
            const q = p ? p.queue : null
            const sparse = !p || p.valid < MIN_N
            const fill = sparse ? '#C9CEC7' : fillFor(mainUrgency, (latePct(p) || 0) / maxLate)
            const outline = q === 'act_now' ? { stroke: '#17201C', strokeWidth: 3 }
              : q === 'ongoing_gap' ? { stroke: '#17201C', strokeWidth: 2.5, strokeDasharray: '2 4', strokeLinecap: 'round' }
              : { stroke: '#FFFFFF', strokeWidth: 1 }
            const tip = p
              ? `${p.name}: ${fmtPct(p.on_time_pct)} on time (${fmtInt(p.on_time)} of ${fmtInt(p.valid)}), ${SPEC[p.spec]?.label}, ${CONTROL[p.control]?.label}: ${QUEUE[q]?.short || q}`
              : `${s.name}: no calls in this selection`
            return (
              <path key={s.id} d={s.d} fill={fill} {...outline} className="shape" tabIndex={p ? 0 : -1}
                role="button" aria-label={tip}
                onClick={() => p && onPick(p, true)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && p && (e.preventDefault(), onPick(p, true))}>
                <title>{tip}</title>
              </path>
            )
          })}
          {selectedShape && (
            <path d={selectedShape.d} fill="none" stroke="#1F3A5F" strokeWidth="4.5" strokeLinejoin="round" style={{ pointerEvents: 'none' }} />
          )}
          {shapes.map((s) => {
            const p = byId[s.id]
            if (!p || (p.queue !== 'act_now' && p.queue !== 'recent_change')) return null
            const [cx, cy] = s.c
            if (Number.isNaN(cx)) return null
            return (
              <g key={`flag-${s.id}`} transform={`translate(${cx - 8} ${cy - 8}) scale(1.1)`} style={{ pointerEvents: 'none' }}>
                <rect x="-2" y="-2" width="20" height="20" rx="4" fill="#FFFFFF" fillOpacity="0.85" />
                <StatusIcon status={p.queue} size={16} />
              </g>
            )
          })}
        </svg>
      )}
      <div className="legend-row" aria-label="Map legend">
        <span className="swatch-ramp" aria-hidden="true">
          <span>smaller late share</span>
          <span className="ramp" style={{ background: `linear-gradient(90deg, ${URGENCY[mainUrgency].light}, ${URGENCY[mainUrgency].dark})` }} />
          <span>larger</span>
        </span>
        <span><StatusIcon status="act_now" size={14} /> Act now: filled flag, thick outline</span>
        <span><StatusIcon status="recent_change" size={14} /> Recent change: hollow flag</span>
        <span><StatusIcon status="ongoing_gap" size={14} /> Ongoing gap: dotted outline</span>
        <span><span className="gray-swatch" /> Under {MIN_N} valid calls: insufficient data</span>
      </div>
    </figure>
  )
}

function SelectedPanel({ summary, selected, parent, onDrill }) {
  const p = selected.place || summary.place
  const isParent = selected.level === parent.level && selected.id === parent.id
  const name = selected.name || summary.selection?.name || 'New York State'
  if (!p) return null
  const q = QUEUE[p.queue]
  return (
    <aside className="selected" aria-label="Selected place">
      <div className="eyebrow">Selected place</div>
      <div className="selected-title">
        <h3>{name}</h3>
        <StatusBadge status={p.queue} short />
      </div>
      <Judgments p={p} />
      <p>{q?.help}</p>
      <div className="mini-grid">
        <div className="mini">
          <div className="mini-label">On time (the service goal)</div>
          <div className="mini-value">{fmtPct(p.on_time_pct)}</div>
          <div className="mini-sub">{fmtInt(p.on_time)} of {fmtInt(p.valid)} valid calls &middot; 95% CI {fmtCi(p.on_time_ci, '%')} &middot; goal {fmtPct(p.goal_pct, 0)}</div>
        </div>
        <div className="mini">
          <div className="mini-label">Longest waits (P95)</div>
          <div className="mini-value">{fmtMin(p.p95_min)}</div>
          <div className="mini-sub">95% CI {fmtCi(p.p95_ci)} min &middot; median {fmtMin(p.median_min)}</div>
        </div>
      </div>
      <ul className="reasons">
        <li><strong>Target:</strong> {p.spec_reason || 'n/a'}.</li>
        <li><strong>Control:</strong> {p.control_reason || 'n/a'}{p.unit ? ` (${p.unit}ly subgroups)` : ''}.
          {p.signals && p.signals.length > 0 && <> Signals: {p.signals.slice(0, 4).map((s) => `${p.unit} of ${fmtDate(s.start)} (${fmtPct(100 * s.p)} late, limit ${fmtPct(100 * s.ucl)})`).join('; ')}{p.signals.length > 4 ? '; ...' : ''}.</>}
        </li>
        {p.baseline && <li><strong>Baseline:</strong> {fmtDate(p.baseline.from)} to {fmtDate(p.baseline.to)} ({p.baseline.days} days, {fmtInt(p.baseline.valid)} valid calls{p.baseline.stretched ? ', stretched from 60 days' : ''}).</li>}
        {p.top_stage && <li><strong>Stage with the most extra time in late calls:</strong> {STAGES[p.top_stage].label} ({STAGES[p.top_stage].who}).</li>}
      </ul>
      <p><strong>Next step:</strong> {q?.next}</p>
      {!isParent && selected.level === 'county' && (
        <button type="button" className="btn" onClick={() => onDrill(selected.place)}>Show this county's ZIP areas</button>
      )}
      <p className="small"><a href="#section-2">Sections 2 to 4 below look at {name}.</a></p>
    </aside>
  )
}

function PlaceTable({ places, selected, onPick }) {
  const ranked = rankPlaces(places)
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Ranked places (scrolls sideways on small screens)">
      <table className="places">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Place</th><th scope="col">Valid calls</th><th scope="col">On time</th>
            <th scope="col">On-time rate [95% CI]</th><th scope="col">Target</th><th scope="col">Control</th>
            <th scope="col">Queue</th><th scope="col">P95 min [95% CI]</th><th scope="col" title="Secondary; assumes lognormal times; never sets the queue">Cpk [upper] (secondary)</th>
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
              <td><StatusBadge status={p.queue} short /></td>
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

export default function MapSection({ summaryState, parent, urgency, selected, onPick, onBack, onDrill }) {
  return (
    <Section num={1} title="Which areas need review?" id="section-1">
      <Async state={summaryState}>
        {(s) => {
          const total = (s.places || []).length
          const n = attentionCount(s)
          return (
            <>
              <p className="headline" role="status">
                {n} of {total} {parent.level === 'state' ? 'counties' : 'ZIP areas'} need review{n > 0 ? '. Start at the top of the table.' : '.'}
              </p>
              <div className="split">
                <PlaceMap parent={parent} places={s.places} urgency={urgency} selected={selected} onPick={onPick} onBack={onBack} />
                <SelectedPanel summary={s} selected={selected} parent={parent} onDrill={onDrill} />
              </div>
              <StatusLegend />
              <PlaceTable places={s.places} selected={selected} onPick={onPick} />
              <p className="small muted">
                Two separate questions. <strong>Target</strong>: is the on-time rate confidently at or above the goal? Meets = the lower end
                of its 95% interval is at or above the goal; Below = the upper end is below it; anything else, or under 30 valid calls, is Inconclusive.
                {' '}<strong>Control</strong>: did the late share rise above its p-chart upper limit, set from the baseline before the period?
                Being in control does not mean the service is good, and no alert does not mean the target is met.
                Fill color is the late share for the urgency you picked; gray means under 30 valid calls.
              </p>
              <Messages messages={s.messages} />
            </>
          )
        }}
      </Async>
    </Section>
  )
}
