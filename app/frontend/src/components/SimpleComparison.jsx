import { useState } from 'react'
import { fmtInt, fmtMin, fmtPct, fmtCi } from '../format.js'

const LABELS = { below: 'Below goal', meets: 'Meets goal', inconclusive: 'Uncertain' }
const COLORS = { below: '#C2410C', inconclusive: '#A3AAB1', meets: '#0072B2' }
const STACK = ['below', 'inconclusive', 'meets']
const W = 520, PAD = 12, TOP = 22, PLOT = 170, BIN = 10

export function goalGap(p) {
  if (p.on_time_pct == null || p.goal_pct == null) return 'No valid rate'
  const gap = p.on_time_pct - p.goal_pct
  if (Math.abs(gap) < .05) return 'At the observed goal'
  return `${Math.abs(gap).toFixed(1)} percentage points ${gap < 0 ? 'below' : 'above'} goal`
}

export function comparisonAreas(places) {
  return places.filter((p) => p.response_profile?.n > 0)
    .sort((a, b) => a.on_time_pct - b.on_time_pct || a.name.localeCompare(b.name))
}

// Lowest rates among areas with at least 30 calls, so one unlucky call in a tiny area is not called extreme.
export function extremes(areas, k = 3) {
  return areas.filter((p) => !p.response_profile.low_n).slice(0, k)
}

