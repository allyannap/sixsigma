import { Children, useEffect, useRef, useState } from 'react'
import '../insights.css'

// The chart ids the investigation links point at, in slide order (slide 1 = section-4, slide 2 = section-2).
export const SLIDE_IDS = ['section-4', 'section-2']
export const SLIDE_TITLES = ['Are calls arriving on time?', 'Are more calls missing their response target?']

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
  const labels = ['Area comparison', 'Response trends']

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

  const onTabKey = (event, current) => {
    const next = event.key === 'ArrowRight' ? (current + 1) % slides.length
      : event.key === 'ArrowLeft' ? (current + last) % slides.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? last : null
    if (next === null) return
    event.preventDefault()
    go(next)
    root.current.querySelector(`#insights-tab-${next}`)?.focus()
  }

  return (
    <div className="card insights-slider" ref={root}>
      <div className="insights-tabs" role="tablist" aria-label="Wait time insights">
        {slides.map((_, i) => <button key={i} type="button" id={`insights-tab-${i}`} role="tab"
          aria-selected={index === i} aria-controls={`insights-panel-${i}`} tabIndex={index === i ? 0 : -1}
          onClick={() => go(i)} onKeyDown={(event) => onTabKey(event, i)}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {i === 0 ? <><rect x="2" y="2" width="6" height="6" rx="1" /><rect x="12" y="2" width="6" height="6" rx="1" /><rect x="2" y="12" width="6" height="6" rx="1" /><rect x="12" y="12" width="6" height="6" rx="1" /></> : <><path d="M2 3v14h16" /><path d="m4 12 4-5 4 3 5-6" /></>}
          </svg>{labels[i] || SLIDE_TITLES[i]}
        </button>)}
      </div>
      <div className="slider-track">
        {slides.map((s, i) => <div key={i} id={`insights-panel-${i}`} className={`slide${i === index ? ' is-active' : ''}`}
          hidden={i !== index} role="tabpanel" aria-labelledby={`insights-tab-${i}`} tabIndex={0}>{s}</div>)}
      </div>
    </div>
  )
}
