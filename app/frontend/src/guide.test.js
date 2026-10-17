// The "How it works" guide: the target table is read from /api/meta (here the saved fixture, identical to
// config/targets.csv), and "target" (minutes per call) is kept apart from "goal" (share of calls on time).
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import HowItWorks, { targetGrid } from './components/HowItWorks.jsx'
import TopBar from './components/TopBar.jsx'
import { SPEC } from './status.js'
import meta from './fixtures/meta.json'

const plain = (s) => s.replace(/<!-- -->/g, '')
const page = (i) => plain(renderToString(h(HowItWorks, { open: true, onClose() {}, targets: meta.targets, initialPage: i })))

describe('guide: target table', () => {
  it('known answer: minutes by call urgency and area type match config/targets.csv, goal 90%', () => {
    const { grid, goals, empty } = targetGrid(meta.targets)
    expect(empty).toBe(false)
    expect(goals).toEqual([90])
    const cells = Object.fromEntries(grid.map((r) => [r.num, r.cells]))
    expect(cells[1]).toEqual({ urban: '8', suburban: '10', rural: '14', remote: '14' })
    expect(cells[2]).toEqual({ urban: '15', suburban: '15', rural: '15', remote: '15' })
    expect(cells[3]).toEqual({ urban: '30', suburban: '30', rural: '30', remote: '30' })
    expect(grid.map((r) => r.codes)).toEqual(['0-2', '3-5', '6-9'])
  })
  it('degenerate: no rows gives an empty table and "—" cells; mixed targets in one cell show a range', () => {
    const none = targetGrid([])
    expect(none.empty).toBe(true)
    expect(none.goals).toEqual([])
    expect(none.grid[0].cells.urban).toBe('—')
    expect(targetGrid(undefined).empty).toBe(true)
    const mixed = targetGrid([
      { urgency_code: 0, urban_rural: 'urban', urgency_group: 'red', target_s: 460, goal_on_time_pct: 90 },
      { urgency_code: 1, urban_rural: 'urban', urgency_group: 'red', target_s: 480, goal_on_time_pct: 90 },
    ])
    expect(mixed.grid[0].cells.urban).toBe('7.7–8')
  })
})

describe('guide: pages', () => {
  it('page 1 defines target and goal and draws the table with numbers, not colours, for urgency', () => {
    const html = page(0)
    expect(html).toContain('1 of 4')
    expect(html).toMatch(/<dt>Target<\/dt><dd>how fast one call should be reached/)
    expect(html).toMatch(/<dt>Goal<\/dt><dd>at least 90% of calls reached within their target/)
    expect(html).toContain('Most urgent')
    expect(html).not.toMatch(/>Red|>Yellow|>Green/)
    expect(html).toContain('NFPA 1720 sets no fixed time for remote areas')
  })
  it('page 2 explains every map colour; page 4 how to use it and the data caveats', () => {
    const two = page(1)
    for (const t of ['Critical', 'Watch', 'Near goal', 'Stable', 'Too few calls']) expect(two).toContain(`<strong>${t}</strong>`)
    const four = page(3)
    expect(four).toContain('Investigate')
    expect(four).toContain('Simulated data')
    expect(four).toContain('>Start<')
  })
  it('page 3 explains every table label, in ranking order, and the watch tag', async () => {
    const { QUEUE, QUEUE_ORDER } = await import('./status.js')
    const three = page(2)
    expect(three).toContain('What the table labels mean')
    const at = QUEUE_ORDER.map((k) => three.indexOf(`${QUEUE[k].short}</span>`))
    expect(at.every((i) => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(three).toContain('long-running problem')
    expect(three).toContain('Not a pass')
    expect(three).toContain('chip-watch')
    expect(three).toContain('not confirmed yet')
  })
})

describe('target vs goal wording', () => {
  it('the place judgment says goal, never target', () => {
    expect(SPEC.below.label).toBe('Below goal')
    expect(SPEC.meets.label).toBe('Meets goal')
  })
  it('the top bar has a "How it works" button instead of the old info tooltip', () => {
    const noop = () => {}
    const html = renderToString(h(TopBar, { dataset: 'baseline', datasets: ['baseline'], onDataset: noop, replay: { on: false }, fixtures: false, replayHandlers: {}, onHelp: noop }))
    expect(html).toContain('>How it works</button>')
    expect(html).not.toContain('data-def')
  })
})
