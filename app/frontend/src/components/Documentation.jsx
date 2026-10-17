import { useEffect, useRef, useState } from 'react'
import { Icon } from './common.jsx'

const SECTIONS = [
  ['overview', 'Overview'],
  ['workflow', 'Dashboard workflow'],
  ['controls', 'Filters and replay'],
  ['metrics', 'Metrics and judgments'],
  ['data', 'Data and definitions'],
  ['methods', 'Methods and assumptions'],
  ['limitations', 'Limitations'],
  ['references', 'References'],
]

const REPO = 'https://github.com/allyannap/sixsigma/blob/main'

export function findDocumentationSections(query, sections) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return sections.map(({ id }) => id)
  return sections
    .filter(({ text }) => terms.every((term) => text.toLocaleLowerCase().includes(term)))
    .map(({ id }) => id)
}

export default function Documentation({ open, onClose }) {
  const dialogRef = useRef(null)
  const closeRef = useRef(null)
  const contentRef = useRef(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchMatches, setSearchMatches] = useState(null)

  const handleSearch = (event) => {
    const query = event.currentTarget.value
    setSearchQuery(query)
    const sections = [...(contentRef.current?.querySelectorAll('section') || [])]
      .map((section) => ({ id: section.id, text: section.textContent || '' }))
    setSearchMatches(findDocumentationSections(query, sections))
  }

  const clearSearch = () => {
    setSearchQuery('')
    setSearchMatches(null)
  }

  const visibleSectionIds = searchQuery.trim()
    ? new Set(searchMatches || [])
    : null

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) {
      dialog.showModal()
      contentRef.current?.scrollTo(0, 0)
      clearSearch()
      closeRef.current?.focus()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={dialogRef} className="documentation" aria-labelledby="documentation-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="documentation-shell">
        <header className="documentation-head">
          <div>
            <span className="eyebrow">OnScene · User and methods guide</span>
            <h2 id="documentation-title">Documentation</h2>
            <p>How to use the dashboard, interpret its results, and understand the data behind them.</p>
          </div>
          <button ref={closeRef} type="button" className="comparison-close" aria-label="Close documentation" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="documentation-layout">
          <nav className="documentation-nav" aria-label="Documentation contents">
            <h3>On this page</h3>
            <label className="documentation-search-label" htmlFor="documentation-search">Search documentation</label>
            <input id="documentation-search" className="documentation-search" type="search" value={searchQuery}
              placeholder="Try “Wilson interval”" aria-controls="documentation-content"
              aria-describedby="documentation-search-status" onChange={handleSearch}
              onKeyDown={(event) => { if (event.key === 'Escape' && searchQuery) { event.preventDefault(); clearSearch() } }} />
            <p id="documentation-search-status" className="documentation-search-status" role="status" aria-live="polite">
              {searchQuery.trim()
                ? `${searchMatches?.length || 0} ${searchMatches?.length === 1 ? 'section' : 'sections'} match.`
                : 'Search terms across all sections.'}
            </p>
            {SECTIONS.filter(([id]) => !visibleSectionIds || visibleSectionIds.has(`documentation-${id}`))
              .map(([id, label]) => <a key={id} href={`#documentation-${id}`}>{label}</a>)}
          </nav>
          <div ref={contentRef} id="documentation-content" className="documentation-content" tabIndex={0}>
            <p className="documentation-empty" role="status" hidden={!searchQuery.trim() || Boolean(searchMatches?.length)}>
              No sections match “{searchQuery}”. Try another term or clear the search.
            </p>
            <section id="documentation-overview" aria-labelledby="documentation-overview-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-overview'))}>
              <h3 id="documentation-overview-title">Overview</h3>
              <p>OnScene is a read-only quality-monitoring dashboard for a New York State EMS dispatch center quality supervisor. It helps identify counties and ZIP Code Tabulation Areas (ZCTAs) that may need review, and separates performance against a service goal from changes against an area's own history.</p>
              <p>The shipped incidents are synthetic. The dashboard is a demonstration and decision-support aid; it does not connect to live computer-aided dispatch (CAD) systems or assign ambulances.</p>
            </section>

            <section id="documentation-workflow" aria-labelledby="documentation-workflow-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-workflow'))}>
              <h3 id="documentation-workflow-title">Dashboard workflow</h3>
              <ol>
                <li>Choose a dataset and set the visible From and To dates. Select one call urgency to define which calls are analysed.</li>
                <li>Review Key Metrics for the overall on-time rate, its uncertainty, wait-time percentiles, and the number of calls.</li>
                <li>Use the map to move from New York State to a county and then its ZIP areas. The Investigate list ranks places for review and shows the goal and control judgments with their evidence.</li>
                <li>Open Response trends to compare the selected area's late-call pattern with its baseline. Use Details &amp; evidence to inspect flagged periods, calls, stage summaries, and method notes.</li>
                <li>Use Simulation / Replay to step through the selected period as a read-only simulated feed. Pause or stop replay before changing its dates or dataset.</li>
              </ol>
            </section>

            <section id="documentation-controls" aria-labelledby="documentation-controls-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-controls'))}>
              <h3 id="documentation-controls-title">Filters and replay</h3>
              <dl className="documentation-definitions">
                <div><dt>Dataset</dt><dd><code>baseline</code> is the normal-pattern reference; <code>station_closure</code> plants a longer response time in ZIP 11368 from September 1, 2026; <code>summer_surge</code> plants a volume and delay increase in Monroe County in July and August 2026.</dd></div>
                <div><dt>Call urgency</dt><dd>Choose one group: 1 Most urgent, 2 Urgent, or 3 Less urgent. The API names these groups red, yellow, and green, respectively.</dd></div>
                <div><dt>From / To</dt><dd>Choose an inclusive date range. Analysis uses dates, not time of day. Blank or incomplete dates do not define a new analysis window.</dd></div>
                <div><dt>Replay</dt><dd>Replay is a simulation, not a live feed. It advances one day every three seconds, keeps the baseline fixed, and shows calls read-only.</dd></div>
              </dl>
            </section>

            <section id="documentation-metrics" aria-labelledby="documentation-metrics-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-metrics'))}>
              <h3 id="documentation-metrics-title">Metrics and judgments</h3>
              <dl className="documentation-definitions">
                <div><dt>Target</dt><dd>The configured time limit for one call, in seconds. A valid call is late when its response time is greater than its target.</dd></div>
                <div><dt>Goal</dt><dd>The desired share of valid completed calls that arrive within their targets. The current configured goal is 90%.</dd></div>
                <div><dt>On-time rate</dt><dd>On-time valid completed calls divided by all valid completed calls. The dashboard shows the count and a 95% Wilson confidence interval.</dd></div>
                <div><dt>Goal judgment</dt><dd><strong>Meets goal</strong> when the interval's lower bound is at or above the goal; <strong>Below goal</strong> when its upper bound is below the goal; otherwise <strong>Inconclusive</strong>. Fewer than 30 valid calls is insufficient for a goal judgment.</dd></div>
                <div><dt>Control judgment</dt><dd>Compares the late-call share with a fixed baseline for that area's history. <strong>Out of control</strong> means a confirmed increase; <strong>In control</strong> means no confirmed increase was detected, not that service is good. <strong>Insufficient baseline</strong> means the history cannot support a reliable comparison.</dd></div>
                <div><dt>Percentiles</dt><dd>The median describes a typical wait; P95 is the wait that 95% of valid calls did not exceed. The dashboard includes 95% uncertainty intervals when supported by the sample size.</dd></div>
                <div><dt>Excess late</dt><dd>The estimated number of late calls beyond the count expected if the area met its on-time goal. It helps order the review list; it does not identify a cause.</dd></div>
              </dl>
            </section>

            <section id="documentation-data" aria-labelledby="documentation-data-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-data'))}>
              <h3 id="documentation-data-title">Data and definitions</h3>
              <p>The incident files are generated from a fixed seed and model assumptions. They are not records of real calls. Population and geographic boundaries come from 2020 U.S. Census sources.</p>
              <p>Each incident row includes a call ID, ZCTA, urgency code, received / assigned / en-route / on-scene timestamps, cancellation flag, time-validity flag, and a held flag. The full field-by-field dictionary, units, examples, generator assumptions, lookup data, and validation instructions are in the <a href={`${REPO}/data/README.md`} target="_blank" rel="noreferrer">data codebook</a>.</p>
              <p>A valid completed call is not cancelled, has an on-scene timestamp, has <code>valid_time = Y</code>, and has timestamps in order. Cancelled, invalid, and untimed calls contribute to volume but not to response-time statistics.</p>
            </section>

            <section id="documentation-methods" aria-labelledby="documentation-methods-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-methods'))}>
              <h3 id="documentation-methods-title">Methods and assumptions</h3>
              <ul>
                <li>Response time is calculated as <code>t_onscene - t_received</code>. OnScene defines <code>t_received</code> as EMS CAD incident creation, not the 911 answer time.</li>
                <li>The p chart compares late-call shares with the 60 days before the selected period; the baseline can extend to 120 days when call volume is low. It never overlaps the selected period.</li>
                <li>Control limits vary with the number of calls in each subgroup. Exact binomial tests identify signals. Two signals, or one sufficiently strong signal after a multiple-testing adjustment, are required to call an increase out of control.</li>
                <li>When a ZIP has insufficient baseline history, its chart is descriptive and does not claim a statistical change. County results describe the county aggregate, not each ZIP inside it.</li>
                <li>The expected number of Below-goal places by chance is an upper reference under the assumption each place is exactly at the goal; it is not a correction to the observed results.</li>
              </ul>
              <p>These methods support screening and review. They do not establish why a delay occurred.</p>
            </section>

            <section id="documentation-limitations" aria-labelledby="documentation-limitations-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-limitations'))}>
              <h3 id="documentation-limitations-title">Limitations</h3>
              <ul>
                <li>All call records are synthetic; no real EMS extract has been validated against the tool.</li>
                <li>Response targets are configurable, illustrative placeholders adapted from NFPA 1720 demand zones. They are not certified EMS standards, and NFPA 1720 uses a different response-clock definition.</li>
                <li>Before using real data, confirm that the mapped <code>t_received</code> field means EMS CAD incident creation. A 911-answer-time clock needs matching targets.</li>
                <li>Low-volume ZIP areas may not have enough history for a control chart. Wide intervals and inconclusive judgments are meaningful uncertainty, not proof of good or bad performance.</li>
                <li>Signals can be false alarms. Seasonality and baseline drift are present in the simulation but are not modelled by the control chart.</li>
              </ul>
              <p>Use this dashboard for quality review and demonstration only. It does not provide emergency dispatch instructions, staffing recommendations, patient outcomes, or causal findings.</p>
            </section>

            <section id="documentation-references" aria-labelledby="documentation-references-title" hidden={Boolean(visibleSectionIds && !visibleSectionIds.has('documentation-references'))}>
              <h3 id="documentation-references-title">References and technical details</h3>
              <ul>
                <li><a href={`${REPO}/data/README.md`} target="_blank" rel="noreferrer">Data codebook</a> — file inventory, complete field dictionary, synthetic generation, validation, and known scenarios.</li>
                <li><a href={`${REPO}/docs/api.md`} target="_blank" rel="noreferrer">API reference</a> — endpoints, parameters, and response shapes.</li>
                <li><a href={`${REPO}/SPEC.md`} target="_blank" rel="noreferrer">Statistical specification</a> — formulas, rules, known assumptions, and project decisions.</li>
                <li><a href={`${REPO}/README.md`} target="_blank" rel="noreferrer">Project README</a> — setup, run instructions, and demonstration walkthrough.</li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </dialog>
  )
}
