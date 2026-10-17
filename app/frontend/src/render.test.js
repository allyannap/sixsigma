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

// React puts <!-- --> between text pieces; drop them so words can be searched.
const plain = (html) => html.replace(/<!-- -->/g, '')
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
  it('wording: status is the shift test, red points are only bad days and calls', () => {
    const html = plain(renderToString(h(MapSection, {
      summaryState: ok(summary), parent: { level: 'state', name: 'New York State' }, urgency: ['red'],
      selected: { level: 'state', place: null }, onPick() {}, onBack() {}, onDrill() {},
    })))
    expect(html).toContain('Change vs before (z)')
    expect(html).toContain('Spread (P95 - median)')
    expect(html).toContain('tick at 10%')
    expect(html).toContain('Z &gt; 3')
    const sel = plain(renderToString(h(MapSection, {
      summaryState: ok(summary), parent: { level: 'state', name: 'New York State' }, urgency: ['red'],
      selected: { level: 'county', id: summary.places[0].id, name: 'A', place: summary.places[0] }, onPick() {}, onBack() {}, onDrill() {},
    })))
    expect(sel).toContain('&gt; 3 = real change')
    const change = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'X' })))
    expect(change).toContain('do not set the place&#x27;s status')
    expect(change).toContain('%')
  })
  it('p chart with unit null shows the low-volume note, not a chart', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok({ ...pchart, unit: null, points: [] }), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('Low volume: too few late calls per period for a p chart')
  })
  it('p chart shows fractions as percents (p_bar 0.12 = 12.0%)', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok({ ...pchart, unit: 'month' }), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('12.0% late')
    expect(html).toContain('by month')
  })
  it('fault tree shows the typical-late cause and the plain rule', () => {
    const html = plain(renderToString(h(MinutesSection, { delaysState: ok({ ...delays, causes: { ...delays.causes, typical_late: 7 } }), googleState: ok(google), selectedName: 'X' })))
    expect(html).toContain('Typical call is already late (long distance)')
    expect(html).toContain('most unusual for this place')
  })
  it('hides the Google part when it is not available, and shows API errors', () => {
    const html = renderToString(h(MinutesSection, { delaysState: ok(delays), googleState: ok({ ...google, available: false, messages: [] }), selectedName: 'X' }))
    expect(html).not.toContain('Ambulance vs Google')
    const err = renderToString(h(AnomSection, { anomState: { data: null, loading: false, error: 'statistics module not ready (HTTP 503)', reload() {} } }))
    expect(err).toContain('statistics module not ready')
  })
})
