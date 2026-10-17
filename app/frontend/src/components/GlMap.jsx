// The map itself, drawn by MapLibre GL (vector tiles): sharp labels at every zoom, smooth zoom and camera moves, and a
// hover highlight. Basemap: CARTO Positron when VITE_CARTO_KEY is set in the repo-root .env, otherwise OpenFreeMap's
// Positron (free, no key), so a fresh clone still works. Neighbouring states, Canada and every place name come from the
// basemap: gray, for orientation only, never clickable. Our counties or ZIP areas sit under the basemap's labels, in the
// queue-label colours. MapLibre needs a browser, so it loads inside an effect (the server render and tests get the frame).
import { useEffect, useMemo, useRef, useState } from 'react'
import { tierOf } from '../status.js'

const CARTO_KEY = (import.meta.env && import.meta.env.VITE_CARTO_KEY) || ''
export const BASEMAP_STYLE = CARTO_KEY
  ? `https://basemaps.cartocdn.com/gl/positron-gl-style/style.json?key=${encodeURIComponent(CARTO_KEY)}`
  : 'https://tiles.openfreemap.org/styles/positron'

// Same colours as tokens.css (--map-*), so the map matches the legend and the rest of the page.
const TIER_FILL = { critical: '#dd806d', watch: '#ebc684', stable: '#cfe3d8', nodata: '#d9e0e8' }
const GHOST_FILL = '#e1e9f2'
const SELECTED = '#14538f'
const HOVER = '#0f243d'
// Room kept free for the search box (top), the legend and the NYC card (bottom) when the camera fits a place.
const PADDING = { top: 84, left: 28, right: 28, bottom: 104 }

const collection = (features) => ({ type: 'FeatureCollection', features })

/** [[west, south], [east, north]] of a list of GeoJSON (Multi)Polygon features. */
function bbox(features) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < w) w = c[0]
      if (c[0] > e) e = c[0]
      if (c[1] < s) s = c[1]
      if (c[1] > n) n = c[1]
    } else c.forEach(visit)
  }
  features.forEach((f) => f.geometry && visit(f.geometry.coordinates))
  return Number.isFinite(w) ? [[w, s], [e, n]] : null
}

/**
 * props: counties / zctas (raw GeoJSON features), drillIn, parentId, byId (place cards by id), selectedId,
 * label(p, name) -> the hover card (MapSection makeTip; .text is its one-line form), onPick(p, drill), setTip, fitKey (bump to refit), busy, ariaLabel.
 */
