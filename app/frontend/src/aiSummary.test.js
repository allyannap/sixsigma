import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AISummary from './components/AISummary.jsx'
import { metricsSource } from './components/MetricsSection.jsx'
const selection = { name: 'Queens', from: '2026-09-01', to: '2026-10-15', urgency: ['red'] }
const old = { data: { status: 'ok', text: 'Selected-period briefing.', selection } }
const render = (state = old, extra = {}) => renderToString(h(AISummary, { state, enabled: true, ...extra }))
describe('AI briefing', () => {
  it('shows the selected dates, area, priority and provider beside generated text', () => {
    for (const text of ['Selected-period briefing.', 'Queens', '2026-09-01', '2026-10-15', 'red', 'Ollama', 'Synthetic data']) expect(render()).toContain(text)
  })
  it('hides previous prose while a new selection loads', () => {
    expect(render({ ...old, loading: true })).toContain('Reading the selected period')
    expect(render({ ...old, loading: true })).not.toContain('Selected-period briefing.')
  })
  it('does not show old prose for incomplete dates or provider errors', () => {
    expect(render(old, { enabled: false })).toContain('Select a complete date range')
    expect(render(old, { enabled: false })).not.toContain('Selected-period briefing.')
    const html = render({ ...old, error: 'Ollama usage limit reached.' })
    expect(html).toContain('Ollama usage limit reached.')
    expect(html).toContain('Retry summary')
    expect(html).not.toContain('Selected-period briefing.')
  })
  it('does not generate during replay playback or fixture demonstrations', () => {
    expect(render(old, { paused: true })).toContain('Pause replay')
    expect(render(old, { fixtures: true })).toContain('disabled for test fixtures')
  })
  it('treats generated text as text rather than executable markup', () => {
    const html = render({ data: { ...old.data, text: '<script>alert(1)</script>' } })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })
  it('keeps metric tiles aligned with the current area/date response', () => {
    const selected = { level: 'zcta', id: '11368', place: { id: '11368', valid: 83 } }
    const parent = { level: 'county', id: '36081' }
    const summary = { places: [{ id: '11368', valid: 68 }], totals: { valid: 1000 } }
    expect(metricsSource(summary, selected, parent).valid).toBe(68)
    expect(metricsSource({ ...summary, places: [] }, selected, parent)).toBeNull()
  })
})
