import { useEffect, useMemo, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { getGeo } from '../api.js'
import { rewindForD3 } from '../geo.js'
import { fmtInt, fmtMin, fmtNum, fmtPct, fmtZ, lateGoalPct } from '../format.js'
import { STATUS, URGENCY, attentionCount, fillFor, rankPlaces } from '../status.js'
import { Async, Messages, Section, StatusBadge, StatusIcon, StatusLegend } from './common.jsx'

const BAR_MAX = 25 // the table's % late bar runs 0 to 25%
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
  const maxPct = Math.max(1, ...(places || []).filter((p) => p.status !== 'not_enough').map((p) => p.pct_late || 0))
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
            const status = p ? p.status : null
            const fill = !p || status === 'not_enough' ? '#C9CEC7' : fillFor(mainUrgency, (p.pct_late || 0) / maxPct)
            const outline = status === 'act_now' ? { stroke: '#17201C', strokeWidth: 3 }
              : status === 'ongoing_gap' ? { stroke: '#17201C', strokeWidth: 2.5, strokeDasharray: '2 4', strokeLinecap: 'round' }
              : { stroke: '#FFFFFF', strokeWidth: 1 }
            const tip = p
              ? status === 'not_enough'
                ? `${p.name}: Not enough calls (<30 calls)`
                : `${p.name}: ${fmtPct(p.pct_late)} late, ${STATUS[status]?.label || status}`
              : `${s.name}: no data in this selection`
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
            if (!p || (p.status !== 'act_now' && p.status !== 'recent_change')) return null
            const [cx, cy] = s.c
            if (Number.isNaN(cx)) return null
            return (
              <g key={`flag-${s.id}`} transform={`translate(${cx - 8} ${cy - 8}) scale(1.1)`} style={{ pointerEvents: 'none' }}>
                <rect x="-2" y="-2" width="20" height="20" rx="4" fill="#FFFFFF" fillOpacity="0.85" />
                <StatusIcon status={p.status} size={16} />
              </g>
            )
          })}
        </svg>
      )}
      <div className="legend-row" aria-label="Map legend">
        <span className="swatch-ramp" aria-hidden="true">
          <span>fewer late</span>
          <span className="ramp" style={{ background: `linear-gradient(90deg, ${URGENCY[mainUrgency].light}, ${URGENCY[mainUrgency].dark})` }} />
          <span>more late</span>
        </span>
        <span><StatusIcon status="act_now" size={14} /> Act now: filled flag, thick outline</span>
        <span><StatusIcon status="recent_change" size={14} /> Recent change: hollow flag</span>
        <span><StatusIcon status="ongoing_gap" size={14} /> Ongoing gap: dotted outline</span>
        <span><span className="gray-swatch" /> Not enough calls (&lt;30 calls)</span>
      </div>
    </figure>
  )
}

function SelectedPanel({ summary, selected, parent, onDrill }) {
  const p = selected.place
  const totals = summary.totals
  const isParent = selected.level === parent.level && selected.id === parent.id
  const name = selected.name || summary.selection?.name || 'New York State'
  const calls = p ? p.timed : totals?.timed
  const late = p ? p.late : totals?.late
  const pct = p ? p.pct_late : totals?.pct_late
  const p95 = p ? p.p95_min : totals?.p95_min
  const ci = p ? p.p95_ci : totals?.p95_ci
  const status = p ? p.status : null
  const veryLate = p ? p.very_late : totals?.very_late
  const spread = p ? p.spread_min : totals?.spread_min
  const zLoc = p ? p.z_loc : null
  const zP = p ? p.z_p : null
  return (
    <aside className="selected" aria-label="Selected place">
      <div className="eyebrow">Selected place</div>
      <div className="selected-title">
        <h3>{name}</h3>
        {status && <StatusBadge status={status} />}
      </div>
      {status && <p>{STATUS[status]?.help}</p>}
      {p && p.reasons && p.reasons.length > 0 && (
        <ul className="reasons">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      )}
      <div className="mini-grid">
        <div className="mini"><div className="mini-label">Late calls</div><div className="mini-sub">{fmtInt(late)} of {fmtInt(calls)}</div><div className="mini-value">{fmtPct(pct)}</div></div>
        <div className="mini"><div className="mini-label">Longest waits (P95)</div><div className="mini-value">{fmtMin(p95)}</div><div className="mini-sub">{ci ? `95% CI ${fmtNum(ci[0])} to ${fmtNum(ci[1])}` : '1 in 20 waited longer'}</div></div>
        <div className="mini"><div className="mini-label">Very late (over 2x goal time)</div><div className="mini-value">{fmtInt(veryLate)}</div></div>
        <div className="mini"><div className="mini-label">Spread (P95 - median)</div><div className="mini-value">{fmtMin(spread)}</div></div>
      </div>
      {p && (
        <p className="small" data-testid="change-z">
          <strong>Change vs before (z):</strong> time {fmtZ(zLoc)}, share late {fmtZ(zP)}. <strong>&gt; 3 = real change.</strong>
        </p>
      )}
      {status && <p><strong>Next step:</strong> {STATUS[status]?.next}</p>}
      {!isParent && selected.level === 'county' && (
        <button type="button" className="btn" onClick={() => onDrill(p)}>Show this county's ZIP areas</button>
      )}
      <p className="small"><a href="#section-3">Sections 3 to 5 below look at {name}.</a></p>
    </aside>
  )
}

