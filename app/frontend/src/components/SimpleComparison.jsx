import { useEffect, useRef, useState } from 'react'
import { fmtInt, fmtMin, fmtPct, fmtCi } from '../format.js'
import EvidenceDrawer from './EvidenceDrawer.jsx'

const LABELS = { below: 'Below goal', meets: 'Meets goal', inconclusive: 'Uncertain' }
const COLORS = { below: '#C2410C', inconclusive: '#A3AAB1', meets: '#0072B2' }
const STACK = ['below', 'inconclusive', 'meets']
const PAD = 16, TOP = 36, BIN = 10

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
  const ref = useRef(null)
  const [size, setSize] = useState({ width: 520, height: 244 })
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ width, height })
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  const W = size.width, H = size.height, PLOT = Math.max(32, H - TOP - 34)
  const lo = bins[0].from
  const x = (v) => PAD + (v - lo) / (100 - lo) * (W - 2 * PAD)
  const bw = (W - 2 * PAD) / bins.length
  const max = Math.max(...bins.map((b) => b.areas.length))
  const h = (c) => c / max * PLOT
  const base = TOP + PLOT
  return <svg ref={ref} className="hist" viewBox={`0 0 ${W} ${H}`} role="group"
    aria-label={`Number of areas by on-time rate. ${bins.map((b) => `${b.from}–${b.to}%: ${b.areas.length}`).join('; ')}. Goal ${fmtPct(goal, 0)}.`}>
    {bins.map((b, i) => {
      let y = base
      const open = openBin === i
      return <g key={b.from} className={`hist-bin ${open ? 'hist-open' : ''}`} role="button" tabIndex={0}
        aria-label={`${b.from}–${b.to}% on time: ${b.areas.length} areas. View areas.`}
        onKeyDown={(event) => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); onOpen(i) } }}
        onClick={() => onOpen(open ? null : i)}>
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
    <line x1={x(goal)} x2={x(goal)} y1={TOP - 24} y2={base + 2} stroke="#1F2933" strokeWidth="2" strokeDasharray="5 3" />
    <text x={x(goal)} y={TOP - 25} textAnchor={goal <= lo ? 'start' : goal >= 98 ? 'end' : 'middle'} className="hist-goal">Goal {fmtPct(goal, 0)}</text>
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
    {open && <p className="info-pop">Red targets vary by area type (urban 8 min, suburban 10 min, rural and remote 14 min); yellow and green targets are 15 and 30 min. Rural and remote areas have longer drives. Rates use each call’s configured target; this view does not otherwise adjust for traffic, distance or resources. Area type comes from each call's ZIP code (2020 Census).</p>}
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

export default function SimpleComparison({ d, selectedArea, onPick }) {
  const [selectedId, setSelectedId] = useState('')
  const [openBin, setOpenBin] = useState(null)
  const [listing, setListing] = useState(false)
  const [query, setQuery] = useState('')
  const [detailsOpen, setDetailsOpen] = useState(false)
  if (d.selection?.urgency?.length !== 1) return <p className="muted">Choose one urgency group to see this view.</p>
  const places = d.places || []
  if (places.some((p) => !p.response_profile)) return <p className="muted">Restart the dashboard server to load the updated analysis.</p>
  const areas = comparisonAreas(places)
  if (!areas.length || d.totals?.on_time_pct == null) return <p className="muted">No valid completed calls in this selection.</p>
  const top = extremes(areas)
  const selected = areas.find((p) => p.id === (selectedArea?.id || selectedId)) || top[0] || areas[0]
  const goal = selected.goal_pct
  const below = areas.filter((p) => p.spec === 'below').length
  const bins = histogram(areas, goal)
  const bin = openBin != null ? bins[openBin] : null
  const target = selected.response_profile.target_min
  const targets = [...new Set(areas.map((p) => p.response_profile.target_min))]
  const overallDeadline = targets.length === 1 && targets[0] != null ? `${Number(targets[0].toFixed(2))} min` : 'their configured call target'
  const deadline = target != null ? `${Number(target.toFixed(2))} min` : 'the configured call target'
  const pick = (id) => { setSelectedId(id); setListing(false); setQuery(''); const place = areas.find((p) => p.id === id); if (place && onPick) onPick(place, false) }
  const openList = (i) => { setOpenBin(i); setListing(i != null); if (i != null) setDetailsOpen(true) }
  const search = (text) => {
    setQuery(text)
    const hit = areas.find((p) => p.name.toLowerCase() === text.trim().toLowerCase())
    if (hit) { pick(hit.id); setOpenBin(null) }
  }
  return <div className="simple-comparison">
    <p className="simple-goal"><strong>Goal: {fmtPct(goal, 0)} on time</strong> · within {overallDeadline} of call receipt.</p>
    <p className="simple-overview" role="status"><strong>{below} of {areas.length} areas</strong> are confirmed below goal.</p>
    <div className="comparison-plot">
      <div className="simple-chart">
        <Histogram bins={bins} goal={goal} selected={selected} openBin={openBin} onOpen={openList} />
        <p className="simple-key"><span><i className="k k-below" />Below goal</span><span><i className="k k-inconclusive" />Uncertain</span><span><i className="k k-meets" />Meets goal</span><span>▲ selected area</span></p>
      </div>
    </div>
    <section id="simple-selected" className={`comparison-selection selection-${selected.spec}`} aria-label="Selected area overview" aria-live="polite">
      <div className="comparison-selection-head"><strong>{selected.name}</strong><span className={`card-badge badge-${selected.spec}`}>{LABELS[selected.spec] || 'Uncertain'}</span><span className="comparison-calls">{fmtInt(selected.response_profile.n)} calls</span></div>
      <div className="comparison-selection-stats">
        <div><strong className={`rate-${selected.spec}`}>{fmtPct(selected.on_time_pct, 1)}</strong><span>On time · {deadline}</span></div>
        <div><strong>{fmtMin(selected.response_profile.p90_min)}</strong><span>Slowest 1 in 10</span></div>
      </div>
    </section>
    <div className="comparison-actions"><span>Choose a bar to explore areas</span><button type="button" onClick={() => { setListing(false); setDetailsOpen(true) }}>Details & confidence <span aria-hidden="true">↗</span></button></div>
    <EvidenceDrawer open={detailsOpen} onClose={() => setDetailsOpen(false)}>
      <p className="comparison-context">{d.selection.name} · {d.selection.from} – {d.selection.to} · {d.selection.urgency[0]} priority</p>
      <section className={`simple-card card-${selected.spec}`}>
        <input className="card-search" type="search" list="simple-area-names" placeholder="Search an area…" aria-label="Search an area by name" value={query} onChange={(e) => search(e.target.value)} />
        <datalist id="simple-area-names">{[...areas].sort((a, b) => a.name.localeCompare(b.name)).map((p) => <option key={p.id} value={p.name} />)}</datalist>
        {listing && bin
          ? <BinList bin={bin} selectedId={selected.id} onPick={pick} onClose={() => openList(null)} />
          : <div className="card-scroll"><AreaCard p={selected} areas={areas} deadline={deadline} goal={goal} from={bin} onBack={() => setListing(true)} /></div>}
      </section>
      {top.length > 0 && <div className="comparison-priorities"><h3>Lowest on-time rates</h3><p className="hist-worst">{top.map((p) => <button type="button" key={p.id} className={`chip chip-below ${p.id === selected.id ? 'chip-on' : ''}`} aria-pressed={p.id === selected.id} onClick={() => { pick(p.id); setOpenBin(null) }}>{p.name} {fmtPct(p.on_time_pct, 0)}</button>)}</p></div>}
    <details className="simple-more" open>
      <summary>How certain is this?</summary>
      <p className="simple-proof">{selected.name}: {fmtPct(selected.on_time_pct)} on time against a {fmtPct(goal)} goal. 95% on-time uncertainty interval: {fmtCi(selected.on_time_ci, '%')}. {LABELS[selected.spec] || 'Uncertain'}: {selected.spec_reason}. The slowest-1-in-10 time is the observed 90th percentile, not a worst-case guarantee.</p>
      <p className="simple-proof">Each bar counts areas whose on-time rate falls in that 10-point band. Orange = the area's 95% interval is fully under the goal (confirmed below); blue = fully at or above it; gray = the interval crosses the goal, so the data cannot tell yet. "Furthest below" skips areas with under 30 calls.</p>
      <p className="simple-proof">Counted per call, {fmtPct(d.totals.on_time_pct)} of {fmtInt(d.totals.valid)} calls were on time (95% interval {fmtCi(d.totals.on_time_ci, '%')}); busy areas count more in this overall rate. Targets are configurable placeholders; red targets vary by area type. Comparisons are not evidence of unfair service. Cancelled and invalid-time calls are excluded.</p>
    </details>
    </EvidenceDrawer>
  </div>
}
