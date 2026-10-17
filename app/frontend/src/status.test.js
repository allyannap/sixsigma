import { describe, expect, it } from 'vitest'
import { QUEUE, WATCH, attentionCount, attentionSplit, fillFor, latePct, legendRows, mapTier, rankPlaces } from './status.js'

describe('status helpers', () => {
  it('ranks by queue label, then confirmed below-goal first, then excess late calls (not raw late counts)', () => {
    const out = rankPlaces([
      { id: 'a', queue: 'meets_stable', spec: 'meets', late: 99, excess_late: -5 },
      { id: 'b', queue: 'act_now', spec: 'below', late: 40, excess_late: 2 },
      { id: 'c', queue: 'act_now', spec: 'below', late: 5, excess_late: 30 },
      { id: 'd', queue: 'needs_data', spec: 'inconclusive', late: 50, excess_late: 40 },
      { id: 'e', queue: 'needs_data', spec: 'below', late: 2, excess_late: 1 },
    ])
    // b has far more late calls than c, but c has more late calls beyond what the goal allows
    expect(out.map((p) => p.id)).toEqual(['c', 'b', 'e', 'd', 'a'])
  })
  it('a missing excess_late sorts last inside its group and does not break the sort', () => {
    const out = rankPlaces([
      { id: 'x', queue: 'ongoing_gap', spec: 'below', excess_late: null },
      { id: 'y', queue: 'ongoing_gap', spec: 'below', excess_late: 3 },
      { id: 'z', queue: 'ongoing_gap', spec: 'below' },
    ])
    expect(out[0].id).toBe('y')
    expect(rankPlaces(undefined)).toEqual([])
  })
  it('splits needs-review into recent signal (Act now + Recent change) and ongoing gaps', () => {
    expect(attentionSplit({ queue_counts: { act_now: 1, recent_change: 2, ongoing_gap: 16, needs_data: 9 } })).toEqual({ recent: 3, ongoing: 16, total: 19 })
    expect(attentionSplit({ places: [{ queue: 'act_now' }, { queue: 'ongoing_gap' }, { queue: 'ongoing_gap' }, { queue: 'needs_data' }] })).toEqual({ recent: 1, ongoing: 2, total: 3 })
    expect(attentionSplit(null).total).toBe(0)
  })
  it('wording: no "statistically stable" claim, watch is not confirmed, needs_data mentions too little baseline', () => {
    expect(QUEUE.meets_stable.label).toBe('Meets goal; no change signal')
    expect(JSON.stringify(QUEUE)).not.toMatch(/statistically stable/i)
    expect(QUEUE.needs_data.help).toContain('or confirmed below goal but too little baseline to judge change')
    expect(WATCH.tip).toBe('1 period above the limit, not confirmed')
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

describe('map colour groups (OnScene legend)', () => {
  const place = (queue, spec, valid) => ({ queue, spec, valid })
  it('keeps the confirmed groups from the queue label', () => {
    expect(mapTier(place('act_now', 'below', 200))).toBe('critical')
    expect(mapTier(place('ongoing_gap', 'below', 200))).toBe('watch')
    expect(mapTier(place('recent_change', 'meets', 200))).toBe('watch')
    expect(mapTier(place('meets_stable', 'meets', 200))).toBe('stable')
  })
  it('splits "Needs more data" so gray means only too few calls (the ZIP 10025 cases)', () => {
    // red calls: 318 valid, 91.8% on time, CI 88.3-94.4 includes the 90% goal, in control -> near goal, not gray
    expect(mapTier(place('needs_data', 'inconclusive', 318))).toBe('near')
    // yellow calls: 396 valid, 100% on time, but too few late calls to chart -> meets goal, not gray
    expect(mapTier(place('needs_data', 'meets', 396))).toBe('stable')
    // confirmed below goal while change cannot be judged -> watch, not gray
    expect(mapTier(place('needs_data', 'below', 120))).toBe('watch')
    // genuinely too few calls -> gray
    expect(mapTier(place('needs_data', 'inconclusive', 29))).toBe('nodata')
    expect(mapTier(undefined)).toBe('nodata')
  })
  it('legend rows count the places in each group, five rows in order', () => {
    const rows = legendRows([place('act_now', 'below', 90), place('ongoing_gap', 'below', 90), place('needs_data', 'below', 40),
      place('needs_data', 'inconclusive', 318), place('meets_stable', 'meets', 90), place('needs_data', 'inconclusive', 4)])
    expect(rows.map((r) => [r.label, r.count])).toEqual([['Critical', 1], ['Watch', 2], ['Near goal', 1], ['Stable', 1], ['Too few calls', 1]])
    expect(legendRows(null).map((r) => r.count)).toEqual([0, 0, 0, 0, 0])
  })
})
