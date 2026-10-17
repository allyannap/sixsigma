// The ONLY file that talks to the server. Every request carries the same filters
// (docs/api.md section B): dataset, from, to, urgency, level, id, baseline_days.
import { API_BASE } from './config.js'
import summaryState from './fixtures/summary_state.json'
import summaryCounty from './fixtures/summary_county.json'
import anom from './fixtures/anom.json'
import pchart from './fixtures/pchart.json'
import imr from './fixtures/imr.json'
import replay from './fixtures/replay.json'
import meta from './fixtures/meta.json'
import geoCounties from './fixtures/geo_counties.json'
import geoZcta from './fixtures/geo_zcta.json'

/** True only when the address has ?fixtures=1. The real page never shows invented numbers. */
export function isFixtureMode(search = typeof window === 'undefined' ? '' : window.location.search) {
  return new URLSearchParams(search).get('fixtures') === '1'
}

/** {a: 1, b: ['x','y'], c: ''} -> "a=1&b=x%2Cy". Empty, null and undefined values are left out. */
export function buildQuery(params = {}) {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length) q.set(key, value.join(','))
    } else {
      q.set(key, String(value))
    }
  }
  return q.toString()
}

/** Full URL for one endpoint, e.g. apiUrl('summary', {dataset: 'baseline'}) -> "/api/summary?dataset=baseline". */
export function apiUrl(endpoint, params = {}) {
  const q = buildQuery(params)
  return `${API_BASE}/api/${endpoint}${q ? `?${q}` : ''}`
}

/** Turn a failed response into one readable sentence (FastAPI sends {detail: "..."}). */
export async function errorMessage(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail || '')
  } catch {
    detail = ''
  }
  return `${detail || res.statusText || 'Request failed'} (HTTP ${res.status})`
}

const FIXTURES = { anom, pchart, imr, replay, meta }

function fixtureFor(endpoint, params) {
  if (endpoint === 'summary') return params.level === 'county' ? summaryCounty : summaryState
  return FIXTURES[endpoint]
}

/** Fetch one endpoint. Throws Error(message) on failure; the page shows the message. */
export async function getApi(endpoint, params = {}, { signal } = {}) {
  if (isFixtureMode()) {
    const fx = fixtureFor(endpoint, params)
    if (!fx) throw new Error(`No fixture for ${endpoint}`)
    return fx
  }
  const res = await fetch(apiUrl(endpoint, params), { signal })
  if (!res.ok) throw new Error(await errorMessage(res))
  return res.json()
}

/** Map shapes: /geo/ny_counties.geojson or /geo/ny_zcta.geojson (served by the API app). */
export async function getGeo(kind, { signal } = {}) {
  if (isFixtureMode()) return kind === 'counties' ? geoCounties : geoZcta
  const name = kind === 'counties' ? 'ny_counties' : 'ny_zcta'
  const res = await fetch(`${API_BASE}/geo/${name}.geojson`, { signal })
  if (!res.ok) throw new Error(`Map shapes not available: ${await errorMessage(res)}`)
  return res.json()
}