export default function GlMap({ counties, zctas, drillIn, parentId, byId, selectedId, label, onPick, setTip, fitKey, busy, ariaLabel }) {
  const boxRef = useRef(null)
  const mapRef = useRef(null)
  const hoverRef = useRef(null)
  const fitRef = useRef(null)
  const [ready, setReady] = useState(false)
  // The newest callbacks and numbers, so the map's event handlers never call a stale one.
  const live = useRef({})
  live.current = { onPick, setTip, byId, label }

  const active = drillIn ? zctas : counties
  // Each shape carries its colour group, so the style only reads properties (no statistics here).
  const shapes = useMemo(() => collection(active.map((f) => {
    const p = byId[f.properties.GEOID]
    return { type: 'Feature', geometry: f.geometry, properties: { id: f.properties.GEOID, tier: p ? tierOf(p.queue) : 'nodata', has: p ? 1 : 0 } }
  })), [active, byId])
  const ghosts = useMemo(() => collection(drillIn ? counties.filter((f) => f.properties.GEOID !== parentId) : []), [drillIn, counties, parentId])
  const outline = useMemo(() => collection(drillIn ? counties.filter((f) => f.properties.GEOID === parentId) : []), [drillIn, counties, parentId])

  useEffect(() => {
    let cancelled = false
    let map = null
    import('maplibre-gl').then((mod) => {
      const maplibregl = mod.default || mod
      if (cancelled || !boxRef.current) return
      map = new maplibregl.Map({
        container: boxRef.current,
        style: BASEMAP_STYLE,
        bounds: [[-79.8, 40.5], [-71.8, 45.0]],
        fitBoundsOptions: { padding: PADDING },
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        cooperativeGestures: true, // scroll the page normally; Ctrl/Cmd + scroll (or two fingers) zooms the map
        minZoom: 4,
        maxZoom: 14,
      })
      map.touchZoomRotate.disableRotation()
      map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
      map.on('load', () => {
        if (cancelled) return
        // Our layers go under the first label layer, so place names stay readable on top of the colours.
        const firstLabel = (map.getStyle().layers || []).find((l) => l.type === 'symbol')
        const before = firstLabel ? firstLabel.id : undefined
        map.addSource('ghosts', { type: 'geojson', data: collection([]) })
        map.addSource('shapes', { type: 'geojson', data: collection([]), promoteId: 'id' })
        map.addSource('outline', { type: 'geojson', data: collection([]) })
        map.addLayer({ id: 'ghost-fill', type: 'fill', source: 'ghosts', paint: { 'fill-color': GHOST_FILL, 'fill-opacity': 0.55 } }, before)
        map.addLayer({ id: 'ghost-line', type: 'line', source: 'ghosts', paint: { 'line-color': '#ffffff', 'line-width': 0.8 } }, before)
        map.addLayer({
          id: 'shape-fill', type: 'fill', source: 'shapes',
          paint: {
            'fill-color': ['match', ['get', 'tier'], 'critical', TIER_FILL.critical, 'watch', TIER_FILL.watch, 'stable', TIER_FILL.stable, TIER_FILL.nodata],
            'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.97, 0.82],
            'fill-opacity-transition': { duration: 180 },
          },
        }, before)
        map.addLayer({ id: 'shape-line', type: 'line', source: 'shapes', paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 10, 1.4] } }, before)
        map.addLayer({
          id: 'shape-hover', type: 'line', source: 'shapes',
          paint: { 'line-color': HOVER, 'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0], 'line-width-transition': { duration: 150 } },
        }, before)
        map.addLayer({ id: 'shape-selected', type: 'line', source: 'shapes', filter: ['==', ['get', 'id'], ''], paint: { 'line-color': SELECTED, 'line-width': 2.6 } }, before)
        map.addLayer({ id: 'outline-line', type: 'line', source: 'outline', paint: { 'line-color': SELECTED, 'line-width': 2, 'line-opacity': 0.9 } }, before)

        const setHover = (id) => {
          if (hoverRef.current != null) map.setFeatureState({ source: 'shapes', id: hoverRef.current }, { hover: false })
          hoverRef.current = id
          if (id != null) map.setFeatureState({ source: 'shapes', id }, { hover: true })
        }
        map.on('mousemove', 'shape-fill', (e) => {
          const f = e.features && e.features[0]
          if (!f) return
          const id = f.properties.id
          const p = live.current.byId[id]
          setHover(id)
          map.getCanvas().style.cursor = p ? 'pointer' : ''
          const t = live.current.label(p, p ? p.name : id)
          live.current.setTip({ x: e.originalEvent.clientX, y: e.originalEvent.clientY, ...t })
        })
        map.on('mouseleave', 'shape-fill', () => {
          setHover(null)
          map.getCanvas().style.cursor = ''
          live.current.setTip(null)
        })
        map.on('click', 'shape-fill', (e) => {
          const f = e.features && e.features[0]
          const p = f && live.current.byId[f.properties.id]
          if (p) live.current.onPick(p, true)
        })
        // Start with the credit folded into its small (i) button; it opens on click.
        const fold = () => {
          const attrib = map.getContainer().querySelector('.maplibregl-ctrl-attrib')
          if (attrib) attrib.classList.remove('maplibregl-compact-show')
        }
        fold()
        map.once('idle', fold)
        mapRef.current = map
        setReady(true)
      })
    })
    return () => {
      cancelled = true
      if (map) map.remove()
      mapRef.current = null
    }
  }, [])

  // New numbers, level or selection: only the data changes; the layers stay.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // Hover marks live on the old shapes' ids: clear them, or a shape could keep its outline after a refresh.
    map.removeFeatureState({ source: 'shapes' })
    hoverRef.current = null
    map.getSource('shapes').setData(shapes)
    map.getSource('ghosts').setData(ghosts)
    map.getSource('outline').setData(outline)
  }, [ready, shapes, ghosts, outline])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setFilter('shape-selected', ['==', ['get', 'id'], selectedId || ''])
  }, [ready, selectedId])

  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    map.setPaintProperty('shape-fill', 'fill-opacity', busy ? 0.45 : ['case', ['boolean', ['feature-state', 'hover'], false], 0.97, 0.82])
  }, [ready, busy])

  // Camera: the whole state, or the open county, with a smooth flight. Only when the level changes (or reset).
  useEffect(() => {
    const map = mapRef.current
    const focus = drillIn && zctas.length ? zctas : counties
    if (!ready || !map || !focus.length) return
    const b = bbox(focus)
    if (!b) return
    fitRef.current = (animate) => map.fitBounds(b, { padding: PADDING, duration: animate ? 900 : 0, essential: true })
    fitRef.current(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, drillIn, parentId, counties.length > 0, zctas.length > 0, fitKey])

  // The card can change width (window resize, one-column layout): resize the canvas and keep the place in frame.
  useEffect(() => {
    if (!ready || typeof ResizeObserver === 'undefined') return undefined
    let last = null
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width)
      if (!mapRef.current || w === last) return
      last = w
      mapRef.current.resize()
      if (fitRef.current) fitRef.current(false)
    })
    ro.observe(boxRef.current)
    return () => ro.disconnect()
  }, [ready])

  // The canvas has no per-shape focus, so keyboard and screen-reader users get the same places as a list of buttons
  // (hidden until focused; the search box, the NYC list and the table are other ways in).
  const places = active.map((f) => ({ id: f.properties.GEOID, p: byId[f.properties.GEOID], name: f.properties.NAME })).filter((x) => x.p)
  return (
    <>
      <div ref={boxRef} className="map map-gl" role="img" aria-label={ariaLabel} />
      <nav className="map-keys" aria-label={drillIn ? 'ZIP areas on the map' : 'Counties on the map'}>
        <ul>
          {places.map(({ id, p, name }) => {
            const t = label(p, p.name || name)
            return (
              <li key={id}>
                <button type="button" onClick={() => onPick(p, true)}>{t.text}</button>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}
