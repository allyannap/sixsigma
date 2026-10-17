import { describe, expect, it } from 'vitest'
import { geoArea } from 'd3-geo'
import { rewindForD3 } from './geo.js'

// A 1 x 1 degree square near New York, written counter-clockwise (RFC 7946 style).
const ccwSquare = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'Polygon', coordinates: [[[-74, 40], [-73, 40], [-73, 41], [-74, 41], [-74, 40]]] },
}

describe('rewindForD3', () => {
  it('turns an RFC 7946 ring into a small shape for d3, not the rest of the globe', () => {
    expect(geoArea(ccwSquare)).toBeGreaterThan(6) // d3 reads it as almost the whole sphere (4 pi = 12.57)
    expect(geoArea(rewindForD3(ccwSquare))).toBeLessThan(0.001) // a 1-degree square is about 0.0002 sr
  })
  it('leaves an already clockwise ring alone', () => {
    const once = rewindForD3(ccwSquare)
    expect(rewindForD3(once).geometry.coordinates).toEqual(once.geometry.coordinates)
  })
})
