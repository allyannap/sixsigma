// Smoke test: every section renders from the fixture JSON without throwing, and shows the right words.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import summary from './fixtures/summary_state.json'
import anom from './fixtures/anom.json'
import pchart from './fixtures/pchart.json'
import imr from './fixtures/imr.json'
import delays from './fixtures/delays.json'
import google from './fixtures/google.json'
import whatif from './fixtures/whatif.json'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import FixSection from './components/FixSection.jsx'
import MapSection from './components/MapSection.jsx'
import MinutesSection from './components/MinutesSection.jsx'

const ok = (data) => ({ data, loading: false, error: null, reload() {} })

describe('sections render from fixtures', () => {
  it('section 1 table and legend', () => {
    const html = renderToString(h(MapSection, {
      summaryState: ok(summary), parent: { level: 'state', name: 'New York State' }, urgency: ['red'],
      selected: { level: 'state', place: null }, onPick() {}, onBack() {}, onDrill() {},
    }))
    expect(html).toContain('Which places need attention?')
    expect(html).toContain('Not enough calls (&lt;30 calls)')
    expect(html).toContain('Fixture County A')
  })
  it('sections 2 to 5', () => {
    expect(renderToString(h(AnomSection, { anomState: ok(anom) }))).toContain('consistently slower')
    expect(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'X' }))).toContain('p chart')
    expect(renderToString(h(MinutesSection, { delaysState: ok(delays), googleState: ok(google), selectedName: 'X' }))).toContain('Ambulance vs Google')
    expect(renderToString(h(FixSection, { whatifState: ok(whatif), fix: 'closer', pct: 25, onFix() {}, onPct() {}, selectedName: 'X' }))).toContain('Late calls avoided')
  })
  it('hides the Google part when it is not available, and shows API errors', () => {
    const html = renderToString(h(MinutesSection, { delaysState: ok(delays), googleState: ok({ ...google, available: false, messages: [] }), selectedName: 'X' }))
    expect(html).not.toContain('Ambulance vs Google')
    const err = renderToString(h(AnomSection, { anomState: { data: null, loading: false, error: 'statistics module not ready (HTTP 503)', reload() {} } }))
    expect(err).toContain('statistics module not ready')
  })
})
