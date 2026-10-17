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
import ChangeSection, { SignalCallsTable, StageTable, ControlMethod, SignalList } from './components/ChangeSection.jsx'
import InvestigationSection, { FlaggedList, flaggedSelection, investigationRows } from './components/InvestigationSection.jsx'
import MapSection from './components/MapSection.jsx'
import { InsightsSection, MetricsSection } from './components/MetricsSection.jsx'
import PlaceHead from './components/PlaceHead.jsx'
import TopBar from './components/TopBar.jsx'
import SirenLogo from './components/SirenLogo.jsx'
import { QUEUE, legendRows } from './status.js'
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
// The Investigate panel (its table holds every place's labels and numbers), and the names of its table rows.
const railHtml = async (extra = {}) => {
  const { default: InvestigateRail } = await import('./components/InvestigateRail.jsx')
  return plain(renderToString(h(InvestigateRail, { open: true, onClose() {}, summaryState: ok(summary), parent: STATE, selected: { level: 'state' }, onPick() {}, ...extra })))
}
const rowNames = (html) => [...html.matchAll(/<th scope="row"><button[^>]*>([^<]+)</g)].map((m) => m[1])
// One place's table row, from its name to the end of the row.
const rowOf = (html, name) => html.slice(html.indexOf(`>${name}</button>`), html.indexOf('</tr>', html.indexOf(`>${name}</button>`)))
// The right column's place header (name, level, dates).
const head = (extra = {}) => plain(renderToString(h(PlaceHead, {
  summaryState: ok(summary), parent: STATE, selected: { level: 'state', place: null }, from: '', to: '', replayOn: false,
  onApply() {}, onDrill() {}, ...extra,
})))

