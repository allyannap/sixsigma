import { describe, expect, it } from 'vitest'
import { QUEUE, attentionCount, fillFor, latePct, rankPlaces } from './status.js'

describe('status helpers', () => {
  it('ranks by queue label, then confirmed below-target first, then late calls', () => {
    const out = rankPlaces([
      { id: 'a', queue: 'meets_stable', spec: 'meets', late: 99 },
      { id: 'b', queue: 'act_now', spec: 'below', late: 1 },
      { id: 'c', queue: 'act_now', spec: 'below', late: 5 },
      { id: 'd', queue: 'needs_data', spec: 'inconclusive', late: 50 },
      { id: 'e', queue: 'needs_data', spec: 'below', late: 2 },
    ])
    expect(out.map((p) => p.id)).toEqual(['c', 'b', 'e', 'd', 'a'])
  })
  it('uses needs_attention (an int), and counts places only if it is missing', () => {
    expect(attentionCount({ needs_attention: 3 })).toBe(3)
    expect(attentionCount({ needs_attention: 0 })).toBe(0)
    expect(attentionCount({ places: [{ queue: 'act_now' }, { queue: 'needs_data' }, { queue: 'ongoing_gap' }] })).toBe(2)
  })
  it('inconclusive is never worded as a pass', () => {
    expect(QUEUE.needs_data.label).toMatch(/Inconclusive/)
    expect(QUEUE.needs_data.help).toMatch(/Not a pass/)
    expect(Object.values(QUEUE).map((q) => q.label)).not.toContain('On track')
  })
  it('late share and darker fill for more late', () => {
    expect(latePct({ on_time_pct: 86.5 })).toBeCloseTo(13.5)
    expect(latePct({})).toBe(null)
    expect(fillFor('red', 0)).not.toBe(fillFor('red', 1))
  })
})
