import { Spinner } from './common.jsx'
import { useState } from 'react'
import EvidenceDrawer from './EvidenceDrawer.jsx'

export default function AISummary({ state, enabled, paused, fixtures }) {
  const [open, setOpen] = useState(false)
  return <div className="summary ai-summary" aria-live="polite" aria-busy={state.loading}>
    <div className="summary-head"><span className="summary-title">AI summary</span></div>
    {!enabled ? <p className="summary-text muted">Select a complete date range to generate a summary.</p>
      : fixtures ? <p className="summary-text muted">AI generation is disabled for test fixtures.</p>
        : paused ? <p className="summary-text muted">Pause replay to summarize the current period.</p>
          : state.loading ? <p className="summary-text" role="status"><Spinner />Reading the selected period…</p>
            : state.error ? <div role="alert"><p className="summary-text">{state.error}</p><button type="button" className="btn btn-small" onClick={state.reload}>Retry summary</button></div>
              : state.data ? <>
                <p className="summary-text">{state.data.text}</p>
                <button type="button" className="summary-read-more" onClick={() => setOpen(true)}>Read full briefing <span aria-hidden="true">↗</span></button>
                <EvidenceDrawer open={open} onClose={() => setOpen(false)} title="AI briefing" titleId="ai-summary-drawer-title">
                  <p className="comparison-context">{state.data.selection.name} · {state.data.selection.from} to {state.data.selection.to} · {state.data.selection.urgency.join(', ')} priority</p>
                  <p className="briefing-full-text">{state.data.text}</p>
                  <p className="simple-proof">{state.data.status === 'ok' ? 'Ollama · ' : ''}Synthetic data · Decision support grounded in the selected dashboard data.</p>
                </EvidenceDrawer>
              </> : <p className="summary-text muted">Summary unavailable for this selection.</p>}
  </div>
}
