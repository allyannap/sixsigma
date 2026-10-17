import { describe, expect, it } from 'vitest'
import { apiUrl, buildQuery, isFixtureMode } from './api.js'

describe('query building', () => {
  it('joins urgency lists with commas and drops empty values', () => {
    const q = buildQuery({ dataset: 'baseline', from: '', to: undefined, urgency: ['red', 'yellow'], id: null })
    expect(q).toBe('dataset=baseline&urgency=red%2Cyellow')
  })
  it('builds endpoint URLs on the same origin', () => {
    expect(apiUrl('summary', { level: 'county', id: '36061' })).toBe('/api/summary?level=county&id=36061')
    expect(apiUrl('anom')).toBe('/api/anom')
  })
  it('only uses fixtures with ?fixtures=1', () => {
    expect(isFixtureMode('?fixtures=1')).toBe(true)
    expect(isFixtureMode('')).toBe(false)
    expect(isFixtureMode('?fixtures=0')).toBe(false)
  })
})
