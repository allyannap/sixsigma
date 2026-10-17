import { Children, useEffect, useRef, useState } from 'react'
import '../insights.css'

// The chart ids the investigation links point at, in slide order (slide 1 = section-4, slide 2 = section-2).
export const SLIDE_IDS = ['section-4', 'section-2']
export const SLIDE_TITLES = ['Are calls arriving on time?', 'Are late calls being unusually frequent?']

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

  const onKeyDown = (e) => {
    if (e.target.closest && e.target.closest('input, select, textarea')) return
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
  }

  return (
    <div className="card insights-slider" ref={root} role="group" aria-roledescription="carousel" aria-label="Wait time charts"
      tabIndex={0} onKeyDown={onKeyDown}>
      <div className="slider-bar">
        <span className="slider-count" aria-live="polite">{index + 1} / {slides.length}</span>
        <span className="slider-dots">
          {slides.map((_, i) => (
            <button key={i} type="button" className="slider-dot" aria-label={`Show chart ${i + 1}: ${SLIDE_TITLES[i] || ''}`}
              aria-current={i === index ? 'true' : undefined} onClick={() => go(i)} />
          ))}
        </span>
      </div>
      {index > 0 && (
        <button type="button" className="slider-arrow slider-prev" aria-label={`Previous chart: ${SLIDE_TITLES[index - 1] || ''}`} onClick={() => go(index - 1)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      {index < last && (
        <button type="button" className="slider-arrow slider-next" aria-label={`Next chart: ${SLIDE_TITLES[index + 1] || ''}`} onClick={() => go(index + 1)}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div className="slider-track">
        {slides.map((s, i) => (
          <div key={i} className={`slide${i === index ? ' is-active' : ''}`} hidden={i !== index} aria-hidden={i !== index} role="group"
            aria-roledescription="slide" aria-label={`${i + 1} of ${slides.length}`}>
            {s}
          </div>
        ))}
      </div>
    </div>
  )
}
