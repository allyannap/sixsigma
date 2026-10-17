import { describe, expect, it } from 'vitest'
import { dotsPath, linear, logScale, logTicks } from './charts.js'

describe('chart helpers', () => {
  it('linear maps ends and middle', () => {
    const f = linear(0, 10, 100, 200)
    expect([f(0), f(5), f(10)]).toEqual([100, 150, 200])
  })
  it('log scale puts the geometric middle in the middle', () => {
    const f = logScale(1, 100, 0, 200)
    expect(f(10)).toBeCloseTo(100)
  })
  it('log ticks stay inside the range', () => {
    expect(logTicks(4, 30)).toEqual([5, 8, 10, 15, 20, 30])
  })
  it('dots become one path', () => {
    expect(dotsPath([[1, 2], [3, 4]])).toBe('M1.0 2.0h0M3.0 4.0h0')
  })
})
