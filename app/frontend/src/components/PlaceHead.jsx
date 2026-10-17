// Right column, top: the selected place and the From / To date form. Its labels sit with the table (MapSection).
import { useEffect, useRef, useState } from 'react'
import { fmtDate, fmtInt } from '../format.js'
import { Icon } from './common.jsx'

const LEVEL_WORD = { state: 'Statewide', county: 'County', zcta: 'ZIP area' }

/** "2026-10-02" -> "Oct 2, 2026" for the date-range message. */
const longDate = (iso) => `${fmtDate(iso)}, ${String(iso).slice(0, 4)}`

/** The end date is before the start date: say which dates, why it cannot run, and how to fix it. */
export function rangeMessage(from, to) {
  return `The end date (${longDate(to)}) is before the start date (${longDate(from)}), so there are no days to show. `
    + 'Pick an end date on or after the start date, or swap the two dates.'
}

function DateForm({ from, to, disabled, min, max, onApply }) {
  const [a, setA] = useState(from)
  const [b, setB] = useState(to)
  const [error, setError] = useState('')
  const errorRef = useRef(null)
  useEffect(() => { setA(from); setB(to) }, [from, to])
  // The message goes away on a click or tap anywhere outside it, or on Escape.
  useEffect(() => {
    if (!error) return undefined
    const onDown = (e) => { if (errorRef.current && !errorRef.current.contains(e.target)) setError('') }
    const onKey = (e) => { if (e.key === 'Escape') setError('') }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [error])
  const submit = (e) => {
    e.preventDefault()
    if (a && b && a > b) { setError(rangeMessage(a, b)); return }
    setError('')
    onApply(a, b)
  }
  return (
    <form className="daterange" onSubmit={submit} noValidate aria-label="Date range" aria-describedby={disabled ? 'range-hint' : undefined}>
      <label className="date-field" htmlFor="date-from"><span className="date-label">From</span>
        <input type="date" id="date-from" value={a} min={min} max={max} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'range-error' : undefined} onChange={(e) => { setA(e.target.value); setError('') }} />
      </label>
      <span className="date-sep" aria-hidden="true">&ndash;</span>
      <label className="date-field" htmlFor="date-to"><span className="date-label">To</span>
        <input type="date" id="date-to" value={b} min={min} max={max} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? 'range-error' : undefined} onChange={(e) => { setB(e.target.value); setError('') }} />
      </label>
      <button className="btn-primary" type="submit" disabled={disabled}><Icon name="search" size={14} />Search</button>
      {error && (
        <div className="range-error" id="range-error" role="alert" ref={errorRef}>
          <span className="range-error-icon" aria-hidden="true">!</span>
          <span>{error}</span>
          <button type="button" className="range-swap" onClick={() => { setA(b); setB(a); setError(''); onApply(b, a) }}>Swap dates</button>
          <button type="button" className="range-close" aria-label="Dismiss this message" title="Dismiss" onClick={() => setError('')}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      )}
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
  // The clicked row may be from a previous date range; use the current response.
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