function PlaceTable({ places, selected, onPick, goalPct }) {
  const lateGoal = lateGoalPct(goalPct)
  const ranked = rankPlaces(places)
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Ranked places (scrolls sideways on small screens)">
      <table className="places">
        <thead>
          <tr>
            <th scope="col">#</th><th scope="col">Place</th><th scope="col">Calls</th><th scope="col">Late</th>
            <th scope="col">Very late</th><th scope="col">% late</th><th scope="col">P95 [95% CI]</th><th scope="col">Spread (P95 - median)</th><th scope="col">Cpk [upper]</th><th scope="col">Change vs before (z)</th><th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((p, i) => (
            <tr key={p.id} className={selected.id === p.id ? 'row-selected' : ''}>
              <td className="mono">{i + 1}</td>
              <th scope="row">
                <button type="button" className="link-btn" onClick={() => onPick(p, false)} aria-pressed={selected.id === p.id}>{p.name}</button>
                {p.reasons && p.reasons[0] && <div className="small muted">{p.reasons[0]}</div>}
              </th>
              <td className="mono">{fmtInt(p.calls)}</td>
              <td className="mono">{fmtInt(p.late)}</td>
              <td className="mono">{fmtInt(p.very_late)}</td>
              <td>
                <div className="pct-cell">
                  <div className="pct-bar" aria-hidden="true"><div style={{ width: `${Math.min(100, ((p.pct_late || 0) / BAR_MAX) * 100)}%` }} />{lateGoal != null && <i style={{ left: `${(lateGoal / BAR_MAX) * 100}%` }} />}</div>
                  <span className="mono">{fmtPct(p.pct_late)}</span>
                </div>
              </td>
              <td className="mono">{p.p95_min == null ? 'n/a' : fmtNum(p.p95_min)}{p.p95_ci && <span className="muted"> [{fmtNum(p.p95_ci[0])}, {fmtNum(p.p95_ci[1])}]</span>}</td>
              <td className="mono">{fmtNum(p.spread_min)}</td>
              <td className="mono" title={p.cpk == null ? 'Cpk undefined (not enough calls or no spread)' : ''}>
                {p.cpk == null ? 'n/a' : fmtNum(p.cpk, 2)}{p.cpk_upper != null && <span className="muted"> [{fmtNum(p.cpk_upper, 2)}]</span>}
              </td>
              <td className="mono" title="Time z / share-late z. Above 3 = real change.">
                {fmtZ(p.z_loc)}<span className="muted"> / {fmtZ(p.z_p)}</span>
              </td>
              <td><StatusBadge status={p.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function MapSection({ summaryState, parent, urgency, selected, onPick, onBack, onDrill }) {
  return (
    <Section num={1} title="Which places need attention?" id="section-1">
      <Async state={summaryState}>
        {(s) => {
          const total = (s.places || []).length
          const n = attentionCount(s)
          return (
            <>
              <p className="headline" role="status">
                {n} of {total} {parent.level === 'state' ? 'counties' : 'ZIP areas'} need attention{n > 0 ? '. Start with the top of the table.' : '.'}
              </p>
              <div className="split">
                <PlaceMap parent={parent} places={s.places} urgency={urgency} selected={selected} onPick={onPick} onBack={onBack} />
                <SelectedPanel summary={s} selected={selected} parent={parent} onDrill={onDrill} />
              </div>
              <StatusLegend />
              <PlaceTable places={s.places} selected={selected} onPick={onPick} goalPct={s.totals?.goal_pct} />
              <p className="small muted">
                Fill color is the urgency you picked; darker means more late. Status is shown by the flag and outline, not by a second color.
                Table bar: 0 to 25% late{s.totals?.goal_pct != null ? `, tick at ${fmtNum(lateGoalPct(s.totals.goal_pct), 0)}% (the center's goal of ${fmtNum(s.totals.goal_pct, 0)}% on time)` : ''}.
                "Change vs before (z)" compares the selected range with the 60 days before it (time z / share-late z); above 3 = a real change, and it is what sets Recent change and Act now.
                "Too slow overall" means Cpk (on log minutes) is confidently below the bar for the center's goal.
              </p>
              <Messages messages={s.messages} />
            </>
          )
        }}
      </Async>
    </Section>
  )
}
