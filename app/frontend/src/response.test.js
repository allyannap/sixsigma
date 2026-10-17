import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import AnomSection, { rankResponsePlaces, responsePage } from './components/AnomSection.jsx'
import summary from './fixtures/summary_state.json'

const render = (data, extra = {}) => renderToString(h(AnomSection, {
  summaryState: { data, loading: false, error: null, ...extra },
})).replace(/<!-- -->/g, '')

it('ranks worst first for each metric, keeps zero-sample areas last, and never mutates input', () => {
  const places = [
    { name: 'A', response_profile: { p90_min: 10, median_min: 8, over_target_pct: 20 } },
    { name: 'B', response_profile: { p90_min: 20, median_min: 5, over_target_pct: 10 } },
    { name: 'Empty', response_profile: { p90_min: null, median_min: null, over_target_pct: null } },
  ]
  expect(rankResponsePlaces(places, 'p90_min').map((p) => p.name)).toEqual(['B', 'A', 'Empty'])
  for (const key of ['median_min', 'over_target_pct']) expect(rankResponsePlaces(places, key)[0].name).toBe('A')
  expect(places[0].name).toBe('A')
})

it('shows five ranked areas, target and one detailed place card without hiding access to other areas', () => {
  const html = render(summary)
  const ranked = rankResponsePlaces(summary.places, 'p90_min')
  for (const p of ranked.slice(0, 5)) expect(html).toContain(p.name)
  expect(html).toContain(`Areas 1–5 of ${summary.places.length}`)
  expect((html.match(/class="response-row /g) || []).length).toBe(5)
  expect(html).toContain('Next five areas')
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('Details for ' + ranked[0].name)
  expect(html).toContain('8.0 min')
  expect(html).toContain('Slowest 1 in 10')
  expect(html).toContain('95% uncertainty interval')
  expect(html).toContain('Longest observed wait')
  expect(html).toContain('<summary>')
  expect(html).toContain('Rank areas by')
  expect(html).toContain('aria-describedby="response-read"')
})

it('handles missing, sparse, mixed urgency, mixed targets, loading and errors', () => {
  expect(render({ ...summary, places: [] })).toContain('No valid completed calls')
  expect(render({ ...summary, selection: { urgency: ['red', 'yellow'] } })).toContain('Select one urgency group')
  expect(render(summary, { loading: true })).toContain('Loading...')
  expect(render(summary, { error: 'offline' })).toContain('Try again')
  const p = summary.places[0]
  const sparse = { ...p, spec: 'inconclusive', response_profile: { ...p.response_profile, n: 1, low_n: true, target_min: null } }
  const html = render({ ...summary, places: [sparse] })
  expect(html).toContain('Limited data')
  expect(html).toContain('Targets vary by call')
  expect(html).toContain('Inconclusive')
})

it('identifies an older server response instead of claiming valid calls are missing', () => {
  const places = summary.places.map(({ response_profile, ...place }) => place)
  const html = render({ ...summary, places })
  expect(html).toContain('server needs a restart')
  expect(html).not.toContain('No valid completed calls in this selection')
  expect(html).toContain('role="alert"')
})


it('pagination reaches every area once and clamps pages after a smaller selection', () => {
  const rows = Array.from({ length: 62 }, (_, id) => ({ id }))
  const visited = Array.from({ length: 13 }, (_, page) => responsePage(rows, page).rows).flat()
  expect(visited).toEqual(rows)
  expect(responsePage(rows, 12).rows).toHaveLength(2)
  expect(responsePage(rows.slice(0, 3), 10)).toEqual({ current: 0, start: 0, rows: rows.slice(0, 3) })
  expect(responsePage([], 10)).toEqual({ current: 0, start: 0, rows: [] })
})
