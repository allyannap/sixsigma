import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AISummary from './components/AISummary.jsx'

const summaryState = (tone) => ({ loading: false, error: null, reload() {}, data: {
  status: 'ok', label: 'ignored API label', tone,
  finding: 'New York State has a **recent change**, while goal attainment remains uncertain.',
  next_step: 'Review the flagged periods and related call records.',
  full_briefing: 'The expanded briefing adds more context about the selected result. It stays grounded in the same evidence.',
  selection: { name: 'New York State', from: '2026-09-01', to: '2026-10-15', urgency: ['red'] },
} })

describe('AI summary card', () => {
  it('uses legend status/color and renders the short summary with emphasis', () => {
    const html = renderToString(h(AISummary, { state: summaryState('watch'), enabled: true, paused: false, fixtures: false }))
    expect(html).toContain('ai-tone-watch')
    expect(html).toContain('ai-status-watch')
    expect(html).toContain('AI Summary')
    expect(html).toContain('Watch')
    expect(html).toContain('<strong>recent change</strong>')
    expect(html).toContain('<strong>Next:</strong>')
    expect(html).toContain('Review the flagged periods and related call records.')
    expect(html).toContain('Read full briefing')
    expect(html).toContain('The expanded briefing adds more context about the selected result.')
    expect(html).toContain('comparison-drawer')
  })

  it('falls back to the legend no-data status for an unknown tier', () => {
    const html = renderToString(h(AISummary, { state: summaryState('neon'), enabled: true, paused: false, fixtures: false }))
    expect(html).toContain('ai-tone-nodata')
    expect(html).toContain('ai-status-nodata')
    expect(html).toContain('Too few calls')
    expect(html).not.toContain('ai-tone-neon')
  })
})
