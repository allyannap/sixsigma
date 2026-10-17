// d3-geo draws on a sphere and expects each polygon's outer ring to run clockwise
// (holes counter-clockwise). GeoJSON files written to RFC 7946 run the other way, and d3 then
// fills "the whole world except this shape". rewindForD3 fixes the winding, whatever the source.

function signedArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
  }
  return a / 2 // > 0 means counter-clockwise (x = longitude, y = latitude)
}

function rewindPolygon(rings) {
  return rings.map((ring, i) => {
    const ccw = signedArea(ring) > 0
    const wantCcw = i > 0 // outer ring clockwise, holes counter-clockwise
    return ccw === wantCcw ? ring : [...ring].reverse()
  })
}

export function rewindForD3(feature) {
  const g = feature.geometry
  if (!g) return feature
  let coordinates = g.coordinates
  if (g.type === 'Polygon') coordinates = rewindPolygon(g.coordinates)
  else if (g.type === 'MultiPolygon') coordinates = g.coordinates.map(rewindPolygon)
  else return feature
  return { ...feature, geometry: { ...g, coordinates } }
}
