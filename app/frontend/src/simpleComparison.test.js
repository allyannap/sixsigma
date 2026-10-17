import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import SimpleComparison, { areaTag, comparisonAreas, extremes, goalGap, histogram, median, ordinal } from './components/SimpleComparison.jsx'
import summary from './fixtures/summary_state.json'

const render = (d) => renderToString(h(SimpleComparison, { d })).replace(/<!-- -->/g, '')
const a = (id, pct, spec = 'below', low_n = false) => ({ id, name: id, on_time_pct: pct, spec, response_profile: { n: low_n ? 5 : 100, low_n } })

it('defines the goal and shows the histogram as the main view beside one area card', () => {
  const html = render(summary)
  expect(html).toContain('Goal: 90% of calls arrive within their configured call target of call receipt.')
  const areas = comparisonAreas(summary.places)
  const selected = extremes(areas)[0] || areas[0]
  expect((html.match(/id="simple-selected"/g) || []).length).toBe(1)
  expect((html.match(/class="hist"/g) || []).length).toBe(1)
  expect(html).not.toContain('area-dot')
  expect(html).not.toContain('Grouped distribution (histogram)')
  expect(html).toContain(goalGap(selected))
  expect(html).toContain(`${ordinal(areas.indexOf(selected) + 1)} worst of ${areas.length}`)
  expect(html).toContain(`${areas.filter((p) => p.spec === 'below').length} of ${areas.length} areas`)
  for (const p of areas) expect(html).toContain(`<option value="${p.name}">`)
  expect(html).toContain('Search an area')
  expect(html).toContain('95% on-time uncertainty interval')
  expect(html).toContain('Slowest 1 in 10')
  expect((html.match(/id="simple-selected"/g) || []).length).toBe(1)
  expect(html).toContain('busy areas count more')
  expect(html).not.toContain('simple-result-rate')
})

it('ranks valid areas worst first, ties by name, and drops empty areas', () => {
  const areas = comparisonAreas([...summary.places, { id: 'empty', name: 'Empty', on_time_pct: 0, response_profile: { n: 0 } }])
  expect(areas.some((p) => p.id === 'empty')).toBe(false)
  for (let i = 1; i < areas.length; i++) expect(areas[i - 1].on_time_pct).toBeLessThanOrEqual(areas[i].on_time_pct)
  expect(comparisonAreas([a('B', 80), a('A', 80)]).map((p) => p.id)).toEqual(['A', 'B'])
})

it('picks the three lowest rates as extremes, skipping areas under 30 calls', () => {
  const areas = comparisonAreas([a('A', 95), a('B', 60), a('tiny', 10, 'below', true), a('C', 70), a('D', 65), a('E', 99)])
  expect(extremes(areas).map((p) => p.id)).toEqual(['B', 'D', 'C'])
  expect(extremes([a('tiny', 10, 'below', true)])).toEqual([])
})

it('bins areas in 10-point bands from the lowest band to 100%, counting every area once by status', () => {
  const areas = [a('A', 14), a('B', 19.9), a('C', 20), a('D', 88, 'inconclusive'), a('E', 94, 'meets'), a('F', 100, 'meets')]
  const bins = histogram(areas, 90)
  expect(bins.map((b) => b.from)).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90])
  expect(bins.map((b) => b.areas.length)).toEqual([2, 1, 0, 0, 0, 0, 0, 1, 2])
  expect(bins[7]).toMatchObject({ inconclusive: 1, below: 0 })
  expect(bins[8]).toMatchObject({ meets: 2 })
  expect(bins.reduce((s, b) => s + b.areas.length, 0)).toBe(areas.length)
  expect(histogram([a('X', 96, 'meets')], 90).map((b) => b.from)).toEqual([90])
  expect(histogram([a('X', 100, 'meets')], 100).map((b) => b.from)).toEqual([90])
})

it('computes the median area and English ordinals', () => {
  expect(median([40, 10, 30])).toBe(30)
  expect(median([10, 20, 30, 40])).toBe(25)
  expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 62].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '62nd'])
})

it('expresses the direct goal gap in percentage points, including above, equal and missing rates', () => {
  expect(goalGap({ on_time_pct: 14, goal_pct: 90 })).toBe('76.0 percentage points below goal')
  expect(goalGap({ on_time_pct: 95, goal_pct: 90 })).toBe('5.0 percentage points above goal')
  expect(goalGap({ on_time_pct: 90, goal_pct: 90 })).toBe('At the observed goal')
  expect(goalGap({ on_time_pct: null, goal_pct: 90 })).toBe('No valid rate')
})

it('handles empty, missing-profile and mixed-urgency selections', () => {
  expect(render({ ...summary, places: [] })).toContain('No valid completed calls')
  expect(render({ ...summary, places: [{ id: 'missing' }] })).toContain('Restart the dashboard server')
  expect(render({ ...summary, selection: { urgency: ['red', 'yellow'] } })).toContain('Choose one urgency group')
})

it('uses each urgency group’s configured minutes in the goal definition', () => {
  for (const [urgency, minutes] of [['yellow', 15], ['green', 30]]) {
    const d = { ...summary, selection: { ...summary.selection, urgency: [urgency] }, places: summary.places.map((p) => ({ ...p, response_profile: { ...p.response_profile, target_min: minutes } })) }
    expect(render(d)).toContain(`Goal: 90% of calls arrive within ${minutes} min of call receipt.`)
  }
})

it('labels an area by its main type, or as mixed when no type has 60% of calls', () => {
  expect(areaTag({ urban: 5, suburban: 10, rural: 78, remote: 7 })).toEqual({ kind: 'rural', text: 'Mostly rural · 78% of calls' })
  expect(areaTag({ urban: 60, suburban: 40, rural: 0, remote: 0 }).kind).toBe('urban')
  expect(areaTag({ urban: 45, suburban: 35, rural: 20, remote: 0 })).toEqual({ kind: 'mixed', text: 'Mixed · 45% urban, 35% suburban' })
  expect(areaTag(null)).toBe(null)
})
