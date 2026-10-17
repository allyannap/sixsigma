import { Children, useEffect, useRef, useState } from 'react'
import '../insights.css'

// The chart ids the investigation links point at, in slide order (slide 1 = section-4, slide 2 = section-2).
export const SLIDE_IDS = ['section-4', 'section-2']
export const SLIDE_TITLES = ['Across areas', 'Change over time']

/** Which slide a "#section-N" link points at, or -1 when it is not one of ours. */
export function slideForHash(hash) {
  return SLIDE_IDS.indexOf(String(hash || '').replace(/^#/, ''))
}

/** One big card that shows one chart at a time. Every slide stays mounted so its data and state persist. */
export default function InsightsSlider({ children }) {
  const slides = Children.toArray(children)
  const last = slides.length - 1
  const [index, setIndex] = useState(0)
  const root = useRef(null)

  const go = (i) => setIndex(Math.max(0, Math.min(last, i)))

  // A link or hash that targets a hidden slide switches to it, then scrolls to it.
  useEffect(() => {
    const show = (hash, scroll) => {
      const i = slideForHash(hash)
      if (i < 0 || i > last) return
      setIndex(i)
      if (scroll) setTimeout(() => { const el = document.getElementById(hash.replace(/^#/, '')); if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }) }, 0)
    }
    show(window.location.hash, false)
    const onHash = () => show(window.location.hash, true)
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href^="#section-"]')
      if (a) show(a.getAttribute('href'), true)
    }
    window.addEventListener('hashchange', onHash)
    document.addEventListener('click', onClick)
    return () => { window.removeEventListener('hashchange', onHash); document.removeEventListener('click', onClick) }
  }, [last])

  const onKeyDown = (event, current) => {
    let next
    if (event.key === 'ArrowRight') next = (current + 1) % slides.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + slides.length) % slides.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    else return
    event.preventDefault()
    go(next)
    root.current.querySelector(`#insight-tab-${next}`)?.focus()
  }

  return (
    <div className="card insights-slider" ref={root}>
      <div className="slider-bar" role="tablist" aria-label="Insight charts">
        {slides.map((_, i) => <button type="button" role="tab" id={`insight-tab-${i}`} key={i}
          aria-selected={index === i} aria-controls={`insight-panel-${i}`} tabIndex={index === i ? 0 : -1}
          onClick={() => go(i)} onKeyDown={(event) => onKeyDown(event, i)}>{SLIDE_TITLES[i]}</button>)}
      </div>
      <div className="slider-track">
        {slides.map((s, i) => (
          <div key={i} className={`slide${i === index ? ' is-active' : ''}`} hidden={i !== index} id={`insight-panel-${i}`} role="tabpanel" aria-labelledby={`insight-tab-${i}`}>
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}
