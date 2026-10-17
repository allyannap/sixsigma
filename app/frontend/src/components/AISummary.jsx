import { Spinner } from './common.jsx'

export default function AISummary({ state, enabled, paused, fixtures }) {
  return <div className="summary ai-summary" aria-live="polite" aria-busy={state.loading}>
    <div className="summary-head"><span className="summary-title">AI summary</span></div>
    {!enabled ? <p className="summary-text muted">Select a complete date range to generate a summary.</p>
      : fixtures ? <p className="summary-text muted">AI generation is disabled for test fixtures.</p>
        : paused ? <p className="summary-text muted">Pause replay to summarize the current period.</p>
          : state.loading ? <p className="summary-text" role="status"><Spinner />Reading the selected period…</p>
            : state.error ? <div role="alert"><p className="summary-text">{state.error}</p><button type="button" className="btn btn-small" onClick={state.reload}>Retry summary</button></div>
              : state.data ? <>
                <p className="summary-text">{state.data.text}</p>
                <p className="summary-foot">{state.data.status === 'ok' ? 'Ollama · ' : ''}Synthetic data · {state.data.selection.name} · {state.data.selection.from} to {state.data.selection.to} · {state.data.selection.urgency.join(', ')}</p>
              </> : <p className="summary-text muted">Summary unavailable for this selection.</p>}
  </div>
}
