import { describe, expect, it } from 'vitest'
import { addDays, fmtChanceBelow, fmtCi, fmtDate, fmtInt, fmtNum, fmtPct, fmtRange, fmtVolume, mmss, periodEnd } from './format.js'

describe('formatters', () => {
  it('turns seconds into m:ss', () => {
    expect(mmss(485)).toBe('8:05')
    expect(mmss(60)).toBe('1:00')
    expect(mmss(-75)).toBe('-1:15')
  })
  it('shows n/a for missing numbers, never NaN or 0', () => {
    expect(fmtNum(null)).toBe('n/a')
    expect(fmtPct(undefined)).toBe('n/a')
    expect(fmtInt(NaN)).toBe('n/a')
    expect(mmss(null)).toBe('n/a')
  })
  it('formats numbers, percents and dates', () => {
    expect(fmtInt(12345)).toBe('12,345')
    expect(fmtPct(12.34)).toBe('12.3%')
    expect(fmtDate('2026-09-16')).toBe('Sep 16')
    expect(fmtRange({ from: '2026-09-16', to: '2026-10-15' })).toBe('Sep 16 to Oct 15, 2026')
  })
  it('adds calendar days across months and DST', () => {
    expect(addDays('2026-10-15', -89)).toBe('2026-07-18')
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01')
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09')
  })
  it('confidence intervals', () => {
    expect(fmtCi([80.64, 90.6], '%')).toBe('80.6% to 90.6%')
    expect(fmtCi([1, 2.25])).toBe('1.0 to 2.3')
    expect(fmtCi([null, 3])).toBe('n/a to 3.0')
    expect(fmtCi([15.6, null])).toBe('15.6 to n/a')
    expect(fmtCi([null, null])).toBe('n/a')
    expect(fmtCi(null)).toBe('n/a')
  })
  it('period end: day, week, month, clipped to the last day of the selection', () => {
    expect(periodEnd('2026-07-06', 'day', '2026-08-31')).toBe('2026-07-06')
    expect(periodEnd('2026-07-06', 'week', '2026-08-31')).toBe('2026-07-12')
    expect(periodEnd('2026-08-31', 'week', '2026-08-31')).toBe('2026-08-31')
    expect(periodEnd('2026-07-01', 'month', '2026-12-31')).toBe('2026-07-31')
    expect(periodEnd('2026-02-01', 'month', '2026-12-31')).toBe('2026-02-28')
    expect(periodEnd('2026-10-01', 'month', '2026-10-15')).toBe('2026-10-15')
  })
  it('chance-below sentence and volume line', () => {
    const s = fmtChanceBelow({ expected: 1.85, n_places: 60, observed_below: 23 }, 'counties')
    expect(s).toContain('would read Below by chance alone if every place were exactly at the goal')
    expect(s).toContain('1.9')
    expect(s).toContain('of 60 counties')
    expect(fmtChanceBelow({ expected: null, n_places: 0, observed_below: 0 })).toBe('')
    expect(fmtVolume(20.24, 15.43)).toBe('20.2 calls/day now vs 15.4 in the baseline')
  })
})
