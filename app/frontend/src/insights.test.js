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
  it('uses named tabs with explicit selected state and panel ownership', () => {
    expect(html).toContain('role="tablist" aria-label="Insight charts"')
    expect(html).toContain('aria-selected="true" aria-controls="insight-panel-0"')
    expect(html).toContain('>Across areas</button>')
    expect(html).toContain('>Change over time</button>')
    expect(html).not.toContain('slider-arrow')
    expect(html).not.toContain('slider-dot')
  })
  it('keeps the inactive panel mounted but hidden', () => {
    const slides = html.split(/<div class="slide[ "]/).slice(1)
    expect(slides).toHaveLength(2)
    expect(slides[0]).toContain('is-active')
    expect(slides[0]).not.toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toMatch(/^[^>]*\shidden=""/)
    expect(slides[1]).toContain('Are more calls missing their response target?')
    expect(slides[1]).toContain('aria-labelledby="insight-tab-1"')
  })
  it('maps the investigation links to slides', () => {
    expect(slideForHash('#section-4')).toBe(0)
    expect(slideForHash('#section-2')).toBe(1)
    expect(slideForHash('#other')).toBe(-1)
  })
})
