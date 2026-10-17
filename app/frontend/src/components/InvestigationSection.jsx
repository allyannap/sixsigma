import { fmtCi, fmtDate, fmtInt, fmtPct } from '../format.js'
import { ATTENTION, STAGES, rankPlaces } from '../status.js'
import { Async, Judgments, Section, StatusBadge } from './common.jsx'

/** Flagged places: the three attention labels, then confirmed below-target places whose control could not be judged. */
export function investigationRows(places) {
  const ranked = rankPlaces(places)
  return [
    ...ranked.filter((p) => ATTENTION.includes(p.queue)),
    ...ranked.filter((p) => p.queue === 'needs_data' && p.spec === 'below'),
  ]
}

function signalText(p) {
  if (!p.signals || !p.signals.length) return p.control === 'insufficient_baseline' ? 'not assessable (insufficient baseline)' : 'none'
  const first = p.signals[0].start
  const last = p.signals[p.signals.length - 1].start
  return `${p.signals.length} ${p.unit}(s) above the limit, ${fmtDate(first)}${last !== first ? ` to ${fmtDate(last)}` : ''}`
}

export default function InvestigationSection({ summaryState, onPick }) {
  return (
    <Section num={4} id="section-4" title="Investigation list"
      intro="Every flagged area with its evidence. The topics are starting points for a review, not a chosen fix: the tool does not rank interventions.">
      <Async state={summaryState}>
        {(s) => {
          const rows = investigationRows(s.places)
          if (!rows.length) return <p>No area in this selection is flagged.</p>
          return (
            <div className="table-scroll" tabIndex={0} role="region" aria-label="Investigation list">
              <table className="places">
                <thead>
                  <tr>
                    <th scope="col">Area</th><th scope="col">Queue and judgments</th><th scope="col">Target evidence</th>
                    <th scope="col">Control evidence</th><th scope="col">Stage with most extra time</th><th scope="col">Topics to investigate</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const st = p.top_stage ? STAGES[p.top_stage] : null
                    return (
                      <tr key={p.id}>
                        <th scope="row"><button type="button" className="link-btn" onClick={() => onPick(p, false)}>{p.name}</button></th>
                        <td><StatusBadge status={p.queue} short /><div><Judgments p={p} /></div></td>
                        <td className="small">{fmtPct(p.on_time_pct)} on time ({fmtInt(p.on_time)} of {fmtInt(p.valid)}), 95% CI {fmtCi(p.on_time_ci, '%')}, goal {fmtPct(p.goal_pct, 0)}</td>
                        <td className="small">{signalText(p)}{p.baseline ? `; baseline ${fmtDate(p.baseline.from)} to ${fmtDate(p.baseline.to)}` : ''}</td>
                        <td className="small">{st ? `${st.label} (${st.who})` : 'no stage above typical'}</td>
                        <td className="small">{st ? st.topics.join('; ') : 'review the individual late calls'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }}
      </Async>
    </Section>
  )
}
