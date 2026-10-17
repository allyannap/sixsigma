import { fmtChanceBelow, fmtCi, fmtDate, fmtInt, fmtNum, fmtPct, fmtRange } from '../format.js'
import { ATTENTION, rankPlaces } from '../status.js'
import { Async, Judgments, Messages, Section, StatusBadge } from './common.jsx'

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

/** A row of the statewide flagged list -> what the page selects: the ZIP's county on the map, the ZIP itself in Section 2. */
export function flaggedSelection(row) {
  return {
    parent: { level: 'county', id: row.county_fips, name: row.county },
    selected: { level: 'zcta', id: row.id, name: row.id, place: null },
  }
}

function flaggedSignalText(h) {
  const sig = h.signals || []
  if (!sig.length) return 'none listed'
  return `${sig.length} period${sig.length === 1 ? '' : 's'} above the limit, from ${fmtDate(sig[0].start)}`
}

/** ZIP areas with a confirmed signal anywhere in the state, whatever county or ZIP is selected. */
export function FlaggedList({ data, onPick }) {
  const rows = data.flagged || []
  const chance = fmtChanceBelow(data.chance_below, 'ZIP areas')
  return (
    <div className="sub-block">
      <h3>ZIP areas with a confirmed signal anywhere in the state</h3>
      <p className="small">
        {fmtInt(data.n_flagged)} of {fmtInt(data.n_checked)} ZIP areas with 30 or more valid calls ({fmtRange(data.selection)}) have a confirmed
        signal (Act now or Recent change). This list covers the whole state, so a ZIP inside a county that looks fine still appears.
      </p>
      {chance && <p className="small muted" role="note">{chance}</p>}
      {rows.length === 0 ? <p>No ZIP area in the state has a confirmed signal in this period.</p> : (
        <div className="table-scroll short" tabIndex={0} role="region" aria-label="ZIP areas with a confirmed signal">
          <table className="places">
            <thead>
              <tr>
                <th scope="col">ZIP area</th><th scope="col">County</th><th scope="col">Queue and judgments</th>
                <th scope="col">On time [95% CI]</th><th scope="col">Excess late vs goal</th><th scope="col">Signal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.id}>
                  <th scope="row"><button type="button" className="link-btn" onClick={() => onPick(h)}>{h.id}</button></th>
                  <td>{h.county}</td>
                  <td><StatusBadge status={h.queue} short /><div><Judgments p={h} /></div></td>
                  <td className="mono">{fmtPct(h.on_time_pct)} <span className="muted">[{fmtCi(h.on_time_ci, '%')}]</span> <span className="muted">of {fmtInt(h.valid)} valid, goal {fmtPct(h.goal_pct, 0)}</span></td>
                  <td className="mono">{fmtNum(h.excess_late, 1)}</td>
                  <td className="small">{flaggedSignalText(h)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Messages messages={data.messages} />
    </div>
  )
}

export default function InvestigationSection({ summaryState, flaggedState, onPick, onPickFlagged }) {
  return (
    <Section num={3} id="section-3" title="Investigation list"
      intro="Every flagged area in the current map view with its evidence, then every ZIP area in the state with a confirmed signal. A starting point for a review: the tool does not choose or rank interventions.">
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
                    <th scope="col">Control evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <th scope="row"><button type="button" className="link-btn" onClick={() => onPick(p, false)}>{p.name}</button></th>
                      <td><StatusBadge status={p.queue} short /><div><Judgments p={p} /></div></td>
                      <td className="small">{fmtPct(p.on_time_pct)} on time ({fmtInt(p.on_time)} of {fmtInt(p.valid)}), 95% CI {fmtCi(p.on_time_ci, '%')}, goal {fmtPct(p.goal_pct, 0)}</td>
                      <td className="small">{signalText(p)}{p.baseline ? `; baseline ${fmtDate(p.baseline.from)} to ${fmtDate(p.baseline.to)}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }}
      </Async>
      {flaggedState && <Async state={flaggedState}>{(d) => <FlaggedList data={d} onPick={onPickFlagged} />}</Async>}
    </Section>
  )
}
