import { Spinner } from './common.jsx'
import { useState } from 'react'
import EvidenceDrawer from './EvidenceDrawer.jsx'

const TIER_LABEL = { critical: 'Critical', watch: 'Watch', near: 'Near goal', stable: 'Stable', nodata: 'Too few calls' }

function emphasize(text) {
  return String(text || '').split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part)
}

export default function AISummary({ state, enabled, paused, fixtures }) {
  const [open, setOpen] = useState(false)
  const card = state.data
  const tone = ['critical', 'watch', 'near', 'stable', 'nodata'].includes(card?.tone) ? card.tone : 'nodata'
  const label = TIER_LABEL[tone]
  return <div className={`summary ai-summary ai-tone-${tone}`} aria-live="polite" aria-busy={state.loading}>
    <div className="summary-head"><span className="summary-title">Summary</span>
      {card && <span className={`ai-status-pill ai-status-${tone}`}>{label}</span>}
    </div>
    {!enabled ? <p className="summary-text muted">Select a complete date range to generate a summary.</p>
      : fixtures ? <p className="summary-text muted">AI generation is disabled for test fixtures.</p>
        : paused ? <p className="summary-text muted">Pause replay to summarize the current period.</p>
          : state.loading ? <p className="summary-text" role="status"><Spinner />Reading the selected period…</p>
            : state.error ? <div role="alert"><p className="summary-text">{state.error}</p><button type="button" className="btn btn-small" onClick={state.reload}>Retry summary</button></div>
              : card ? <>
                <p className="summary-text ai-finding">{emphasize(card.finding || card.text)}</p>
                {card.next_step && <p className="ai-next"><strong>Next:</strong> {emphasize(card.next_step)}</p>}
                <button type="button" className="summary-read-more" onClick={() => setOpen(true)}>
                  Read full briefing <span aria-hidden="true">↗</span>
                </button>
                <EvidenceDrawer open={open} onClose={() => setOpen(false)} title="AI briefing" titleId="ai-summary-drawer-title">
                  <p className="comparison-context">{card.selection.name} · {card.selection.from} to {card.selection.to} · {card.selection.urgency.join(', ')} priority</p>
                  <h3 className={`ai-finding-title ai-drawer-title ai-text-${tone}`}>{card.selection.name}: {label}.</h3>
                  <p className="briefing-full-text">{emphasize(card.full_briefing || card.finding || card.text)}</p>
                  {card.next_step && <p className="ai-next ai-drawer-next"><strong>Next:</strong> {emphasize(card.next_step)}</p>}
                  <p className="simple-proof">{card.status === 'ok' ? 'Ollama · ' : ''}Synthetic data · Decision support grounded in the selected dashboard data.</p>
                </EvidenceDrawer>
              </> : <p className="summary-text muted">Summary unavailable for this selection.</p>}
  </div>
}
