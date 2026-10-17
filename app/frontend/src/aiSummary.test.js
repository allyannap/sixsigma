import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { AISummary } from './components/MetricsSection.jsx'
import { placeFor } from './components/PlaceHead.jsx'
import { metricsSource } from './components/MetricsSection.jsx'
const selection = { name: 'Queens', from: '2026-09-01', to: '2026-10-15', urgency: ['red'] }
const render = (state, props = {}) => renderToString(h(AISummary, { state, enabled: true, ...props }))
const old = { data: { text: 'Old summary', selection, status: 'ok' } }
describe('AI summary selection states', () => {
  it('uses current selected-area metrics rather than the row captured before dates changed', () => {
    const selected = { level: 'zcta', id: '11368', place: { id: '11368', valid: 83 } }
    const current = { places: [{ id: '11368', valid: 68 }], totals: { valid: 999 } }
    const parent = { level: 'county', id: '36081' }
    expect(placeFor(current, selected, parent).valid).toBe(68)
    expect(metricsSource(current, selected, parent).valid).toBe(68)
    expect(metricsSource({ places: [], totals: current.totals }, selected, parent)).toBeNull()
  })
  it('shows exact dates, area and urgency with generated text', () => {
    for (const word of ['AI summary', 'Old summary', 'Queens', '2026-09-01', '2026-10-15', 'red', 'Ollama']) expect(render(old)).toContain(word)
  })
  it('hides old text while loading new evidence', () => {
    expect(render({ ...old, loading: true })).toContain('Reading the selected period')
    expect(render({ ...old, loading: true })).not.toContain('Old summary')
  })
  it('requires both dates and hides previous text', () => {
    expect(render(old, { enabled: false })).toContain('Select both From and To')
    expect(render(old, { enabled: false })).not.toContain('Old summary')
  })
  it('shows errors and a retry without old text', () => {
    const html = render({ ...old, error: 'Ollama usage limit reached.' })
    expect(html).toContain('Ollama usage limit reached.')
    expect(html).toContain('Retry summary')
    expect(html).not.toContain('Old summary')
  })
  it('pauses generation during replay and disables fixture generation', () => {
    expect(render(old, { paused: true })).toContain('Pause replay')
    expect(render(old, { fixtures: true })).toContain('disabled for test fixtures')
  })
  it('escapes model output', () => {
    const html = render({ data: { ...old.data, text: '<script>alert(1)</script>' } })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
