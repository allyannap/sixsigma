import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import SimpleComparison, { AreaChoices, comparisonAreas, goalGap } from './components/SimpleComparison.jsx'
import summary from './fixtures/summary_state.json'

const render = (d) => renderToString(h(SimpleComparison, { d })).replace(/<!-- -->/g, '')

it('defines the goal, shows three labeled choices and one selected result', () => {
  const html = render(summary)
  expect(html).toContain('Goal: 90% of calls arrive within 8 min of call receipt.')
  expect(html).toContain('Lowest on-time rates')
  expect((html.match(/class="area-choice /g) || []).length).toBe(3)
  expect(html).not.toContain('goal-bar')
  expect((html.match(/id="simple-selected"/g) || []).length).toBe(1)
  const areas = comparisonAreas(summary.places, '')
  for (const p of areas) expect(html).toContain(p.name)
  for (const p of summary.places) expect(html).toContain(`value="${p.id}"`)
  const selected = areas[0]
  expect(html).toContain(`${goalGap(selected)}`)
  expect(html).toContain(`${selected.response_profile.n} calls`)
  expect(html).toContain('95% on-time uncertainty interval')
  expect(html).toContain('slowest 1 in 10')
  expect(html).toContain('Longest wait:')
  expect(html).toContain('not an average of area percentages')
  expect(html).toContain('aria-controls="simple-selected"')
})

it('adds a fourth comparison area without duplicating a top-three area or including empty areas', () => {
  const base = comparisonAreas(summary.places, '')
  expect(comparisonAreas(summary.places, base[0].id)).toEqual(base)
  const extra = summary.places.find((p) => p.response_profile.n > 0 && !base.some((b) => b.id === p.id))
  expect(comparisonAreas(summary.places, extra.id)).toEqual([...base, extra])
  const empty = { id: 'empty', name: 'Empty', response_profile: { n: 0 } }
  expect(comparisonAreas([...summary.places, empty], 'empty')).toEqual(base)
})

it('keeps tied values distinct by name and exposes uncertainty without relying on color', () => {
  const areas = comparisonAreas(summary.places, '').map((p, i) => ({ ...p, on_time_pct: 95, spec: i === 0 ? 'inconclusive' : i === 1 ? 'below' : 'meets' }))
  const html = renderToString(h(AreaChoices, { areas, selectedId: areas[0].id, onSelect() {}, goal: 90 }))
  for (const p of areas) expect(html).toContain(p.name)
  for (const label of ['Uncertain', 'Below goal', 'Meets goal']) expect(html).toContain(label)
  expect(html).toContain('Uncertain')
  expect((html.match(/aria-pressed="true"/g) || []).length).toBe(1)
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
