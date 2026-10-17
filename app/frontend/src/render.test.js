// Smoke test: every section renders from the fixture JSON without throwing, and shows the right words
// (the wording rules of EMS_RESPONSE_MONITOR_DECISIONS.md).
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import summary from './fixtures/summary_state.json'
import pchart from './fixtures/pchart.json'
import imr from './fixtures/imr.json'
import replay from './fixtures/replay.json'
import flagged from './fixtures/flagged.json'
import stages from './fixtures/stages.json'
import signalCalls from './fixtures/signal_calls.json'
import App from './App.jsx'
import AnomSection from './components/AnomSection.jsx'
import ChangeSection, { SignalCallsTable, StageTable } from './components/ChangeSection.jsx'
import InvestigationSection, { FlaggedList, flaggedSelection, investigationRows } from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import { InsightsSection, MetricsSection } from './components/MetricsSection.jsx'
import PlaceHead from './components/PlaceHead.jsx'
import TopBar from './components/TopBar.jsx'
import SirenLogo from './components/SirenLogo.jsx'
import { QUEUE } from './status.js'
import ReplayBar from './components/ReplayBar.jsx'

// React puts <!-- --> between text pieces; drop them so words can be searched.
const plain = (html) => html.replace(/<!-- -->/g, '')
const mmssOf = (min) => `${Math.floor(Math.round(min * 60) / 60)}:${String(Math.round(min * 60) % 60).padStart(2, '0')}`
const ok = (data) => ({ data, loading: false, error: null, reload() {} })
const STATE = { level: 'state', name: 'New York State' }
const map = (extra = {}) => plain(renderToString(h(MapSection, {
  summaryState: ok(summary), parent: STATE, urgency: ['red'], countyOptions: [],
  selected: { level: 'state', place: null }, onPick() {}, onReset() {}, onSearch() {}, ...extra,
})))
// The right column's place header (name, level, dates). Its labels sit with the table card (map()).
const head = (extra = {}) => plain(renderToString(h(PlaceHead, {
  summaryState: ok(summary), parent: STATE, selected: { level: 'state', place: null }, from: '', to: '', replayOn: false,
  onApply() {}, onDrill() {}, ...extra,
})))

