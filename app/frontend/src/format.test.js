import { describe, expect, it } from 'vitest'
import { fmtDate, fmtInt, fmtNum, fmtPct, fmtRange, mmss } from './format.js'

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
})