describe('sections render from fixtures', () => {
  it('two tabs that never overlap: Needs review + Not flagged = every place, once; the map card has no table', async () => {
    const { investigationRows } = await import('./components/InvestigationSection.jsx')
    const review = rowNames(await railHtml({ initialView: 'review' }))
    const others = rowNames(await railHtml({ initialView: 'others' }))
    expect(review).toEqual(investigationRows(summary.places).map((p) => p.name))
    expect(review.filter((n) => others.includes(n))).toEqual([])
    expect([...review, ...others].sort()).toEqual(summary.places.map((p) => p.name).sort())
    const all = await railHtml({ initialView: 'others' })
    expect(all).toMatch(/aria-selected="true"[^>]*>Not flagged/)
    expect(all).toContain('How to read this list')
    expect(all).toContain('Being in control does not mean the service is good')
    const html = map()
    expect(html).not.toContain('Toggle table for map')
    expect(html).not.toContain('class="places"')
  })
  it('the list is a table only (no cards, no switch) with every number column', async () => {
    const html = await railHtml()
    expect(html).not.toContain('rail-card')
    expect(html).not.toContain('rail-layout')
    for (const col of ['Valid calls', 'On time (95% CI)', 'Goal (90%)', 'Control', 'Label', 'Late beyond goal', 'Cancelled / invalid', 'Calls per day: now (baseline)', 'P95 min (95% CI)', 'Cpk [upper]']) {
      expect(html).toContain(`>${col}</th>`)
    }
    // the goal is named once, in the heading, not as "vs 90" on every row
    expect(html).not.toMatch(/vs 90/)
    const p = summary.places.find((x) => x.queue === 'act_now')
    expect(rowOf(html, p.name)).toContain(`${p.on_time_ci[0].toFixed(1)}–${p.on_time_ci[1].toFixed(1)}`)
  })
  it('a place row shows its queue label and both judgments; the place header no longer repeats them', async () => {
    const p = summary.places.find((x) => x.queue === 'act_now')
    const row = rowOf(await railHtml(), p.name)
    expect(row).toMatch(/Below goal|Inconclusive|Meets goal/)
    expect(row).toContain('Act now')
    expect(row).toContain(`${p.valid.toLocaleString('en-US')}</td>`)
    const top = head({ selected: { level: 'county', id: p.id, name: p.name, place: p } })
    expect(top).not.toContain('Labels for')
    expect(top).not.toContain('<summary>Details</summary>')
  })
  it('section 2 keeps the finding and chart compact, with the baseline explanation in Method', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), selectedName: 'X' })))
    expect(html).toContain('Recent increase detected')
    expect(html).toContain('Details &amp; evidence')
    expect(html).toContain('trend-drawer-title')
    const method = plain(renderToString(h(ControlMethod, { p: pchart })))
    expect(method).toContain('never overlaps the selected range')
    expect(method).toContain('screened for unusual periods and assumed to represent normal operation')
    expect(method).toContain('Crossings alone do not confirm a change')
    expect(html).not.toContain('Optional, secondary')
  })
  it('insufficient baseline is said plainly, with no chart', () => {
    const p = { ...pchart, unit: null, points: [], signals: [], control: 'insufficient_baseline', control_reason: 'low volume', dispersion: null }
    const html = plain(renderToString(h(ChangeSection, { pState: ok(p), imrState: ok(imr), selectedName: 'X' })))
    expect(html).toContain('More history needed')
    expect(html).toContain('View baseline checks')
    expect(html).not.toContain('class="chart control-chart"')
  })
  it('section 3 lists flagged areas with their evidence, never a chosen fix', () => {
    const html = plain(renderToString(h(InvestigationSection, { summaryState: ok(summary), onPick() {} })))
    expect(html).toContain('Goal evidence')
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
    // the only typed input is the place search; dates are picked from a calendar (DatePicker), never typed in
    expect([...html.matchAll(/<input[^>]*type="([^"]+)"/g)].map((m) => m[1])).toEqual(['text'])
    expect(html).toContain('id="date-from"')
    expect(html).toContain('id="date-to"')
  })

  it('the "How it works" guide says the clock start is not yet confirmed and the targets are NFPA 1720-based placeholders; no footer', async () => {
    const html = plain(renderToString(h(App)))
    expect(html).not.toContain('<footer')
    expect(html).toContain('>How it works</button>')
    expect(html).not.toContain('About the data and targets')
    const { default: HowItWorks } = await import('./components/HowItWorks.jsx')
    const guide = (i) => plain(renderToString(h(HowItWorks, { open: true, onClose() {}, targets: [], initialPage: i })))
    expect(guide(0)).toContain('placeholders based on NFPA 1720')
    expect(guide(2)).toContain('911 answer or the CAD record: not yet confirmed')
    expect(guide(2)).toContain('Every number comes from the read-only API')
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
  it('a "watch" chip with its tooltip shows next to In control when watch is true', async () => {
    // the watch place's row in the Investigate table has the chip; places without watch get none
    const rail = async (s) => (await railHtml({ summaryState: ok(s), initialView: 'review' })) + (await railHtml({ summaryState: ok(s), initialView: 'others' }))
    const row = rowOf(await rail(summary), queens.name)
    expect(row).toContain('chip-watch')
    expect(row).toContain('title="1 period above the limit, not confirmed"')
    expect(row).toContain('>watch<')
    const calm = { ...summary, places: summary.places.map((p) => ({ ...p, watch: false })) }
    expect(await rail(calm)).not.toContain('chip-watch')
  })
  it('section 2 says one signal is unconfirmed and retains its watch evidence in Method', () => {
    const p = { ...pchart, control: 'in_control', watch: true, control_reason: '1 period above the limit, not confirmed (needs 2, or a stronger single signal)' }
    const html = plain(renderToString(h(ChangeSection, { pState: ok(p), imrState: ok(imr), selectedName: 'X' })))
    expect(html).not.toContain('Watching one signal')
    expect(html).toContain('Change not confirmed')
    expect(plain(renderToString(h(ControlMethod, { p })))).toContain('chip-watch')
  })
  it('the queue label meets_stable never claims "statistically stable"', async () => {
    const stable = summary.places.find((x) => x.queue === 'meets_stable')
    const html = rowOf(await railHtml({ initialView: 'others' }), stable.name)
    expect(html).toContain('Meets goal, no signal')
    expect(html).not.toMatch(/statistically stable/i)
  })
  it('the Investigate list shows the needs-review split, and the chance-below context in "How to read this list"', async () => {
    const { default: InvestigateRail } = await import('./components/InvestigateRail.jsx')
    const html = plain(renderToString(h(InvestigateRail, { open: true, onClose() {}, summaryState: ok(summary), parent: STATE, selected: { level: 'state' }, onPick() {} })))
    expect(html).toMatch(/\d+ of \d+ counties need review/)
    expect(html).toMatch(/Act now <b class="n-act">\d+<\/b> · Recent change <b class="n-recent">\d+<\/b> · Ongoing gap <b class="n-gap">\d+<\/b>/)
    expect(html).toContain('would read Below by chance alone if every place were exactly at the goal (expected, of 62 counties)')
    expect(html).toContain('About 1.8 would read')
  })
  it('a table row shows cancelled, invalid, cancel %, calls/day now and baseline; section 2 shows the baseline screen', async () => {
    const p = summary.places.find((x) => x.queue === 'act_now')
    const html = rowOf(await railHtml(), p.name)
    expect(html).toContain(`${p.cancelled} (${p.cancel_pct.toFixed(1)}%) / ${p.invalid}`)
    expect(html).toContain(`${p.calls_per_day.toFixed(1)} (${p.base_calls_per_day.toFixed(1)})`)
    const ok2 = { ...pchart, baseline: { ...pchart.baseline, checked: true, stable: true, removed: 0 } }
    expect(plain(renderToString(h(ControlMethod, { p: ok2 })))).toContain('Screened: stable.')
  })
  it('an unstable baseline shows the removed periods and the reasons', () => {
    const p = { ...summary.places[3], baseline: { ...summary.places[3].baseline, checked: true, stable: false, removed: 2, removed_starts: ['2026-06-08', '2026-06-15'], reasons: ['still too variable after dropping 2 periods'] } }
    const bad = { ...pchart, control: 'insufficient_baseline', control_reason: 'baseline is not stable', points: [], signals: [], unit: null, dispersion: null, baseline: p.baseline }
    const html2 = plain(renderToString(h(ControlMethod, { p: bad })))
    expect(html2).toContain('Reasons: still too variable after dropping 2 periods.')
    expect(html2).toContain('is not stable')
    expect(html2).toContain('Screened: not stable.')
    expect(html2).toContain('2 unusual periods left out (Jun 8, Jun 15)')
  })
  it('null interval bounds and missing counts print n/a and never crash or print NaN', async () => {
    const p = { ...summary.places[0], on_time_ci: [null, null], median_ci: [null, null], p95_ci: [15.6, null], excess_late: null, cancel_pct: null, calls_per_day: null, base_calls_per_day: null, cpk: null }
    const bare = { ...summary, places: [p], place: p }
    const html = (await railHtml({ summaryState: ok(bare), initialView: 'review' })) + (await railHtml({ summaryState: ok(bare), initialView: 'others' }))
    const { fmtCi } = await import('./format.js')
    expect(fmtCi(p.p95_ci)).toBe('15.6 to n/a')
    expect(html).toContain('n/a (n/a)')
    expect(html.replace(/title="[^"]*"/g, '')).not.toMatch(/NaN|undefined|\bnull\b/)
  })
  it('the signal evidence table has a "show calls" button and a p-value for each signal', () => {
    const html = plain(renderToString(h(SignalList, { p: pchart, onReview() {} })))
    expect(html.match(/show calls/g).length).toBe(pchart.points.filter((p) => p.signal || p.p > p.ucl || p.p < p.lcl).length)
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
    expect(html).toContain('These comparisons do not explain why times changed.')
    expect(html).not.toMatch(/cause|held up|root/i)
    expect(html).not.toMatch(/NaN|undefined|null/)
  })
  it('the stage table survives missing medians', () => {
    const blank = { now: { dispatch_s: null, turnout_s: null, drive_s: null, held_pct: null, n: 0 }, base: { dispatch_s: null, turnout_s: null, drive_s: null, held_pct: null, n: 0 } }
    expect(plain(renderToString(h(StageTable, { data: blank })))).toContain('n/a')
  })
  it('section 2 moves stage times into its evidence drawer', () => {
    const html = plain(renderToString(h(ChangeSection, { pState: ok(pchart), imrState: ok(imr), stagesState: ok(stages), params: {}, selectedName: 'X' })))
    const compact = html.split('<dialog')[0]
    expect(compact).not.toContain('Stage times (descriptive)')
    expect(html.split('<dialog')[1]).toContain('control-tab-stages')
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
  it('the top bar says the data is simulated in the brand subtitle (no pill), the dataset picker from /api/meta, the user chip and no clock', () => {
    const html = topbar()
    expect(html).not.toContain('sample-pill')
    expect(html).toMatch(/class="brand-sub">[\s\S]*SYNTHETIC DATA: <\/span>Simulated data/)
    for (const d of ['baseline', 'station_closure', 'summer_surge']) expect(html).toContain(`<option value="${d}"`)
    expect(html).toContain('Team Powerpuff Girls')
    expect(html).not.toMatch(/FIXTURE DATA/)
    expect(topbar({ fixtures: true })).toContain('FIXTURE DATA')
    // no fake live clock (the data tooltip's text about the response clock is not a clock)
    expect(html.replace(/<span class="legend-tip tip-below"[\s\S]*?<\/span><\/span>/, '')).not.toMatch(/Sat,|clock/i)
  })
  it('replay controls sit in the top bar, and the dataset picker is locked while a replay runs', () => {
    expect(topbar()).toContain('Start replay')
    const on = topbar({ replay: { on: true, playing: true, start: '2026-08-25', day: '2026-08-27' } })
    expect(on).toContain('Pause')
    expect(on).toContain('+1 day')
    expect(on).toContain('Replay day Aug 27, 2026')
    expect(on).toMatch(/<select[^>]*disabled/)
  })
  it('the map legend has five rows counted from the places on the map, and a Status / Late % switch', () => {
    const html = map()
    const rows = [...html.matchAll(/<span>(Critical|Watch|Near goal|Stable|Too few calls)<\/span><span class="legend-val">(\d+)<\/span>/g)].map((m) => [m[1], Number(m[2])])
    const want = legendRows(summary.places).map((r) => [r.label, r.count])
    expect(rows).toEqual(want)
    expect(rows.reduce((n, [, c]) => n + c, 0)).toBe(summary.places.length)
    expect(html).toMatch(/aria-pressed="true"[^>]*>Status</)
    expect(html).toContain('>Late %</button>')
  })
  it('the hover card: place, county and status; calls per urgency; late share vs goal; typical wait vs the parent', async () => {
    const { makeTip } = await import('./components/MapSection.jsx')
    const p = { ...summary.places.find((x) => x.queue === 'act_now'), calls_by_urgency: { red: 142, yellow: 210, green: 96 } }
    const zip = makeTip(summary, { level: 'county', id: '36055', name: 'Monroe' })({ ...p, late: 40, valid: 240, goal_pct: 90, median_min: 6 + 55 / 60 }, '14612')
    expect([zip.title, zip.sub]).toEqual(['ZIP 14612', 'Monroe County'])
    expect(zip.status).toEqual({ label: 'Act now', tier: 'critical' })
    // a place labelled Needs more data with plenty of calls near the goal: the card names its map group too (ZIP 10025 case)
    const near = makeTip(summary, { level: 'county', id: '36061', name: 'New York' })(
      { ...p, queue: 'needs_data', spec: 'inconclusive', valid: 318, late: 26, goal_pct: 90, median_min: 5 }, '10025')
    expect(near.status).toEqual({ label: `Near goal · ${QUEUE.needs_data.short}`, tier: 'near' })
    expect(zip.rows).toEqual([
      { label: 'Late urgency-1 calls', value: '1 in 6', note: 'goal 1 in 10' },
      { label: 'Typical wait', value: '6:55', note: `county ${mmssOf(summary.totals.median_min)}` },
    ])
    expect(zip.urgency.map((u) => `${u.label} ${u.count}`)).toEqual(['Urgency 1 142', 'Urgency 2 210', 'Urgency 3 96'])
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
    expect(html).toContain('Within target · goal 90%')
    expect(html).toContain('Half of calls arrive sooner')
    expect(html).toContain('1 call in 20 waits longer')
    // every tile has the same rows, so the big numbers line up: one label, one number, one meaning line each
    expect((html.match(/class="metric-meaning"/g) || []).length).toBe(3)
    expect(html).not.toContain('metric-sub')
    expect(html).toContain(`<span>${t.median_min.toFixed(1)}</span>`)
    expect(html).toContain(`95% CI ${t.median_ci[0].toFixed(1)} to ${t.median_ci[1].toFixed(1)} min`)
    expect(html).toContain(`<span>${t.p95_min.toFixed(1)}</span>`)
    expect(html).toContain(`95% CI ${t.p95_ci[0].toFixed(1)} to ${t.p95_ci[1].toFixed(1)} min`)
    expect(html).toContain(`P90 ${t.p90_min.toFixed(1)} min`)
  })
  it('Call urgency is a single-select radio group of numbered chips (no status colours), with a hint that it filters', () => {
    const html = metrics({ urgency: ['red'] })
    expect(html).toContain('Call urgency')
    expect(html).not.toMatch(/>Priority</)
    // the hint is for screen readers only (the chips already look and act like buttons)
    expect(html).toMatch(/class="sr-only" id="urgency-hint">Click to choose which calls the map and metrics analyse/)
    expect([...html.matchAll(/class="pri-num"[^>]*>(\d)</g)].map((m) => m[1])).toEqual(['1', '2', '3'])
    expect(html).toContain('Most urgent')
    expect(html).not.toMatch(/pri-(red|yellow|green)|Red \(most urgent\)/)
    expect((html.match(/class="pri-chip/g) || []).length).toBe(3)
    expect(html).toContain('role="radiogroup"')
    expect((html.match(/role="radio"/g) || []).length).toBe(3)
    expect((html.match(/aria-checked="true"/g) || []).length).toBe(1)
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
    expect(html).toContain('<span class="insights-place-name">Monroe</span><span>Wait Time Insights</span>')
    expect(html).toContain('Are calls arriving on time?')
    expect(html).toContain('Are more calls missing their response target?')
    expect(html).toContain('Response trends')
    expect(html).not.toContain('slider-arrow')
    expect(html).not.toMatch(/Where the delay sits|On-scene time trend/)
  })
  it('the whole page, rendered, has the brand and the layout regions and says "Selected place"', () => {
    const html = plain(renderToString(h(App)))
    expect(html).toContain('Selected place')
    expect(html).toContain('Key Metrics')
    expect(html).toContain('Wait Time Insights')
    expect(html).not.toContain('Toggle table for map')
    expect(html).toContain('Investigate')
    expect(html).not.toContain('Sentinel')
    expect(html).toContain('>Summary<')
  })
})

describe('Investigate sidebar', () => {
  it('lists the flagged places as table rows, one per place', async () => {
    const { default: InvestigateRail } = await import('./components/InvestigateRail.jsx')
    const { investigationRows } = await import('./components/InvestigationSection.jsx')
    const rows = investigationRows(summary.places)
    const html = plain(renderToString(h(InvestigateRail, { open: true, onClose() {}, summaryState: ok(summary), parent: STATE, selected: { level: 'state' }, onPick() {} })))
    expect(html).toContain('Investigate')
    expect(html).toMatch(/\d+ of \d+ counties need review/)
    expect(html).toContain('Act now')
    expect(rowNames(html).length).toBe(rows.length)
    expect(html).not.toContain('Collapse')
    const closed = plain(renderToString(h(InvestigateRail, { open: false, onClose() {}, summaryState: ok(summary), parent: STATE, selected: { level: 'state' }, onPick() {} })))
    expect(closed).toContain('inert=""')
  })
  it('the map has an Investigate edge tab with the review count; the top bar no longer has the button', () => {
    const html = map({ railOpen: false, onRail() {}, reviewCount: 7 })
    expect(html).toContain('class="edge-tab"')
    expect(html).toContain('aria-controls="investigate-rail"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Open the investigation list, 7 need review')
    expect(map({ railOpen: true, onRail() {}, reviewCount: 7 })).toContain('edge-tab is-open')
    const top = plain(renderToString(h(TopBar, { dataset: 'baseline', datasets: ['baseline'], onDataset() {}, replay: { on: false }, fixtures: false, replayHandlers: {} })))
    expect(top).not.toContain('tb-investigate')
  })
})

describe('date range message', () => {
  it('names both dates, says why, and how to fix it', async () => {
    const { rangeMessage } = await import('./components/PlaceHead.jsx')
    const msg = rangeMessage('2026-10-15', '2026-10-02')
    expect(msg).toContain('The end date (Oct 2, 2026) is before the start date (Oct 15, 2026)')
    expect(msg).toContain('Pick an end date on or after the start date, or swap the two dates.')
    expect(msg).not.toContain('From must be on or before To')
  })
})

describe('date limits: the calendars only offer valid days', () => {
  it('the month menu lists only the allowed months: no 2022-2024, nothing after the data', async () => {
    const { default: DatePicker, monthsBetween } = await import('./components/DatePicker.jsx')
    const months = monthsBetween('2025-12-15', '2026-10-15').map((x) => x.label)
    expect(months[0]).toBe('Dec 2025')
    expect(months[months.length - 1]).toBe('Oct 2026')
    expect(months).toHaveLength(11)
    const html = plain(renderToString(h(DatePicker, { id: 'd', label: 'start', value: '2026-07-18', min: '2025-12-15', max: '2026-10-15', onChange() {}, defaultOpen: true })))
    expect(html).toContain('Dec 2025')
    expect(html).not.toMatch(/202[2-4]/)
    expect(html).not.toContain('Nov 2025')
    expect(html).toContain('Available: Dec 15, 2025 to Oct 15, 2026')
  })
  it('days outside the range are disabled, and the arrows stop at the ends', async () => {
    const { default: DatePicker, monthCells } = await import('./components/DatePicker.jsx')
    const dec = monthCells(2025, 11, '2025-12-15', '2026-10-15').filter(Boolean)
    expect(dec.filter((c) => c.disabled).map((c) => c.day)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    const first = plain(renderToString(h(DatePicker, { id: 'd', label: 'start', value: '2025-12-20', min: '2025-12-15', max: '2026-10-15', onChange() {}, defaultOpen: true })))
    expect(first).toMatch(/aria-label="Previous month" disabled/)
    expect(first).not.toMatch(/aria-label="Next month" disabled/)
  })
  it('the To calendar starts at the chosen From; the From calendar ends at the chosen To', async () => {
    const { monthsBetween } = await import('./components/DatePicker.jsx')
    const html = head({ from: '2026-07-18', to: '2026-10-15', dateMin: '2025-12-15', dateMax: '2026-10-15' })
    expect(html).toContain('Jul 18, 2026')
    expect(html).toContain('Oct 15, 2026')
    expect(monthsBetween('2026-07-18', '2026-10-15').map((x) => x.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026', 'Oct 2026'])
  })
  it('a typed date outside the range gets a plain message (and no swap)', async () => {
    const { boundsMessage } = await import('./components/PlaceHead.jsx')
    expect(boundsMessage('2025-11-01', '2026-01-31', '2025-12-15', '2026-10-15')).toContain('Pick a start date on or after Dec 15, 2025')
    expect(boundsMessage('2026-09-01', '2026-11-30', '2025-12-15', '2026-10-15')).toContain('Pick Oct 15, 2026 or earlier')
    expect(boundsMessage('2026-07-18', '2026-10-15', '2025-12-15', '2026-10-15')).toBe('')
  })
})

describe('date range message controls', () => {
  it('the message has a Swap dates button and an x to dismiss it', async () => {
    const src = readFileSync(new URL('./components/PlaceHead.jsx', import.meta.url), 'utf8')
    expect(src).toContain('className="range-close" aria-label="Dismiss this message"')
    expect(src).toContain('Swap dates')
  })
})

describe('call urgency help', () => {
  it('each urgency chip says "Analyze only ..." and an i explains the 0-9 codes with a source', () => {
    const html = plain(renderToString(h(MetricsSection, {
      summaryState: ok(summary), parent: STATE, selected: { level: 'state', place: null }, urgency: ['red'],
      onToggleUrgency() {}, selection: summary.selection, dataset: 'baseline',
    })))
    expect(html).toContain('Analyze only most urgent calls (codes 0-2)')
    expect(html).toContain('Analyze only urgent calls (codes 3-5)')
    expect(html).toContain('Analyze only less urgent calls (codes 6-9)')
    expect(html).toContain('aria-label="How call urgency is defined"')
    expect(html).toContain('0 is the most')
    expect(html).toContain('Source: code field modeled on NYC Open Data')
  })
})

describe('Investigate table goal heading', () => {
  it('names the shared goal once; a place with a different goal shows its own in its row', async () => {
    const { sharedGoal } = await import('./components/InvestigateRail.jsx')
    expect(sharedGoal([{ goal_pct: 90 }, { goal_pct: 90 }, { goal_pct: 85 }])).toBe(90)
    expect(sharedGoal([])).toBe(null)
    expect(sharedGoal([{ goal_pct: null }])).toBe(null)
    const odd = { ...summary.places[0], goal_pct: 85 }
    const html = await railHtml({ summaryState: ok({ ...summary, places: [odd, ...summary.places.slice(1)] }), initialView: 'review' })
      + await railHtml({ summaryState: ok({ ...summary, places: [odd, ...summary.places.slice(1)] }), initialView: 'others' })
    expect(rowOf(html, odd.name)).toContain('· goal 85%')
  })
})