describe('sections render from fixtures', () => {
  it('section 1 shows n, on-time rate, CI, P95 and both badges for every place', () => {
    const html = map()
    expect(html).toContain('Toggle table for map')
    expect(html).toContain('On-time rate [95% CI]')
    expect(html).toContain('>Target<')
    expect(html).toContain('>Control<')
    for (const p of summary.places) expect(html).toContain(p.name)
    expect(html).toContain('no alert does not mean the target is met')
  })
  it('a selected place shows its queue label with both badges in the table card, not in the header', () => {
    const p = summary.places.find((x) => x.queue === 'act_now')
    const sel = { selected: { level: 'county', id: p.id, name: p.name, place: p } }
    const html = map(sel)
    expect(html).toContain(`aria-label="Labels for ${p.name}"`)
    expect(html).toMatch(/table-badges[\s\S]*Act now[\s\S]*Target[\s\S]*Control/)
    const top = head(sel)
    expect(top).not.toContain('Evidence and call counts')
    expect(top).not.toContain('place-badges')
  })
  it('section 2: control status, baseline explanation, signal evidence; I chart is optional', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('Out of control')
    expect(html).toContain('never overlaps the selected range')
    expect(html).toContain('above its upper control limit')
    expect(html).toContain('screened for unusual periods and assumed to represent normal operation')
    expect(html).not.toContain('cannot hide inside its own limits')
    expect(html).toContain('Optional, secondary')
    expect(html).toContain('does not set any status')
  })
  it('insufficient baseline is said plainly, with no chart', () => {
    const p = { ...pchart, unit: null, points: [], signals: [], control: 'insufficient_baseline', control_reason: 'low volume', dispersion: null }
    const html = plain(renderToString(h(ChangeSection, { pState: ok(p), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('Insufficient baseline')
    expect(html).not.toContain('p chart, limits vary with n')
  })
  it('section 3 lists flagged areas with their evidence, never a chosen fix', () => {
    const html = plain(renderToString(h(InvestigationSection, { summaryState: ok(summary), onPick() {} })))
    expect(html).toContain('Target evidence')
    expect(html).toContain('Control evidence')
    expect(html).toContain('does not choose or rank interventions')
    expect(investigationRows(summary.places).every((p) => ['act_now', 'ongoing_gap', 'recent_change'].includes(p.queue) || p.spec === 'below')).toBe(true)
  })
  it('section 4 geographic comparison is descriptive', () => {
    const html = plain(renderToString(h(AnomSection, { summaryState: ok(summary) })))
    expect(html).toContain('Geographic comparison')
    expect(html).toContain('not evidence of unfair service')
    const err = renderToString(h(AnomSection, { summaryState: { data: null, loading: false, error: 'statistics module not ready (HTTP 503)', reload() {} } }))
    expect(err).toContain('statistics module not ready')
  })
  it('replay is labelled Simulation / Replay and synthetic, with no entry form', () => {
    const html = plain(renderToString(h(ReplayBar, { replay: { on: true, playing: false, start: '2026-08-25', day: '2026-09-02' }, feedState: ok(replay), onStart() {}, onToggle() {}, onStep() {}, onStop() {} })))
    expect(html).toContain('Simulation / Replay')
    expect(html).toContain('Not live CAD')
    expect(html).toContain('baseline fixed')
    expect(html).toContain(replay.events[0].incident_id)
    expect(html).not.toContain('60 days')
    expect(html).not.toMatch(/<input|<textarea/)
  })
  it('the whole page has no what-if card, no incident entry and says the data is synthetic', () => {
    const html = plain(renderToString(h(App)))
    expect(html).toContain('SYNTHETIC DATA')
    expect(html).not.toMatch(/which fix|what-if|helps most|add an ambulance|POST/i)
    expect(html).not.toMatch(/What Held Up the Call|travel-time difference|Google/i)
    expect(html).not.toMatch(/<textarea/)
    // the map search box, then From and To; no incident entry
    expect([...html.matchAll(/<input[^>]*type="([^"]+)"/g)].map((m) => m[1])).toEqual(['text', 'date', 'date'])
  })

  it('the page footer says t_received is provisional and the targets are NFPA 1720-based placeholders', () => {
    const html = plain(renderToString(h(App)))
    expect(html).toContain('provisional')
    expect(html).toContain('911 answer')
    expect(html).toContain('NFPA 1720')
    expect(html).toContain('red 8 minutes in urban areas, 10 suburban, 14 rural and remote; yellow 15; green 30')
  })
  it('the replay bar takes the baseline length from the API (60, or 120 when stretched)', () => {
    const bar = (days) => plain(renderToString(h(ReplayBar, { replay: { on: true, playing: false, start: '2026-08-25', day: '2026-09-02' }, feedState: ok(replay), baselineDays: days, onStart() {}, onToggle() {}, onStep() {}, onStop() {} })))
    expect(bar(120)).toContain('the 120 days before Aug 25')
    expect(bar(60)).toContain('the 60 days before Aug 25')
    expect(bar(undefined)).not.toMatch(/\b60 days/)
  })
})

describe('H-13 supervisor data', () => {
  const queens = summary.places.find((p) => p.watch)
  it('the fixture has a watch place, and it is still In control', () => {
    expect(queens.control).toBe('in_control')
  })
  it('a "watch" chip with its tooltip shows next to In control when watch is true', () => {
    const html = map({ selected: { level: 'county', id: queens.id, name: queens.name, place: queens } })
    expect(html).toContain('chip-watch')
    expect(html).toContain('title="1 period above the limit, not confirmed"')
    expect(html).toContain('>watch<')
    // places without watch get no chip
    expect(map({ selected: { level: 'state', place: null } })).toContain('chip-watch') // also in the table row of the watch place
    const calm = { ...summary, places: summary.places.map((p) => ({ ...p, watch: false })) }
    expect(plain(renderToString(h(MapSection, { summaryState: ok(calm), parent: { level: 'state' }, urgency: ['red'], selected: { level: 'state', place: null }, onPick() {}, onBack() {}, onDrill() {} })))).not.toContain('chip-watch')
  })
  it('section 2 shows the watch chip when the p chart has one weak signal', () => {
    const p = { ...pchart, control: 'in_control', watch: true, control_reason: '1 period above the limit, not confirmed (needs 2, or a stronger single signal)' }
    const html = plain(renderToString(h(ChangeSection, { pState: ok(p), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('chip-watch')
    expect(html).toContain('not confirmed')
  })
  it('the queue label meets_stable never claims "statistically stable"', () => {
    const stable = summary.places.find((x) => x.queue === 'meets_stable')
    const html = map({ selected: { level: 'county', id: stable.id, name: stable.name, place: stable } })
    expect(html).toContain('Meets goal, no signal')
    expect(html).not.toMatch(/statistically stable/i)
  })
  it('the headline splits needs-review and shows the chance-below context', () => {
    const html = map()
    expect(html).toMatch(/\d+ of \d+ counties need review: \d+ with a recent signal \(Act now \+ Recent change\) · \d+ ongoing gaps/)
    expect(html).toContain('would read Below by chance alone if every place were exactly at the goal (expected, of 60 counties)')
    expect(html).toContain('About 1.9 would read')
  })
  it('the table has an Excess late vs goal column, cancelled/invalid and calls per day', () => {
    const html = map()
    expect(html).toContain('Excess late vs goal')
    expect(html).toContain('Cancelled / invalid')
    expect(html).toContain('Calls per day: now (baseline)')
  })
  it('the table rows show cancelled, invalid, cancel %, calls/day now (baseline); section 2 shows the baseline screen', () => {
    const p = summary.places.find((x) => x.queue === 'act_now')
    const html = map()
    expect(html).toContain(`${p.cancelled} (${p.cancel_pct.toFixed(1)}%) / ${p.invalid}`)
    expect(html).toContain(`${p.calls_per_day.toFixed(1)} (${p.base_calls_per_day.toFixed(1)})`)
    const ok2 = { ...pchart, baseline: { ...pchart.baseline, checked: true, stable: true, removed: 0 } }
    expect(plain(renderToString(h(ChangeSection, { pState: ok(ok2), imrState: ok(imr), selectedName: 'X' })))).toContain('Screened: stable.')
  })
  it('an unstable baseline shows the removed periods and the reasons', () => {
    const p = { ...summary.places[3], baseline: { ...summary.places[3].baseline, checked: true, stable: false, removed: 2, removed_starts: ['2026-06-08', '2026-06-15'], reasons: ['still too variable after dropping 2 periods'] } }
    const bad = { ...pchart, control: 'insufficient_baseline', control_reason: 'baseline is not stable', points: [], signals: [], unit: null, dispersion: null, baseline: p.baseline }
    const html2 = plain(renderToString(h(ChangeSection, { pState: ok(bad), imrState: ok(imr), selectedName: 'X' })))
    expect(html2).toContain('Reasons: still too variable after dropping 2 periods.')
    expect(html2).toContain('is not stable')
    expect(html2).toContain('Screened: not stable.')
    expect(html2).toContain('2 unusual periods left out (Jun 8, Jun 15)')
  })
  it('null interval bounds and missing counts print n/a and never crash or print NaN', () => {
    const p = { ...summary.places[0], on_time_ci: [null, null], median_ci: [null, null], p95_ci: [15.6, null], excess_late: null, cancel_pct: null, calls_per_day: null, base_calls_per_day: null, cpk: null }
    const bare = { ...summary, places: [p], place: p }
    const html = map({ summaryState: ok(bare), selected: { level: 'county', id: p.id, name: p.name, place: p } })
    expect(html).toContain('15.6 to n/a')
    expect(html).toContain('n/a (n/a)')
    expect(html.replace(/title="[^"]*"/g, '')).not.toMatch(/NaN|undefined|\bnull\b/)
  })
  it('the signal evidence table has a "show calls" button and a p-value for each signal', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), params: {}, selectedName: 'X' })))
    expect(html.match(/show calls/g).length).toBe(pchart.signals.length)
    expect(html).toContain('p-value')
  })
  it('the calls behind a signal render read-only', () => {
    const html = plain(renderToString(h(SignalCallsTable, { data: signalCalls })))
    expect(html).toContain(signalCalls.calls[0].incident_id)
    expect(html).toContain('Read-only')
    expect(html).toContain('Waited for a unit')
    expect(html).not.toMatch(/<input|<textarea/)
    const empty = plain(renderToString(h(SignalCallsTable, { data: { ...signalCalls, calls: [], returned: 0, valid: 0, late: 0 } })))
    expect(empty).toContain('No valid calls in this period.')
  })
  it('the stage table is descriptive: medians only, this period vs baseline, no cause wording', () => {
    const html = plain(renderToString(h(StageTable, { data: stages })))
    expect(html).toContain('Stage times (descriptive)')
    expect(html).toContain('Received to assigned')
    expect(html).toContain('Assigned to en route')
    expect(html).toContain('En route to on scene')
    expect(html).toContain('This period (median)')
    expect(html).toContain('Baseline (median)')
    expect(html).toContain('Medians only')
    expect(html).toContain('delay-breakdown card was removed')
    expect(html).not.toMatch(/cause|held up|root/i)
    expect(html).not.toMatch(/NaN|undefined|null/)
  })
  it('the stage table survives missing medians', () => {
    const blank = { now: { dispatch_s: null, turnout_s: null, drive_s: null, held_pct: null, n: 0 }, base: { dispatch_s: null, turnout_s: null, drive_s: null, held_pct: null, n: 0 } }
    expect(plain(renderToString(h(StageTable, { data: blank })))).toContain('n/a')
  })
  it('section 2 puts the stage table below the chart', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), stagesState: ok(stages), params: {}, selectedName: 'X' })))
    expect(html.indexOf('Stage times (descriptive)')).toBeGreaterThan(html.indexOf('p chart, limits vary with n'))
  })
  it('the statewide flagged list renders with chance-below context and no input fields', () => {
    const html = plain(renderToString(h(FlaggedList, { data: flagged, onPick() {} })))
    expect(html).toContain('ZIP areas with a confirmed signal anywhere in the state')
    expect(html).toContain(flagged.flagged[0].id)
    expect(html).toContain(flagged.flagged[0].county)
    expect(html).toContain('would read Below by chance alone')
    expect(html).toContain('Excess late vs goal')
    expect(html).not.toMatch(/<input|<textarea/)
    const none = plain(renderToString(h(FlaggedList, { data: { ...flagged, n_flagged: 0, flagged: [] }, onPick() {} })))
    expect(none).toContain('No ZIP area in the state has a confirmed signal')
  })
  it('clicking a flagged ZIP calls the handler with that row, and the selection is its county plus the ZIP', () => {
    const picked = []
    const tree = FlaggedList({ data: flagged, onPick: (row) => picked.push(row) })
    const buttons = []
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk)
      if (!node || typeof node !== 'object' || !node.props) return
      if (node.type === 'button') buttons.push(node)
      walk(node.props.children)
    }
    walk(tree)
    expect(buttons.length).toBe(flagged.flagged.length)
    buttons[0].props.onClick()
    expect(picked).toEqual([flagged.flagged[0]])
    const sel = flaggedSelection(picked[0])
    expect(sel.parent).toEqual({ level: 'county', id: flagged.flagged[0].county_fips, name: flagged.flagged[0].county })
    expect(sel.selected).toMatchObject({ level: 'zcta', id: flagged.flagged[0].id, place: null })
  })
  it('section 3 includes the statewide list', () => {
    const html = plain(renderToString(h(InvestigationSection, { summaryState: ok(summary), flaggedState: ok(flagged), onPick() {}, onPickFlagged() {} })))
    expect(html).toContain('ZIP areas with a confirmed signal anywhere in the state')
    expect(html).toContain('does not choose or rank interventions')
  })
})

