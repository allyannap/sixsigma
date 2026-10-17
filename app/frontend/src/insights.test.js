// The slide card under "<Place> Wait Time Insights": one chart at a time, arrow to the next.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import summary from './fixtures/summary_state.json'
import pchart from './fixtures/pchart.json'
import imr from './fixtures/imr.json'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import { InsightsSection } from './components/MetricsSection.jsx'
import { slideForHash } from './components/InsightsSlider.jsx'

const plain = (html) => html.replace(/<!-- -->/g, '')
const ok = (data) => ({ data, loading: false, error: null, reload() {} })
const html = plain(renderToString(h(InsightsSection, { placeName: 'Monroe', selection: summary.selection, dataset: 'baseline' },
  h(AnomSection, { summaryState: ok(summary) }),
  h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'Monroe' }))))

describe('Insights slide card', () => {
  it('has one slider card, not the two-column grid', () => {
    expect(html).toContain('insights-slider')
    expect(html).not.toContain('chart-grid')
  })
  it('shows "Are calls arriving on time?" first and the next arrow with its label', () => {
    expect(html).toContain('aria-label="Next chart: Are late calls being unusually frequent?"')
    expect(html).not.toContain('slider-prev')
    expect(html).toContain('1 / 2')
  })
  it('keeps slide 2 in the DOM but hidden, and slide 1 visible', () => {
    const slides = html.split(/<div class="slide[ "]/).slice(1)
    expect(slides).toHaveLength(2)
    expect(slides[0]).toContain('is-active')
    expect(slides[0]).not.toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toContain('Are late calls being unusually frequent?')
    expect(slides[1]).toContain('Stand-in')
  })
  it('maps the investigation links to slides', () => {
    expect(slideForHash('#section-4')).toBe(0)
    expect(slideForHash('#section-2')).toBe(1)
    expect(slideForHash('#other')).toBe(-1)
  })
})
