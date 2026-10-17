// Labeled insight tabs keep both charts mounted and preserve investigation links.
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
  it('replaces arrows and dots with two labeled tabs linked to their panels', () => {
    expect(html).toContain('role="tablist" aria-label="Wait time insights"')
    expect(html).toContain('Area comparison')
    expect(html).toContain('Response trends')
    expect(html).toContain('aria-selected="true" aria-controls="insights-panel-0" tabindex="0"')
    expect(html).toContain('aria-selected="false" aria-controls="insights-panel-1" tabindex="-1"')
    expect(html).not.toMatch(/slider-arrow|slider-dot|slider-count|aria-roledescription="carousel"/)
  })
  it('keeps slide 2 in the DOM but hidden, and slide 1 visible', () => {
    const slides = html.split(/<div id="insights-panel-\d+" class="slide[ "]/).slice(1)
    expect(slides).toHaveLength(2)
    expect(slides[0]).toContain('is-active')
    expect(slides[0]).not.toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toContain('Are more calls missing their response target?')
    expect(slides[1]).toContain('control-chart')
    expect(slides[1]).toContain('role="tabpanel" aria-labelledby="insights-tab-1"')
  })
  it('maps the investigation links to slides', () => {
    expect(slideForHash('#section-4')).toBe(0)
    expect(slideForHash('#section-2')).toBe(1)
    expect(slideForHash('#other')).toBe(-1)
  })
})
