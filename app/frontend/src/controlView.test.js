import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import { ControlView, ControlMethod, DescriptiveTrendChart, PChart, SignalList } from './components/ChangeSection.jsx'
import pchart from './fixtures/pchart.json'

const render = (p) => renderToString(h(ControlView, { p, selectedName: 'Monroe', params: {} })).replace(/<!-- -->/g, '')

it('leads with the confirmed finding and pairs the chart with one selectable period card', () => {
  const html = render(pchart)
  expect(html).toContain('Recent increase detected')
  expect(html).toContain('Monroe (fixture)')
  expect(html).toContain('control-baseline-detail')
  expect(html).toContain('simple-split control-split')
  expect(html).toContain('Selected period overview')
  expect(html).toContain('Response details')
  expect(html).toContain('role="group" aria-label="Selected area"')
  expect(html).toContain('<span class="response-context-chip">Monroe (fixture)</span>')
  expect(html).toContain('Monroe (fixture)')
  expect(html).toContain('role="group" aria-label="Selected date range and call urgency"')
  expect(html).toContain('<div class="response-filter-text"')
  expect(html).toContain('Jul 1, 2026 – Aug 31, 2026')
  expect(html).toContain('Call urgency 1 (most urgent)')
  expect(html).not.toContain('<span class="response-context-chip">Jul 1')
  expect(html).toContain('Review calls')
  expect(html).toContain('Baseline: 6.3%')
  expect(html).toContain('Upper control limit')
  expect(html).toContain('Calls missing target (%)')
  expect(html).not.toContain('>UCL<')
  expect(html).not.toContain('>CL<')
})

it('keeps the watch judgment in Method without adding a card banner', () => {
  const html = render({ ...pchart, control: 'in_control', watch: true, signals: pchart.signals.slice(0, 1) })
  expect(html.split('<dialog')[0]).not.toContain('Change not confirmed')
  expect(html.split('<dialog')[0]).not.toContain('above limit · Next')
  expect(html).not.toContain('Watching one signal')
  expect(html).not.toContain('Recent increase detected')
  expect(renderToString(h(ControlMethod, { p: pchart }))).toContain('two unusual periods, or one exceptionally strong signal')
})

it('omits the empty neutral banner when there is no change or watch and explains the service-goal distinction', () => {
  const html = render({ ...pchart, control: 'in_control', watch: false, signals: [], points: pchart.points.map((p) => ({ ...p, p: pchart.p_bar, signal: false })) })
  const card = html.split('<dialog')[0]
  expect(card).not.toContain('No confirmed increase')
  expect(card).not.toContain('control-finding')
  expect(renderToString(h(ControlMethod, { p: pchart }))).toContain('does not mean the service goal is met')
  expect(html).not.toContain('Review calls')
})

it('withholds the chart with inadequate or unstable history, even when points exist', () => {
  for (const stable of [true, false]) {
    const html = render({ ...pchart, control: 'insufficient_baseline', baseline: { ...pchart.baseline, stable } })
    expect(html).not.toContain('class="chart control-chart"')
    expect(html).toContain('We cannot judge change yet')
    if (!stable) expect(html).toContain('The baseline is not stable')
  }
})

it('shows sparse ZIP history as a descriptive trend with call counts and Wilson intervals, without control signals', () => {
  const points = [
    { start: '2026-09-07', n: 3, late: 1, p: 1 / 3, ci: [0.0615, 0.7923] },
    { start: '2026-09-14', n: 5, late: 2, p: 0.4, ci: [0.1176, 0.7693] },
  ]
  const p = {
    ...pchart,
    selection: { ...pchart.selection, level: 'zcta', name: '06390', from: '2026-09-07', to: '2026-09-20' },
    control: 'insufficient_baseline', unit: null, points: [], signals: [],
    control_reason: 'fewer than 30 baseline calls',
    descriptive_trend: { unit: 'week', interval: '95% Wilson (pointwise)', points,
      selected_range: { n: 8, late: 3, p: 3 / 8, ci: [0.1368, 0.6943] } },
  }
  const html = render(p)
  expect(html).toContain('ZIP 06390 · observed trend')
  expect(html).toContain('Late = on-scene arrival after the configured target.')
  expect(html).toContain('Sep 7–Sep 20 · 8 valid calls')
  expect(html).toContain('<strong>37.5%</strong> over target')
  expect(html).toContain('· 3 of 8 valid calls')
  expect(html).toContain('Calls over target (%)')
  expect(html).toContain('Evidence')
  expect(html).toContain('>Date</text>')
  expect(html).toContain('Uncertainty range')
  expect(html).not.toContain('Explore a week')
  expect(html).not.toContain('Wilson')
  expect(html).not.toContain('Upper control limit')
  expect(html).not.toContain('Flagged periods (0)')
  expect(html).toContain('control-tab-period')
  expect(html).toContain('descriptive-period-card')
  expect(html).toContain('control-tab-calls')
  expect(html).not.toContain('control-tab-stages')
  expect(html).not.toContain('control-tab-method')
  expect(html).toContain('<summary>Method</summary>')
  expect(html.match(/>Evidence /g)).toHaveLength(1)
  expect(renderToString(h(ControlMethod, { p })).replace(/<!-- -->/g, '')).toContain('no significance test or change signal is calculated')
  const chart = renderToString(h(DescriptiveTrendChart, { d: { ...p.descriptive_trend, selection: p.selection } }))
  expect(chart).not.toMatch(/NaN|Infinity/)
})