describe('OnScene page (H-14)', () => {
  const t = summary.totals
  const metrics = (extra = {}) => plain(renderToString(h(MetricsSection, {
    summaryState: ok(summary), parent: STATE, selected: { level: 'state', place: null }, urgency: ['red'],
    onToggleUrgency() {}, selection: summary.selection, dataset: 'baseline', ...extra,
  })))
  const topbar = (extra = {}) => plain(renderToString(h(TopBar, {
    dataset: 'baseline', datasets: ['baseline', 'station_closure', 'summer_surge'], onDataset() {}, fixtures: false,
    replay: { on: false, playing: false, start: '', day: '' }, replayHandlers: { onStart() {}, onToggle() {}, onStep() {}, onStop() {} }, ...extra,
  })))

  it('the page title and brand are OnScene, with the siren logo and the sub line', () => {
    const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    expect(index).toContain('<title>OnScene: New York State EMS response quality</title>')
    const html = topbar()
    expect(html).toContain('Scene</span>')
    expect(html).toContain('New York State · EMS response quality')
    expect(plain(renderToString(h(SirenLogo)))).toContain('icon-siren')
    expect(html).not.toMatch(/Sentinel/)
  })
  it('the top bar has the simulated-data pill, the dataset picker from /api/meta, the user chip and no clock', () => {
    const html = topbar()
    expect(html).toContain('SYNTHETIC DATA: ')
    expect(html).toContain('Simulated service data')
    for (const d of ['baseline', 'station_closure', 'summer_surge']) expect(html).toContain(`<option value="${d}"`)
    expect(html).toContain('Team Powerpuff Girls')
    expect(html).not.toMatch(/FIXTURE DATA/)
    expect(topbar({ fixtures: true })).toContain('FIXTURE DATA')
    expect(html).not.toMatch(/Sat,|clock/i)
  })
  it('replay controls sit in the top bar, and the dataset picker is locked while a replay runs', () => {
    expect(topbar()).toContain('Start replay')
    const on = topbar({ replay: { on: true, playing: true, start: '2026-08-25', day: '2026-08-27' } })
    expect(on).toContain('Pause')
    expect(on).toContain('+1 day')
    expect(on).toContain('Replay day Aug 27, 2026')
    expect(on).toMatch(/<select[^>]*disabled/)
  })
  it('the map legend has the four rows with counts that add queue_counts as Critical, Watch, Stable, gray', () => {
    const html = map()
    const q = summary.queue_counts
    const rows = [...html.matchAll(/<span>(Critical|Watch|Stable|Needs data)<\/span><span class="legend-val">(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2])])
    expect(rows).toEqual([['Critical', q.act_now], ['Watch', q.ongoing_gap + q.recent_change], ['Stable', q.meets_stable], ['Needs data', q.needs_data]])
    expect(html).toContain('<div class="legend-title">Status</div>')
  })
  it('the hover card: place, county and status; calls per urgency; late share vs goal; typical wait vs the parent', async () => {
    const { makeTip } = await import('./components/MapSection.jsx')
    const p = { ...summary.places.find((x) => x.queue === 'act_now'), calls_by_urgency: { red: 142, yellow: 210, green: 96 } }
    const zip = makeTip(summary, { level: 'county', id: '36055', name: 'Monroe' })({ ...p, late: 40, valid: 240, goal_pct: 90, median_min: 6 + 55 / 60 }, '14612')
    expect([zip.title, zip.sub]).toEqual(['ZIP 14612', 'Monroe County'])
    expect(zip.status).toEqual({ label: 'Act now', tier: 'critical' })
    expect(zip.rows).toEqual([
      { label: 'Late red calls', value: '1 in 6', note: 'goal 1 in 10' },
      { label: 'Typical wait', value: '6:55', note: `county ${mmssOf(summary.totals.median_min)}` },
    ])
    expect(zip.urgency.map((u) => `${u.label} ${u.count}`)).toEqual(['Red 142', 'Yellow 210', 'Green 96'])
    expect(zip.text).toContain('ZIP 14612, Monroe County: Act now')
    const county = makeTip(summary, STATE)(p, p.name)
    expect([county.title, county.sub]).toEqual([`${p.name} County`, ''])
    expect(county.rows[1].note).toMatch(/^state \d+:\d\d$/)
    const none = makeTip(summary, STATE)(null, 'Hamilton')
    expect([none.title, none.empty, none.status]).toEqual(['Hamilton County', 'No calls in this selection', null])
  })
  it('the map card has a keyboard search combobox, back/reset and a breadcrumb', () => {
    const html = map()
    expect(html).toContain('role="combobox"')
    expect(html).toContain('placeholder="Search ZIP or county"')
    expect(html).toContain('aria-label="Reset map to New York State"')
    // statewide the breadcrumb would only repeat "New York State", so it shows once a county is open
    expect(html).not.toContain('aria-label="Map drilldown"')
    const county = map({ parent: { level: 'county', id: '36055', name: 'Monroe' } })
    expect(county).toContain('aria-label="Back to all counties"')
    expect(county).toContain('aria-label="Map drilldown"')
    expect(county).toContain('Monroe')
  })
  it('loading shows a spinner and a skeleton, a busy map, and the top progress bar', async () => {
    const { Async, LoadingBar } = await import('./components/common.jsx')
    const busy = plain(renderToString(h(Async, { state: { loading: true } }, () => null)))
    expect(busy).toContain('class="spinner"')
    expect(busy).toContain('class="skeleton"')
    expect(busy).toContain('Loading...')
    expect(map({ summaryState: { data: null, loading: true, error: null, reload() {} } })).toContain('aria-busy="true"')
    expect(plain(renderToString(h(LoadingBar, { active: true })))).toContain('loading-bar is-active')
    expect(plain(renderToString(h(LoadingBar, { active: false })))).not.toContain('is-active')
  })
  it('Key Metrics shows the fixture totals: on time with k of n, CI and goal; median; P95 with P90', () => {
    const html = metrics()
    expect(html).toContain('Key Metrics')
    expect(html).toContain(`${t.on_time_pct.toFixed(1)}%`)
    expect(html).toContain(`${t.on_time.toLocaleString('en-US')} of ${t.valid.toLocaleString('en-US')} valid calls`)
    expect(html).toContain(`95% CI ${t.on_time_ci[0].toFixed(1)}% to ${t.on_time_ci[1].toFixed(1)}%`)
    expect(html).toContain('goal 90%')
    expect(html).toContain(`<span>${t.median_min.toFixed(1)}</span>`)
    expect(html).toContain(`95% CI ${t.median_ci[0].toFixed(1)} to ${t.median_ci[1].toFixed(1)} min`)
    expect(html).toContain(`<span>${t.p95_min.toFixed(1)}</span>`)
    expect(html).toContain(`95% CI ${t.p95_ci[0].toFixed(1)} to ${t.p95_ci[1].toFixed(1)} min`)
    expect(html).toContain(`P90 ${t.p90_min.toFixed(1)} min`)
  })
  it('Priority is the urgency multi-select, with no on-scene wait filter and no flag button', () => {
    const html = metrics({ urgency: ['red', 'yellow'] })
    expect(html).toContain('Priority')
    expect((html.match(/class="pri-chip/g) || []).length).toBe(3)
    expect((html.match(/aria-pressed="true"/g) || []).length).toBe(2)
    expect(html).not.toMatch(/on-scene wait|Flag/i)
  })
  it('a missing value shows a dash and the API note, never NaN or null', () => {
    const empty = { ...summary, totals: { ...t, on_time_pct: null, on_time_ci: [null, null], median_min: null, median_ci: [null, null], p95_min: null, p95_ci: [null, null], p90_min: null }, messages: ['No valid completed calls in this selection.'] }
    const html = metrics({ summaryState: ok(empty) })
    expect(html).toContain('<span>—</span>')
    expect(html).toContain('No valid completed calls in this selection.')
    expect(html).not.toMatch(/NaN|undefined|\bnull\b/)
  })
  it('the Summary panel is plain text from the queue label, the two reasons and the next hint, with no AI wording', () => {
    const p = summary.place
    const html = metrics()
    expect(html).toContain('>Summary<')
    expect(html).not.toMatch(/\bAI\b|generated|Flag/i)
    expect(html).toContain(QUEUE[p.queue].label)
    expect(html).toContain(p.spec_reason)
    expect(html).toContain(p.control_reason)
    expect(html).toContain(QUEUE[p.queue].next)
  })
  it('a place picked from the table shows that place\'s own numbers in the tiles', () => {
    const p = summary.places.find((x) => x.queue === 'meets_stable')
    const html = metrics({ selected: { level: 'county', id: p.id, name: p.name, place: p } })
    expect(html).toContain(`${p.on_time_pct.toFixed(1)}%`)
    expect(html).toContain(`${p.name}: ${QUEUE.meets_stable.label}`)
  })
  it('the Insights row has both chart cards and no stage card', () => {
    const html = plain(renderToString(h(InsightsSection, { placeName: 'Monroe', selection: summary.selection, dataset: 'baseline' },
      h(AnomSection, { summaryState: ok(summary) }),
      h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), selectedName: 'Monroe' }))))
    expect(html).toContain('Monroe Wait Time Insights')
    expect(html).toContain('Are calls arriving on time?')
    expect(html).toContain('Are late calls being unusually frequent?')
    expect(html).toContain('Stand-in')
    expect(html).not.toMatch(/Where the delay sits|On-scene time trend/)
  })
  it('the whole page, rendered, has the brand and the layout regions and says "Selected place"', () => {
    const html = plain(renderToString(h(App)))
    expect(html).toContain('Selected place')
    expect(html).toContain('Key Metrics')
    expect(html).toContain('Wait Time Insights')
    expect(html).toContain('Toggle table for map')
    expect(html).not.toContain('Sentinel')
    expect(html).toContain('AI summary')
    expect(html).toContain('Select both From and To dates')
  })
})
