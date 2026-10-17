// The user chip shows the team badge and name, not the old "QS / Quality supervisor / New York State" placeholder.
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import TopBar from './components/TopBar.jsx'

const noop = () => {}
const html = renderToString(h(TopBar, {
  dataset: 'baseline', datasets: ['baseline'], onDataset: noop, replay: { on: false }, fixtures: false,
  replayHandlers: { onStart: noop, onToggle: noop, onStep: noop, onStop: noop },
  onHelp: noop, onDocumentation: noop,
}))
const chip = html.slice(html.indexOf('class="user"'), html.indexOf('</header>'))

describe('top bar user chip', () => {
  it('shows the team name', () => expect(chip).toContain('Team Powerpuff Girls'))
  it('has no placeholder text', () => {
    expect(chip).not.toContain('New York State')
    expect(chip).not.toContain('QS')
    expect(chip).not.toContain('Quality supervisor')
  })
  it('shows the badge image with an accessible name', () => {
    expect(chip).toMatch(/<img[^>]*team-badge[^>]*alt="Team Powerpuff Girls"/)
  })
})

describe('top bar documentation access', () => {
  it('places Documentation immediately after How it works when both are available', () => {
    const guide = html.indexOf('>How it works</button>')
    const documentation = html.indexOf('>Documentation</button>')
    expect(guide).toBeGreaterThanOrEqual(0)
    expect(documentation).toBeGreaterThan(guide)
    expect(html.slice(guide, documentation)).toMatch(/>How it works<\/button><button[^>]*$/)
  })
})