it('shows a single panel with accessible tabs and point selection', () => {
  const html = render(pchart)
  expect(html).toContain('<details class="response-method-dropdown"')
  expect(html).toContain('<summary>Method</summary>')
  expect(html).toContain('role="tablist"')
  expect((html.match(/role="tabpanel"/g) || []).length).toBe(1)
  expect(html).toContain('aria-labelledby="control-tab-period"')
  expect(html).toContain('role="button" tabindex="0"')
  expect(html).toContain('aria-controls="control-selected"')
  expect(html).toContain('left and right arrows')
  expect(html).toContain('<label for="control-period">')
})

it('keeps the percent axis at or below 100 and handles a lone point or empty selection', () => {
  const p = { ...pchart, points: [{ ...pchart.points[0], p: 1, ucl: 1 }] }
  const html = renderToString(h(PChart, { d: p, selected: p.points[0].start, onSelect() {} })).replace(/<!-- -->/g, '')
  expect(html).toContain('100%')
  expect(html).not.toContain('125%')
  expect(html).not.toMatch(/NaN|Infinity/)
  expect(render({ ...pchart, points: [] })).toContain('No periods available')
})

it('explains upper-limit crossings visibly without treating every crossing as a confirmed signal', () => {
  // the selected card opens on the last period: put that one above its limit (the fixture's last, partial week is within limits)
  const points = pchart.points.map((pt, i, all) => ({ ...pt, signal: false, ...(i === all.length - 1 ? { p: Math.min(1, pt.ucl + 0.05) } : {}) }))
  const html = render({ ...pchart, points, signals: [], control: 'in_control', watch: false })
  expect(html).not.toContain('How to read this chart')
  expect(html).toContain('class="control-limit-label">Upper control limit')
  expect(html).toContain('Upper limit')
  expect(html).not.toContain('above limit · Next')
  expect(html).toContain('Over upper limit')
  expect(html.split('<dialog')[0]).not.toContain('No confirmed increase')
  expect(html).not.toContain('Recent increase detected')
})

it('lists every highlighted day while retaining the one-signal watch judgment', () => {
  const points = [
    { start: '2026-08-06', n: 355, late: 47, p: 47/355, ucl: .127, lcl: .039, signal: true, p_value: .001 },
    { start: '2026-09-06', n: 353, late: 46, p: 46/353, ucl: .127, lcl: .039, signal: false, p_value: .002 },
    { start: '2026-09-11', n: 350, late: 12, p: 12/350, ucl: .127, lcl: .039, signal: false, p_value: 1 },
    { start: '2026-09-12', n: 350, late: 13, p: 13/350, ucl: .127, lcl: .039, signal: false, p_value: 1 },
    { start: '2026-09-13', n: 350, late: 29, p: 29/350, ucl: .127, lcl: .039, signal: false, p_value: .5 },
  ]
  const html = render({ ...pchart, points, signals: [points[0]], control: 'in_control', watch: true })
  expect(html).toContain('Flagged periods (4)')
  const table = renderToString(h(SignalList, { p: { ...pchart, points }, onReview() {} }))
  expect((table.match(/>show calls</g) || []).length).toBe(4)
  expect(table).toContain('Above upper limit')
  expect(table).toContain('Below lower limit')
  expect(table).toContain('Sep 6')
  expect(table).toContain('Sep 11')
  expect(table).toContain('Sep 12')

  expect(html.split('<dialog')[0]).not.toContain('Change not confirmed')
  expect(html).not.toContain('Watching one signal')
  expect(html).not.toContain('Recent increase detected')
})

it('uses the actual partial period in point descriptions, selected card, selector and flagged table', () => {
  const selection = { ...pchart.selection, from: '2026-07-01', to: '2026-07-03' }
  const point = { ...pchart.points[0], start: '2026-06-29' }
  const html = render({ ...pchart, selection, points: [point], signals: [point] })
  expect(html).toContain('Jul 1–Jul 3')
  expect(html).not.toContain('Jun 29:')
  expect(html).not.toContain('>Jun 29<')
  expect(html).toContain('value="2026-06-29"') // stable subgroup ID; only the visible range is clipped
  expect(html).not.toMatch(/NaN|Infinity/)
})

it('keeps call tables and method explanations outside the compact card in a closed drawer', () => {
  const html = render(pchart)
  const compact = html.split('<dialog')[0]
  expect(compact).toContain('Details &amp; evidence')
  expect(compact).not.toContain('Historical rate')
  expect(compact).not.toContain('control-support-panel')
  expect(compact).not.toContain('control-tabs')
  expect(html).toContain('aria-labelledby="trend-drawer-title"')
  expect(html).not.toMatch(/<dialog[^>]*\sopen(?:\s|=|>)/)
  expect(html).toContain('control-tab-calls')
  expect(html).not.toContain('control-tab-method')
  expect(html).toContain('<summary>Method</summary>')
})
