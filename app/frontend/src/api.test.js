import { describe, expect, it } from 'vitest'
import { apiUrl, buildQuery, isFixtureMode } from './api.js'

describe('query building', () => {
  it('joins urgency lists with commas and drops empty values', () => {
    const q = buildQuery({ dataset: 'baseline', from: '', to: undefined, urgency: ['red', 'yellow'], id: null })
    expect(q).toBe('dataset=baseline&urgency=red%2Cyellow')
  })
  it('builds endpoint URLs on the same origin', () => {
    expect(apiUrl('summary', { level: 'county', id: '36061' })).toBe('./api/summary?level=county&id=36061')
    expect(apiUrl('anom')).toBe('./api/anom')
  })
  it('keeps API requests inside a Posit Connect content mount', () => {
    const appPage = 'https://connect.example/content/app-id/'
    expect(new URL(apiUrl('health'), appPage).pathname).toBe('/content/app-id/api/health')
  })
  it('builds the URLs of the new read-only routes', () => {
    expect(apiUrl('flagged', { dataset: 'baseline', urgency: ['red'] })).toBe('./api/flagged?dataset=baseline&urgency=red')
    expect(apiUrl('signal_calls', { level: 'county', id: '36055', start: '2026-07-06', end: '2026-07-12', limit: 50 }))
      .toBe('./api/signal_calls?level=county&id=36055&start=2026-07-06&end=2026-07-12&limit=50')
    expect(apiUrl('stages', { level: 'zcta', id: '11368' })).toBe('./api/stages?level=zcta&id=11368')
  })
  it('only uses fixtures with ?fixtures=1', () => {
    expect(isFixtureMode('?fixtures=1')).toBe(true)
    expect(isFixtureMode('')).toBe(false)
    expect(isFixtureMode('?fixtures=0')).toBe(false)
  })
})
