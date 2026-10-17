import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { expect, it } from 'vitest'
import AnomSection from './components/AnomSection.jsx'
import summary from './fixtures/summary_state.json'

const render = (data, extra = {}) => renderToString(h(AnomSection, {
  summaryState: { data, loading: false, error: null, ...extra },
})).replace(/<!-- -->/g, '')

it('uses the branch 4B histogram as the only Section 4 comparison', () => {
  const html = render(summary)
  expect(html).toContain('id="section-4"')
  expect(html).toContain('Are calls arriving on time?')
  expect(html).toContain('class="hist"')
  expect(html).not.toContain('response-row')
  expect(html).not.toContain('section-4-simple')
})

it('handles loading, errors and older server responses', () => {
  expect(render(summary, { loading: true })).toContain('Loading...')
  expect(render(summary, { error: 'offline' })).toContain('Try again')
  const places = summary.places.map(({ response_profile, ...place }) => place)
  expect(render({ ...summary, places })).toContain('Restart the dashboard server')
})
