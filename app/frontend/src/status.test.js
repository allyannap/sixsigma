import { describe, expect, it } from 'vitest'
import { attentionCount, fillFor, rankPlaces } from './status.js'

describe('status helpers', () => {
  it('ranks by status first, then by late calls', () => {
    const out = rankPlaces([
      { id: 'a', status: 'on_track', late: 99 },
      { id: 'b', status: 'act_now', late: 1 },
      { id: 'c', status: 'act_now', late: 5 },
      { id: 'd', status: 'not_enough', late: 0 },
    ])
    expect(out.map((p) => p.id)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('uses needs_attention (an int), and counts places only if it is missing', () => {
    expect(attentionCount({ needs_attention: 3 })).toBe(3)
    expect(attentionCount({ needs_attention: 0 })).toBe(0)
    expect(attentionCount({ places: [{ status: 'act_now' }, { status: 'on_track' }] })).toBe(1)
  })
  it('darker fill for more late', () => {
    expect(fillFor('red', 0)).not.toBe(fillFor('red', 1))
  })
})
