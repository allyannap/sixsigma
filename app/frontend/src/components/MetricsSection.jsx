// Key Metrics card (three tiles + a plain Summary) and the "Wait Time Insights" row that holds the two chart cards.
// Every number is read from /api/summary (totals, or the picked place's own card); this file only formats it.
import { fmtCi, fmtInt, fmtNum, fmtPct, fmtRange } from '../format.js'
import { QUEUE, TIERS, URGENCY, URGENCY_KEYS, tierOf } from '../status.js'
import { placeFor } from './PlaceHead.jsx'
import InsightsSlider from './InsightsSlider.jsx'
import { Spinner } from './common.jsx'

const TIER_LABEL = Object.fromEntries(TIERS.map((t) => [t.key, t.label]))

/**
 * The numbers the tiles show. Normally the totals of the area the map is drawn for (the selected place when it is
 * that area). When a different place was picked (table row), that place's own card from the same reply.
 */
export function metricsSource(summary, selected, parent) {
  if (!summary) return null
  const isParent = selected.level === parent.level && selected.id === parent.id
  if (isParent || !selected.id) return summary.totals || null
  return placeFor(summary, selected, parent) || summary.totals || null
}

const dash = (v, digits = 1) => (v == null || Number.isNaN(v) ? '—' : fmtNum(v, digits))

/** Three tiles: On time (k of n, 95% CI, goal), Median wait, P95 wait. A missing value shows "—" and the API's note. */
function Tiles({ t, note }) {
  if (!t) {
    return (
      <div className="metric-grid">
        {['On time', 'Median wait', 'P95 wait'].map((l) => (
          <div className="metric" key={l}><span className="metric-label">{l}</span><div className="metric-value"><span className="skel-value" aria-hidden="true" /><span className="sr-only">—</span></div><div className="metric-foot"><Spinner />Loading…</div></div>
        ))}
      </div>
    )
  }
  return (
    <div className="metric-grid">
      <div className="metric" aria-label="On time">
        <span className="metric-label">On time</span>
        <div className="metric-value"><span>{t.on_time_pct == null ? '—' : fmtPct(t.on_time_pct)}</span></div>
        <div className="metric-foot">
          {t.on_time_pct == null
            ? note
            : `${fmtInt(t.on_time)} of ${fmtInt(t.valid)} valid calls · 95% CI ${fmtCi(t.on_time_ci, '%')} · goal ${fmtPct(t.goal_pct, 0)}`}
        </div>
      </div>
      <div className="metric" aria-label="Median wait">
        <span className="metric-label">Median wait <span className="metric-sub">call received to on scene</span></span>
        <div className="metric-value"><span>{dash(t.median_min)}</span>{t.median_min != null && <span className="unit">min</span>}</div>
        <div className="metric-foot">{t.median_min == null ? note : `95% CI ${fmtCi(t.median_ci)} min`}</div>
      </div>
      <div className="metric" aria-label="P95 wait">
        <span className="metric-label">P95 wait <span className="metric-sub">1 call in 20 waited longer</span></span>
        <div className="metric-value"><span>{dash(t.p95_min)}</span>{t.p95_min != null && <span className="unit">min</span>}</div>
        <div className="metric-foot">{t.p95_min == null ? note : `95% CI ${fmtCi(t.p95_ci)} min · P90 ${t.p90_min == null ? 'n/a' : `${fmtNum(t.p90_min)} min`}`}</div>
      </div>
    </div>
  )
}

/** Plain text from the API's own words: queue label, target reason, control reason, and the queue's "next" hint. */
function Summary({ place, name, busy }) {
  const q = place ? QUEUE[place.queue] : null
  const tier = place ? tierOf(place.queue) : null
  return (
    <div className="summary">
      <div className="summary-head">
        <span className="summary-title">Summary</span>
        <span className="spacer" />
        {tier && <span className={`pattern-chip pattern-${tier}`}>{TIER_LABEL[tier]}</span>}
      </div>
      {place ? (
        <>
          <p className="summary-text">
            <strong>{name}: {q ? q.label : place.queue}.</strong>
            {' '}Target: {place.spec_reason || 'n/a'}.
            {' '}Control: {place.control_reason || 'n/a'}.
          </p>
          <p className="summary-foot">{q ? `Next: ${q.next}` : ''}</p>
        </>
      ) : (
        busy ? (
          <div className="loading" role="status">
            <p className="loading-line"><Spinner />Loading the summary...</p>
            <div className="skeleton" aria-hidden="true"><span /><span /></div>
          </div>
        ) : <p className="summary-text muted">No label yet for this place: it has no calls in this selection.</p>
      )}
    </div>
  )
}

export function MetricsSection({ summaryState, selected, parent, urgency, onToggleUrgency, selection, dataset }) {
  const s = summaryState.data
  const t = metricsSource(s, selected, parent)
  const place = placeFor(s, selected, parent)
  const name = selected.name || (s && s.selection && s.selection.name) || 'New York State'
  // A missing number shows "—" and the API's own first note (summary.messages), never a made-up value.
  const note = (s && s.messages && s.messages[0]) || 'No valid completed calls in this selection.'
  return (
    <section className="metrics-section" aria-labelledby="metrics-heading">
      <div className="sec-head">
        <h2 id="metrics-heading">Key Metrics</h2>
        <span className="section-note">{dataset}{selection ? ` · ${fmtRange(selection)}` : ''}</span>
      </div>
      <div className="card metrics-card">
        <div className="filterbar">
          <div className="filter-field" role="group" aria-label="Priority (urgency)">
            Priority
            <span className="priority-chips">
              {URGENCY_KEYS.map((k) => (
                <button key={k} type="button" className={`pri-chip pri-${k}`} aria-pressed={urgency.includes(k)} onClick={() => onToggleUrgency(k)}>
                  <i aria-hidden="true" />{URGENCY[k].label}
                </button>
              ))}
            </span>
          </div>
          <span className="filter-spacer" />
          <span className="filter-state">At least one group stays on. Pick one for a clean control chart. No time-of-day filter.</span>
        </div>

        <div className="metrics-body" aria-busy={summaryState.loading}>
          <Tiles t={t} note={note} />
          <div className="vdivider" role="presentation" />
          <Summary place={place} name={name} busy={summaryState.loading} />
        </div>
        {summaryState.error && (
          <div className="error" role="alert">
            <p><strong>The numbers are not available yet.</strong> {summaryState.error}</p>
            <button type="button" className="btn" onClick={summaryState.reload}>Try again</button>
          </div>
        )}
      </div>
    </section>
  )
}

/** "<Place> Wait Time Insights": the two chart cards go in as children and show one at a time in a slide card. */
export function InsightsSection({ placeName, selection, dataset, children }) {
  return (
    <section className="insights" aria-labelledby="insights-title">
      <div className="sec-head">
        <h2 className="insights-title" id="insights-title">{placeName} Wait Time Insights</h2>
        <span className="section-note">{dataset}{selection ? ` · ${fmtRange(selection)}` : ''}</span>
      </div>
      <InsightsSlider>{children}</InsightsSlider>
    </section>
  )
}
