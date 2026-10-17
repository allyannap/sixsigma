import { logScale, logTicks } from '../charts.js'
import { fmtInt, fmtMin } from '../format.js'
import { Async, Messages, Section } from './common.jsx'

const VERDICT = {
  slower: { text: 'slower than the rest', color: '#B42318', shape: 'square' },
  faster: { text: 'faster than the rest', color: '#1E6B3A', shape: 'triangle' },
  inside: { text: 'within chance range', color: '#3F6591', shape: 'circle' },
}
const ORDER = { slower: 0, faster: 1, inside: 2 }
const MAX_ROWS = 20

function Marker({ x, y, shape, color }) {
  if (shape === 'square') return <rect x={x - 6} y={y - 6} width="12" height="12" fill={color} />
  if (shape === 'triangle') return <path d={`M${x} ${y - 7}L${x + 7} ${y + 6}L${x - 7} ${y + 6}Z`} fill={color} />
  return <circle cx={x} cy={y} r="6" fill={color} />
}

function AnomChart({ d }) {
  const all = d.places || []
  const rows = [...all]
    .sort((a, b) => (ORDER[a.verdict] ?? 3) - (ORDER[b.verdict] ?? 3) || b.mean_min - a.mean_min)
    .slice(0, MAX_ROWS)
  if (!rows.length) return <p>No places to compare.</p>
  const lo = Math.min(...rows.flatMap((r) => [r.lower_min, r.ci_min[0]])) * 0.95
  const hi = Math.max(...rows.flatMap((r) => [r.upper_min, r.ci_min[1]])) * 1.05
  const x = logScale(lo, hi, 150, 560)
  const rowH = 30
  const top = 34
  const H = top + rows.length * rowH + 50
  const axisY = top + rows.length * rowH + 4
  return (
    <svg viewBox={`0 0 720 ${H}`} className="chart" role="img"
      aria-label={`Typical wait by place against the overall mean of ${fmtMin(d.grand_mean_min)}. ${all.filter((r) => r.verdict === 'slower').length} places are slower than the chance range and ${all.filter((r) => r.verdict === 'faster').length} faster.`}>
      {rows.map((r, i) => {
        const y = top + i * rowH + 14
        const v = VERDICT[r.verdict] || VERDICT.inside
        return (
          <g key={r.id}>
            <rect x={x(r.lower_min)} y={y - 11} width={Math.max(1, x(r.upper_min) - x(r.lower_min))} height="22" fill="#E3E6E1" />
            <line x1={x(r.ci_min[0])} x2={x(r.ci_min[1])} y1={y} y2={y} stroke={v.color} strokeWidth="2" />
            <Marker x={x(r.mean_min)} y={y} shape={v.shape} color={v.color} />
            <text x="8" y={y + 4} fontSize="13" fontWeight="600" fill="#17201C">{r.name.length > 20 ? `${r.name.slice(0, 19)}...` : r.name}</text>
            <text x="574" y={y + 4} fontSize="12" fontWeight="600" fill={v.color}>{v.text}</text>
            <title>{`${r.name}: typical wait ${fmtMin(r.mean_min)} (${fmtInt(r.n)} calls), ${v.text}`}</title>
          </g>
        )
      })}
      <line x1={x(d.grand_mean_min)} x2={x(d.grand_mean_min)} y1={top - 6} y2={axisY} stroke="#17201C" strokeWidth="1.5" strokeDasharray="6 4" />
      <text x={x(d.grand_mean_min)} y="16" fontSize="11" fontWeight="600" textAnchor="middle" fill="#17201C">overall: {fmtMin(d.grand_mean_min)}</text>
      <line x1="150" x2="560" y1={axisY} y2={axisY} stroke="#9AA39D" />
      {logTicks(lo, hi).map((t) => (
        <text key={t} x={x(t)} y={axisY + 16} fontSize="11" textAnchor="middle" fill="#56615B">{t}</text>
      ))}
      <text x="355" y={axisY + 32} fontSize="11" textAnchor="middle" fill="#56615B">typical wait (minutes, log scale)</text>
    </svg>
  )
}

export default function AnomSection({ anomState }) {
  return (
    <Section num={4} id="section-4" title="Geographic comparison within one urgency group" tag="Secondary, descriptive"
      intro="Which places have typically longer waits than the others, for the same urgency group. This is descriptive: it is not adjusted for time of day, traffic, distance, call mix or resources, so a slower place is not evidence of unfair service. The on-time rate in Section 1 is the main measure.">
      <Async state={anomState}>
        {(d) => {
          const ps = d.places || []
          const slower = ps.filter((p) => p.verdict === 'slower')
          const faster = ps.filter((p) => p.verdict === 'faster')
          if (!ps.length) return <Messages messages={d.messages} />
          return (
            <>
              <p className="callout blue" role="status">
                Of {ps.length} places with 30 or more valid calls, {slower.length} have typical waits above the chance range around the overall {fmtMin(d.grand_mean_min)}
                {slower.length ? ` (${slower.slice(0, 4).map((p) => p.name).join(', ')}${slower.length > 4 ? ', ...' : ''})` : ''} and {faster.length} below it.
              </p>
              <figure className="figure">
                <figcaption>
                  <strong>Typical wait in each place</strong> <code className="analyst">analysis of means (ANOM) on ln(minutes)</code>
                  <span className="caption">
                    Each mark is a place's typical (geometric mean) wait with its 95% interval. The gray band is the range a place can drift from the
                    overall mean by chance alone. A mark <strong className="red">right of its band</strong> (square) is slower than the rest;
                    {' '}<strong className="green">left of it</strong> (triangle), faster.
                    {ps.length > MAX_ROWS ? ` Showing the first ${MAX_ROWS} of ${ps.length} places, slower ones first.` : ''}
                  </span>
                </figcaption>
                <AnomChart d={d} />
              </figure>
              <details className="math">
                <summary>Show the math</summary>
                <p>
                  Analysis of means on ln(minutes) within the selected urgency group. Decision limits use h = {d.h} for k = {d.k} places and
                  N = {fmtInt(d.N)} calls (Bonferroni t). One-way ANOVA: F({d.df1}, {d.df2}) = {d.F}.
                </p>
              </details>
              <Messages messages={d.messages} />
            </>
          )
        }}
      </Async>
    </Section>
  )
}
