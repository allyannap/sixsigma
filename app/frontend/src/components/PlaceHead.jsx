// Right column, top: the selected place and the From / To date form. Its labels sit with the table (MapSection).
import { useEffect, useRef, useState } from 'react'
import { fmtDate, fmtInt } from '../format.js'
import { Icon } from './common.jsx'
import DatePicker from './DatePicker.jsx'

const LEVEL_WORD = { state: 'Statewide', county: 'County', zcta: 'ZIP area' }

/** "2026-10-02" -> "Oct 2, 2026" for the date-range message. */
const longDate = (iso) => `${fmtDate(iso)}, ${String(iso).slice(0, 4)}`

/** The end date is before the start date: say which dates, why it cannot run, and how to fix it. */
export function rangeMessage(from, to) {
  return `The end date (${longDate(to)}) is before the start date (${longDate(from)}), so there are no days to show. `
    + 'Pick an end date on or after the start date, or swap the two dates.'
}

/** A typed date outside the allowed range (the calendar greys these out, but a date can still be typed). */
export function boundsMessage(from, to, min, max) {
  if (min && from && from < min) {
    return `The start date (${longDate(from)}) is too early: the analysis compares each period with the 60 days before it, `
      + `and the data begins 60 days before ${longDate(min)}. Pick a start date on or after ${longDate(min)}.`
  }
  if (max && to && to > max) return `The end date (${longDate(to)}) is after the last day of data. Pick ${longDate(max)} or earlier.`
  if (max && from && from > max) return `The start date (${longDate(from)}) is after the last day of data. Pick ${longDate(max)} or earlier.`
  return ''
}

/**
 * min = the earliest start date (a full baseline before it), max = the last day of data. The calendars only allow
 * valid days: From runs from min to the chosen To, and To from the chosen From to max.
 */
function DateForm({ from, to, disabled, min, max, onApply }) {
  const [a, setA] = useState(from)
  const [b, setB] = useState(to)
  const [error, setError] = useState('')
  const [canSwap, setCanSwap] = useState(false)
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
    const outside = boundsMessage(a, b, min, max)
    if (outside) { setError(outside); setCanSwap(false); return }
    if (a && b && a > b) { setError(rangeMessage(a, b)); setCanSwap(true); return }
    setError('')
    onApply(a, b)
  }
  return (
    <form className="daterange" onSubmit={submit} noValidate aria-label="Date range" aria-describedby={disabled ? 'range-hint' : undefined}>
      <div className="date-field"><span className="date-label" id="date-from-label">From</span>
        <DatePicker id="date-from" labelledBy="date-from-label" label="start" value={a} min={min} max={b || max} disabled={disabled}
          invalid={!!error} describedBy={error ? 'range-error' : undefined} onChange={(v) => { setA(v); setError('') }} />
      </div>
      <span className="date-sep" aria-hidden="true">&ndash;</span>
      <div className="date-field"><span className="date-label" id="date-to-label">To</span>
        <DatePicker id="date-to" labelledBy="date-to-label" label="end" value={b} min={a || min} max={max} disabled={disabled}
          invalid={!!error} describedBy={error ? 'range-error' : undefined} onChange={(v) => { setB(v); setError('') }} />
      </div>
      <button className="btn-primary" type="submit" disabled={disabled}><Icon name="search" size={14} />Search</button>
      {error && (
        <div className="range-error" id="range-error" role="alert" ref={errorRef}>
          <span className="range-error-icon" aria-hidden="true">!</span>
          <span>{error}</span>
          {canSwap && <button type="button" className="range-swap" onClick={() => { setA(b); setB(a); setError(''); onApply(b, a) }}>Swap dates</button>}
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
