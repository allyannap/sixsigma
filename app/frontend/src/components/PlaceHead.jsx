// Right column, top: the selected place and the From / To date form. Its labels sit with the table (MapSection).
import { useEffect, useState } from 'react'
import { fmtInt } from '../format.js'
import { Icon } from './common.jsx'

const LEVEL_WORD = { state: 'Statewide', county: 'County', zcta: 'ZIP area' }

function DateForm({ from, to, disabled, min, max, onApply }) {
  const [a, setA] = useState(from)
  const [b, setB] = useState(to)
  const [error, setError] = useState('')
  useEffect(() => { setA(from); setB(to) }, [from, to])
  const submit = (e) => {
    e.preventDefault()
    if (a && b && a > b) { setError('From must be on or before To.'); return }
    setError('')
    onApply(a, b)
  }
  return (
    <form className="daterange" onSubmit={submit} noValidate aria-label="Date range" aria-describedby={disabled ? 'range-hint' : undefined}>
      <label className="date-field" htmlFor="date-from"><span className="date-label">From</span>
        <input type="date" id="date-from" value={a} min={min} max={max} disabled={disabled} onChange={(e) => setA(e.target.value)} />
      </label>
      <span className="date-sep" aria-hidden="true">&ndash;</span>
      <div className="date-field">
        <div className="date-label">
          <label htmlFor="date-to">To</label>
          <span className="legend-info">
            <button type="button" className="legend-info-btn" aria-label="What a blank date means" aria-describedby="date-blank-tip">i</button>
            <span className="legend-tip" id="date-blank-tip" role="tooltip">Blank dates use the last 90 days of the dataset. The boxes start empty on purpose; that period already has calls.</span>
          </span>
        </div>
        <input type="date" id="date-to" value={b} min={min} max={max} disabled={disabled} onChange={(e) => setB(e.target.value)} />
      </div>
      <button className="btn-primary" type="submit" disabled={disabled}><Icon name="search" size={14} />Search</button>
      {error && <span className="range-error" role="alert">{error}</span>}
      {disabled && <span className="range-hint" id="range-hint">Dates are fixed while the replay runs.</span>}
    </form>
  )
}

/**
 * Which place card to show: the picked place; a ZIP picked from a list arrives without its numbers, so look it up in
 * the loaded places; the area the map is drawn for is the summary's own `place`.
 */
export function placeFor(summary, selected, parent) {
  if (!summary) return null
  const isParent = selected.level === parent.level && selected.id === parent.id
  // The clicked row is a snapshot from its old date range. Always use the current API reply.
  return isParent ? summary.place : (summary.places || []).find((x) => x.id === selected.id) || null
}

export default function PlaceHead({ summaryState, selected, parent, from, to, replayOn, dateMin, dateMax, onApply, onDrill }) {
  const s = summaryState.data
  const name = selected.name || (s && s.selection && s.selection.name) || 'New York State'
  const count = s && s.places ? s.places.length : null
  const unit = parent.level === 'state' ? 'counties' : 'ZIP areas'
  const meta = selected.level === 'zcta'
    ? `in ${parent.name || 'this county'}`
    : count == null ? '' : `${fmtInt(count)} ${unit}`
  const isParent = selected.level === parent.level && selected.id === parent.id
  return (
    <div className="place-block">
      <div className="place-head">
        <div className="place-id">
          <span className="eyebrow">Selected place</span>
          <h1 className="place-name">{name}</h1>
          <div className="place-meta">
            <span className="site">{LEVEL_WORD[selected.level] || 'Statewide'}</span>
            {meta && <><span className="sep" aria-hidden="true">·</span><span>{meta}</span></>}
          </div>
        </div>
        <DateForm from={from} to={to} disabled={replayOn} min={dateMin} max={dateMax} onApply={onApply} />
      </div>
      {!isParent && selected.level === 'county' && selected.place && (
        <button type="button" className="btn btn-small place-drill" onClick={() => onDrill(selected.place)}>Show this county's ZIP areas</button>
      )}
    </div>
  )
}