export function median(values) {
  const s = [...values].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function ordinal(n) {
  const t = n % 100, o = n % 10
  return n + (t >= 11 && t <= 13 ? 'th' : o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th')
}

// 10-point bins from the first bin holding an area (or the goal) up to 100; 100% falls in the last bin.
export function histogram(areas, goal) {
  const lo = Math.floor(Math.min(goal, ...areas.map((p) => p.on_time_pct)) / BIN) * BIN
  const bins = []
  for (let from = Math.min(lo, 100 - BIN); from < 100; from += BIN) bins.push({ from, to: from + BIN, areas: [], below: 0, inconclusive: 0, meets: 0 })
  for (const p of areas) {
    const b = bins[Math.min(bins.length - 1, Math.floor((p.on_time_pct - bins[0].from) / BIN))]
    b.areas.push(p)
    b[STACK.includes(p.spec) ? p.spec : 'inconclusive']++
  }
  return bins
}

function Histogram({ bins, goal, selected, openBin, onOpen }) {
  const lo = bins[0].from
  const x = (v) => PAD + (v - lo) / (100 - lo) * (W - 2 * PAD)
  const bw = (W - 2 * PAD) / bins.length
  const max = Math.max(...bins.map((b) => b.areas.length))
  const h = (c) => c / max * PLOT
  const base = TOP + PLOT
  const H = base + 34
  return <svg className="hist" viewBox={`0 0 ${W} ${H}`} role="img"
    aria-label={`Number of areas by on-time rate. ${bins.map((b) => `${b.from}–${b.to}%: ${b.areas.length}`).join('; ')}. Goal ${fmtPct(goal, 0)}.`}>
    {bins.map((b, i) => {
      let y = base
      const open = openBin === i
      return <g key={b.from} className={`hist-bin ${open ? 'hist-open' : ''}`} onClick={() => onOpen(open ? null : i)}>
        <title>{`${b.from}–${b.to}% on time: ${b.areas.length} area${b.areas.length === 1 ? '' : 's'}. Click to list them.`}</title>
        <rect x={PAD + i * bw} y={TOP - 18} width={bw} height={PLOT + 18} fill={open ? '#EDF4FC' : 'transparent'} rx="4" />
        {STACK.map((s) => {
          if (!b[s]) return null
          y -= h(b[s])
          return <rect key={s} className="hist-bar" x={PAD + i * bw + 2} y={y} width={bw - 4} height={h(b[s])} fill={COLORS[s]} />
        })}
        {b.areas.length > 0 && <text x={PAD + (i + .5) * bw} y={y - 5} textAnchor="middle" className="hist-count">{b.areas.length}</text>}
      </g>
    })}
    <line x1={PAD} x2={W - PAD} y1={base} y2={base} stroke="#9AA1A8" />
    {bins.map((b) => <text key={b.from} x={x(b.from)} y={base + 14} textAnchor="middle" className="hist-tick">{b.from}%</text>)}
    <text x={x(100)} y={base + 14} textAnchor="end" className="hist-tick">100%</text>
    <line x1={x(goal)} x2={x(goal)} y1={TOP - 14} y2={base + 2} stroke="#1F2933" strokeWidth="2" strokeDasharray="5 3" />
    <text x={x(goal) - 5} y={TOP - 6} textAnchor="end" className="hist-goal">Goal {fmtPct(goal, 0)}</text>
    <path d={`M${x(selected.on_time_pct)} ${base + 20} l-6 9 h12 z`} fill="#1F2933" />
  </svg>
}

// "Mostly rural · 78% of calls" when one type has at least 60% of valid calls; otherwise the two largest.
export function areaTag(mix) {
  if (!mix) return null
  const [[t1, v1], [t2, v2]] = Object.entries(mix).sort((a, b) => b[1] - a[1])
  if (v1 >= 60) return { kind: t1, text: `Mostly ${t1} · ${Math.round(v1)}% of calls` }
  return { kind: 'mixed', text: `Mixed · ${Math.round(v1)}% ${t1}, ${Math.round(v2)}% ${t2}` }
}

function AreaTypeTag({ mix }) {
  const [open, setOpen] = useState(false)
  const tag = areaTag(mix)
  if (!tag) return null
  return <div className="area-type">
    <span className={`area-tag tag-${tag.kind}`}>{tag.text}</span>
    <button type="button" className="info-btn" aria-expanded={open} aria-label="Why area type matters" onClick={() => setOpen(!open)}>i</button>
    {open && <p className="info-pop">One target applies to every area. Rural and remote areas have longer drives, so their waits run higher, and a low on-time rate there may reflect distance, not dispatch. This view does not adjust for area type. Area type comes from each call's ZIP code (2020 Census).</p>}
  </div>
}

function AreaCard({ p, areas, deadline, goal, from, onBack }) {
  const r = p.response_profile
  return <>
    {from && <button type="button" className="card-back" onClick={onBack}>← {from.from}–{from.to}% areas</button>}
    <div className="card-head">
      <div><div className="eyebrow">{ordinal(areas.indexOf(p) + 1)} worst of {areas.length} · {fmtInt(r.n)} calls</div><h3>{p.name}</h3></div>
      <span className={`card-badge badge-${p.spec}`}>{LABELS[p.spec] || 'Uncertain'}</span>
    </div>
    <AreaTypeTag key={p.id} mix={p.area_mix} />
    <p className="card-rate"><strong className={`card-big rate-${p.spec}`}>{fmtPct(p.on_time_pct, 0)}</strong> of calls arrived within {deadline}</p>
    <p className="card-gap">{goalGap(p)} of {fmtPct(goal, 0)}</p>
    <div className="card-pair">
      <div><strong>{fmtMin(r.median_min)}</strong><span>Half of calls arrive by</span></div>
      <div><strong>{fmtMin(r.p90_min)}</strong><span>Slowest 1 in 10 start at</span></div>
    </div>
    <p className="card-foot">Longest wait: <strong>{fmtMin(r.max_min)}</strong></p>
    {r.low_n && <p className="card-caution"><strong>Limited data.</strong> Under 30 calls; this rate may change a lot with the next call.</p>}
  </>
}

function BinList({ bin, selectedId, onPick, onClose }) {
  return <>
    <div className="card-head">
      <div><div className="eyebrow">{bin.areas.length} area{bin.areas.length === 1 ? '' : 's'}</div><h3>{bin.from}–{bin.to}% on time</h3></div>
      <button type="button" className="chip-close" onClick={onClose} aria-label="Close list">×</button>
    </div>
    <ul className="bin-list">
      {bin.areas.map((p) => <li key={p.id}><button type="button" className={p.id === selectedId ? 'bin-on' : ''} onClick={() => onPick(p.id)}>
        <i className={`k k-${p.spec}`} /><span>{p.name}{p.response_profile.low_n ? <small> · under 30 calls</small> : null}</span><strong>{fmtPct(p.on_time_pct, 0)}</strong>
      </button></li>)}
    </ul>
    {!bin.areas.length && <p className="muted">No areas in this band.</p>}
  </>
}

export default function SimpleComparison({ d }) {
  const [selectedId, setSelectedId] = useState('')
  const [openBin, setOpenBin] = useState(null)
  const [listing, setListing] = useState(false)
  const [query, setQuery] = useState('')
  if (d.selection?.urgency?.length !== 1) return <p className="muted">Choose one urgency group to see this view.</p>
  const places = d.places || []
  if (places.some((p) => !p.response_profile)) return <p className="muted">Restart the dashboard server to load the updated analysis.</p>
  const areas = comparisonAreas(places)
  if (!areas.length || d.totals?.on_time_pct == null) return <p className="muted">No valid completed calls in this selection.</p>
  const top = extremes(areas)
  const selected = areas.find((p) => p.id === selectedId) || top[0] || areas[0]
  const goal = selected.goal_pct
  const missing = areas.filter((p) => p.on_time_pct < goal).length
  const below = areas.filter((p) => p.spec === 'below').length
  const bins = histogram(areas, goal)
  const bin = openBin != null ? bins[openBin] : null
  const target = selected.response_profile.target_min
  const deadline = target != null ? `${Number(target.toFixed(2))} min` : 'the configured call target'
  const pick = (id) => { setSelectedId(id); setListing(false); setQuery('') }
  const openList = (i) => { setOpenBin(i); setListing(i != null) }
  const search = (text) => {
    setQuery(text)
    const hit = areas.find((p) => p.name.toLowerCase() === text.trim().toLowerCase())
    if (hit) { pick(hit.id); setOpenBin(null) }
  }
  return <div className="simple-comparison">
    <p className="simple-goal"><strong>Goal: {fmtPct(goal, 0)} of calls arrive within {deadline} of call receipt.</strong></p>
    <p className="simple-overview" role="status"><strong>{missing} of {areas.length} areas</strong> miss the {fmtPct(goal, 0)} goal ({below} confirmed) · the typical area: {fmtPct(median(areas.map((p) => p.on_time_pct)), 0)} on time</p>
    <div className="simple-split">
      <div className="simple-chart">
        <Histogram bins={bins} goal={goal} selected={selected} openBin={openBin} onOpen={openList} />
        <p className="simple-key"><span><i className="k k-below" />Below goal</span><span><i className="k k-inconclusive" />Uncertain</span><span><i className="k k-meets" />Meets goal</span><span>▲ selected area · click a bar to see its areas</span></p>
        {top.length > 0 && <p className="hist-worst"><strong>Furthest below:</strong>{top.map((p) => <button type="button" key={p.id} className={`chip chip-below ${p.id === selected.id ? 'chip-on' : ''}`} aria-pressed={p.id === selected.id} aria-controls="simple-selected" onClick={() => { pick(p.id); setOpenBin(null) }}>{p.name} {fmtPct(p.on_time_pct, 0)}</button>)}</p>}
      </div>
      <section id="simple-selected" className={`simple-card ${listing && bin ? '' : `card-${selected.spec}`}`} aria-live="polite">
        <input className="card-search" type="search" list="simple-area-names" placeholder="Search an area…" aria-label="Search an area by name" value={query} onChange={(e) => search(e.target.value)} />
        <datalist id="simple-area-names">{[...areas].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.name} />)}</datalist>
        {listing && bin
          ? <BinList bin={bin} selectedId={selected.id} onPick={pick} onClose={() => openList(null)} />
          : <AreaCard p={selected} areas={areas} deadline={deadline} goal={goal} from={bin} onBack={() => setListing(true)} />}
      </section>
    </div>
    <details className="simple-more">
      <summary>How certain is this?</summary>
      <p className="simple-proof">{selected.name}: {fmtPct(selected.on_time_pct)} on time against a {fmtPct(goal)} goal. 95% on-time uncertainty interval: {fmtCi(selected.on_time_ci, '%')}. {LABELS[selected.spec] || 'Uncertain'}: {selected.spec_reason}. The slowest-1-in-10 time is the observed 90th percentile, not a worst-case guarantee.</p>
      <p className="simple-proof">Each bar counts areas whose on-time rate falls in that 10-point band. Orange = the area's 95% interval is fully under the goal (confirmed below); blue = fully at or above it; gray = the interval crosses the goal, so the data cannot tell yet. "Furthest below" skips areas with under 30 calls.</p>
      <p className="simple-proof">The typical area is the median of area rates. Counted per call instead, {fmtPct(d.totals.on_time_pct)} of {fmtInt(d.totals.valid)} calls were on time (95% interval {fmtCi(d.totals.on_time_ci, '%')}); it differs from the typical area because busy areas count more. Targets are configurable placeholders. Cancelled and invalid-time calls are excluded.</p>
    </details>
  </div>
}
