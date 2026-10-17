// Smoke test: every section renders from the fixture JSON without throwing, and shows the right words
// (the wording rules of EMS_RESPONSE_MONITOR_DECISIONS.md).
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import summary from './fixtures/summary_state.json'
import pchart from './fixtures/pchart.json'
import imr from './fixtures/imr.json'
import replay from './fixtures/replay.json'
import App from './App.jsx'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection from './components/ChangeSection.jsx'
import InvestigationSection, { investigationRows } from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import ReplayBar from './components/ReplayBar.jsx'

// React puts <!-- --> between text pieces; drop them so words can be searched.
const plain = (html) => html.replace(/<!-- -->/g, '')
const ok = (data) => ({ data, loading: false, error: null, reload() {} })
const map = (extra = {}) => plain(renderToString(h(MapSection, {
  summaryState: ok(summary), parent: { level: 'state', name: 'New York State' }, urgency: ['red'],
  selected: { level: 'state', place: null }, onPick() {}, onBack() {}, onDrill() {}, ...extra,
})))

describe('sections render from fixtures', () => {
  it('section 1 shows n, on-time rate, CI, P95 and both badges for every place', () => {
    const html = map()
    expect(html).toContain('Which areas need review?')
    expect(html).toContain('On-time rate [95% CI]')
    expect(html).toContain('Target:')
    expect(html).toContain('Control:')
    for (const p of summary.places) expect(html).toContain(p.name)
    expect(html).toContain('no alert does not mean the target is met')
  })
  it('a selected place shows the evidence: interval, goal, signals, baseline', () => {
    const p = summary.places.find((x) => x.queue === 'act_now')
    const html = map({ selected: { level: 'county', id: p.id, name: p.name, place: p } })
    expect(html).toContain('Act now')
    expect(html).toContain('95% CI')
    expect(html).toContain('Signals:')
    expect(html).toContain('Baseline:')
  })
  it('section 2: control status, baseline explanation, signal evidence; I chart is optional', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('Out of control')
    expect(html).toContain('never overlaps the selected range')
    expect(html).toContain('above its upper control limit')
    expect(html).toContain('Optional, secondary')
    expect(html).toContain('does not set any status')
  })
  it('insufficient baseline is said plainly, with no chart', () => {
    const p = { ...pchart, unit: null, points: [], signals: [], control: 'insufficient_baseline', control_reason: 'low volume', dispersion: null }
    const html = plain(renderToString(h(ChangeSection, { pState: ok(p), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('Insufficient baseline')
    expect(html).not.toContain('p chart, limits vary with n')
  })
  it('section 3 lists flagged areas with their evidence, never a chosen fix', () => {
    const html = plain(renderToString(h(InvestigationSection, { summaryState: ok(summary), onPick() {} })))
    expect(html).toContain('Target evidence')
    expect(html).toContain('Control evidence')
    expect(html).toContain('does not choose or rank interventions')
    expect(investigationRows(summary.places).every((p) => ['act_now', 'ongoing_gap', 'recent_change'].includes(p.queue) || p.spec === 'below')).toBe(true)
  })
  it('section 4 geographic comparison is descriptive', () => {
    const html = plain(renderToString(h(AnomSection, { summaryState: ok(summary) })))
    expect(html).toContain('Geographic comparison')
    expect(html).toContain('not evidence of unfair service')
    const err = renderToString(h(AnomSection, { summaryState: { data: null, loading: false, error: 'statistics module not ready (HTTP 503)', reload() {} } }))
    expect(err).toContain('statistics module not ready')
  })
  it('replay is labelled Simulation / Replay and synthetic, with no entry form', () => {
    const html = plain(renderToString(h(ReplayBar, { replay: { on: true, playing: false, start: '2026-08-25', day: '2026-09-02' }, feedState: ok(replay), onStart() {}, onToggle() {}, onStep() {}, onStop() {} })))
    expect(html).toContain('Simulation / Replay')
    expect(html).toContain('Not live CAD')
    expect(html).toContain('baseline fixed')
    expect(html).toContain(replay.events[0].incident_id)
    expect(html).not.toMatch(/<input|<textarea/)
  })
  it('the whole page has no what-if card, no incident entry and says the data is synthetic', () => {
    const html = plain(renderToString(h(App)))
    expect(html).toContain('SYNTHETIC DATA')
    expect(html).not.toMatch(/which fix|what-if|helps most|add an ambulance|POST/i)
    expect(html).not.toMatch(/What Held Up the Call|travel-time difference|Google/i)
    expect(html).not.toMatch(/<textarea/)
    expect([...html.matchAll(/<input[^>]*type="([^"]+)"/g)].map((m) => m[1])).toEqual(['date', 'date'])
  })
})
