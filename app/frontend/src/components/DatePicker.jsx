// A date picker that only offers the days the analysis can use. The browser's own date box greys out days outside
// min/max, but its month/year menu still lists every year on some browsers (Safari, for example), so this draws its
// own small calendar: the month menu holds only the months from min to max, the arrows stop at those ends, and days
// outside min..max are disabled. Dates are ISO "YYYY-MM-DD" strings, done in UTC so no time zone shifts a day.
import { useEffect, useRef, useState } from 'react'
import { Icon } from './common.jsx'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const pad = (n) => String(n).padStart(2, '0')
/** (2026, 6, 18) -> "2026-07-18" (month is 0-based). */
export const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`
const partsOf = (s) => { const [y, m, d] = String(s).split('-').map(Number); return [y, m - 1, d] }
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m, d)).getUTCDay()
/** "2026-07-18" plus n days. */
export function addDaysIso(s, n) {
  const [y, m, d] = partsOf(s)
  const t = new Date(Date.UTC(y, m, d + n))
  return isoOf(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())
}
/** "2026-07-18" -> "Jul 18, 2026". */
export function fmtShort(s) {
  if (!s) return ''
  const [y, m, d] = partsOf(s)
  return `${MONTHS[m]} ${d}, ${y}`
}

/** Every month from min to max, in order: [{y, m, label}] ("Dec 2025"). Empty when either end is missing. */
export function monthsBetween(min, max) {
  if (!min || !max || min > max) return []
  const [y0, m0] = partsOf(min)
  const [y1, m1] = partsOf(max)
  const out = []
  for (let y = y0, m = m0; y < y1 || (y === y1 && m <= m1); m === 11 ? (y += 1, m = 0) : (m += 1)) {
    out.push({ y, m, label: `${MONTHS[m]} ${y}` })
  }
  return out
}

/** One month's grid: blanks (null) before day 1, then {day, iso, disabled} for each day (disabled outside min..max). */
export function monthCells(y, m, min, max) {
  const cells = Array(weekdayOf(y, m, 1)).fill(null)
  for (let d = 1; d <= daysIn(y, m); d += 1) {
    const iso = isoOf(y, m, d)
    cells.push({ day: d, iso, disabled: (min && iso < min) || (max && iso > max) })
  }
  return cells
}

const clamp = (s, min, max) => (min && s < min ? min : max && s > max ? max : s)

/**
 * props: id (on the button), labelledBy, label ("start" / "end", for the dialog name), value, min, max, disabled,
 * invalid, describedBy, onChange(iso), defaultOpen (tests).
 */
export default function DatePicker({ id, labelledBy, label, value, min, max, disabled, invalid, describedBy, onChange, defaultOpen = false }) {
  const months = monthsBetween(min, max)
  const usable = months.length > 0
  const anchor = clamp(value || max || min || '', min, max)
  const [open, setOpen] = useState(defaultOpen && usable)
  const [view, setView] = useState(() => (anchor ? partsOf(anchor).slice(0, 2) : [0, 0]))
  const [focusIso, setFocusIso] = useState(anchor)
  const boxRef = useRef(null)
  const triggerRef = useRef(null)
  const gridRef = useRef(null)

  const openPicker = () => {
    const a = clamp(value || max || min, min, max)
    setView(partsOf(a).slice(0, 2))
    setFocusIso(a)
    setOpen(true)
  }
  const close = (refocus) => {
    setOpen(false)
    if (refocus && triggerRef.current) triggerRef.current.focus()
  }

  // Close on a click outside, and on Escape (focus goes back to the button).
  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) close(false) }
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(true) } }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Keep keyboard focus on the focused day when it moves (arrow keys, or opening).
  useEffect(() => {
    if (!open || !gridRef.current) return
    const btn = gridRef.current.querySelector(`[data-iso="${focusIso}"]`)
    if (btn) btn.focus()
  }, [open, focusIso, view])

  const [vy, vm] = view
  const at = months.findIndex((x) => x.y === vy && x.m === vm)
  const go = (i) => { if (i >= 0 && i < months.length) setView([months[i].y, months[i].m]) }
  const pick = (iso) => { onChange(iso); close(true) }
  const onGridKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key]
    if (!step) return
    e.preventDefault()
    const next = clamp(addDaysIso(focusIso, step), min, max)
    setFocusIso(next)
    setView(partsOf(next).slice(0, 2))
  }

  return (
    <div className="date-picker" ref={boxRef}>
      <button type="button" id={id} ref={triggerRef} className="date-trigger" aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
        aria-haspopup="dialog" aria-expanded={open} aria-invalid={invalid || undefined} aria-describedby={describedBy}
        disabled={disabled || !usable} onClick={() => (open ? close(false) : openPicker())}>
        <span>{value ? fmtShort(value) : 'Pick a date'}</span>
        <Icon name="calendar" size={14} />
      </button>
      {open && (
        <div className="dp-pop" role="dialog" aria-label={label ? `Choose the ${label} date` : 'Choose a date'}>
          <div className="dp-head">
            <button type="button" className="dp-nav" aria-label="Previous month" disabled={at <= 0} onClick={() => go(at - 1)}>
              <Icon name="chev-left" size={14} />
            </button>
            <select aria-label="Month" value={at < 0 ? '' : String(at)} onChange={(e) => go(Number(e.target.value))}>
              {months.map((x, i) => <option key={x.label} value={String(i)}>{x.label}</option>)}
            </select>
            <button type="button" className="dp-nav" aria-label="Next month" disabled={at < 0 || at >= months.length - 1} onClick={() => go(at + 1)}>
              <Icon name="chev-right" size={14} />
            </button>
          </div>
          <div className="dp-grid" role="grid" ref={gridRef} onKeyDown={onGridKey} aria-label={`${MONTHS_LONG[vm]} ${vy}`}>
            {WEEKDAYS.map((w, i) => <span key={w} className="dp-wd" aria-hidden="true" title={WEEKDAYS_LONG[i]}>{w}</span>)}
            {monthCells(vy, vm, min, max).map((c, i) => (c ? (
              <button key={c.iso} type="button" data-iso={c.iso} className={`dp-day${c.iso === value ? ' is-selected' : ''}`}
                disabled={c.disabled} tabIndex={c.iso === focusIso ? 0 : -1} aria-pressed={c.iso === value}
                aria-label={`${WEEKDAYS_LONG[weekdayOf(vy, vm, c.day)]}, ${MONTHS_LONG[vm]} ${c.day}, ${vy}`}
                onClick={() => pick(c.iso)}>
                {c.day}
              </button>
            ) : <span key={`b${i}`} className="dp-blank" aria-hidden="true" />))}
          </div>
          <p className="dp-range">Available: {fmtShort(min)} to {fmtShort(max)}</p>
        </div>
      )}
    </div>
  )
}
