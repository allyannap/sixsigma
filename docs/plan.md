# Plan: EMS Response Monitor (Powerpuff Girls)

User: a New York State EMS dispatch center's quality supervisor. Question: which state / county / ZIP areas need
review, and are they below the service goal, showing a new statistical change, or both. Read-only, synthetic data, simulated replay. Deadline: Sat Oct 17, 1 PM ET.
Requirements: [`EMS_RESPONSE_MONITOR_DECISIONS.md`](../EMS_RESPONSE_MONITOR_DECISIONS.md). Formulas and known
answers: SPEC.md section 4. Function signatures and endpoint JSON: docs/api.md. Roles: docs/roles.md.

## Build order (decisions brief section 6.3) and status

Status words: **implemented** (code exists), **tested** (known-answer and degenerate tests pass), **planned**, **deferred**.

| # | Step | Where | Status (Oct 17, H-13) |
|---|---|---|---|
| a | Data validation, timestamp definitions, messy-input cleaning | `app/data.py`, `data/validate.py`, `tests/test_data.py` | implemented, tested (validate 71 PASS, `--messy` 14 PASS); `t_received` meaning still provisional |
| b | On-time metrics, Wilson intervals, chance Below count | `qc.on_time`, `qc.wilson_ci`, `qc.chance_below` | implemented, tested |
| c | p chart, baseline screen, control status, queue label, excess-late ranking | `qc.p_chart`, `qc.baseline_screen`, `qc.control_status`, `qc.dispersion_check`, `qc.queue_label`, `qc.excess_late` | implemented, tested; false alarms re-measured (`data/sensitivity.py`: 0 of 186 red, 1 of 186 yellow county-windows) |
| d | Map drill-down and filters | `/api/summary`, `MapSection.jsx` | API implemented, tested; H-13 page fields (watch chip, volume, baseline stability, excess-late ranking) in progress |
| e | What Held Up the Call | `/api/stages`, `qc.stage_summary` | stage-excess analysis **removed** Oct 16 (H-12); plain stage medians (period vs baseline, % held) **restored descriptively** in H-13: API implemented, tested; page in progress |
| f | Read-only replay (fixed start and baseline, growing end) | `/api/replay`, `ReplayBar.jsx` | implemented, tested (AT-5) |
| g | Secondary: ANOM, I-MR | `qc.anom`, `qc.imr` | implemented, tested; ANOM single urgency only, vs the call-weighted average; I-MR test 1 only |
| – | Travel-time comparison (ambulance vs Google) | – | **removed** Oct 16 (H-12) |
| – | Investigation list + statewide flagged ZIPs | `InvestigationSection.jsx`, `/api/flagged` | API implemented, tested; page in progress |
| – | Calls behind a signal | `/api/signal_calls` | API implemented, tested; page in progress |
| – | Percentile intervals | `qc.percentiles` | implemented, tested (exact order statistics; bounds can be n/a) |
| – | Synthetic data realism + sensitivity | `data/generate.py`, `data/sensitivity.py` | implemented, tested (`validate.py --reproduce` 75 PASS) |
| – | Deploy to Posit Connect (H-06) | `.github/workflows/` | planned (needs the publisher key) |
| – | Demo walkthrough (`demo/README.md`, H-05) | `demo/` | planned; README section 6 has the walkthrough for now |
| – | Fresh-clone check and Devpost (H-08) | – | planned |
| – | Real public EMS extract compatibility check | – | planned (optional) |
| – | What-if / intervention ranking | – | **deferred** (removed from the MVP) |
| – | Time-of-day filter or adjustment | – | **deferred** (out of scope) |

## Tests (one command each)

- `.venv/bin/python -m pytest tests -q`: 164 tests (86 stats known answers and degenerates; 31 data rules incl. the messy sample; 45 API incl. acceptance tests AT-1 to AT-10).
- `cd app/frontend && npm test`: 52 tests (formatting, status rules, every section renders with the brief's wording).
- `.venv/bin/python data/validate.py --reproduce`: 75 data checks including identical rebuilds from the seed; `--messy`: 14 checks.
- `PYTHONPATH=. .venv/bin/python data/sensitivity.py`: false-alarm and detection tables (README section 7).

## Decisions

- Oct 16 (earlier): New York State, 62 counties, ZCTAs; FastAPI + React; synthetic data about 400k calls per file at
  about one-eighth of a real call rate; Census 2020 lookups; baseline 60 days before the range, 120 if under 30 calls.
- Oct 16 (decisions brief, approved): see the brief. Spec (Wilson) and control (p chart) are separate; Cpk, ANOM and I-MR
  are secondary; what-if, `/whatif` and `POST /calls` removed; replay is read-only; "What Held Up the Call" uses stage
  excess with noncausal wording; Google comparison is "unusual travel-time difference"; urgency filters, no time of day.
- Oct 16 (team, after the brief; the target part is superseded by H-13 below): **red target flat 480 s** (history-based tiers from H-10 made the on-time check
  circular: 60 of 62 counties Inconclusive); `build_targets.py --from-history` keeps the tiers as an option.
  **Default window 90 days** (counties under 30 red calls: 23 → 2). **Below target + insufficient baseline → Needs more
  data**, sorted first. Synthetic drives get 1% slow outliers (drawn last, so other draws are unchanged).
- Oct 17 (H-14, team decision after the input review): the incident file no longer has a travel-estimate column
  (needs a paid routing call plus an ambulance origin; no output used it) and `disposition` is reduced to `cancelled` Y/N.
  Verified before and after: every dashboard response is identical except the replay's field name; the generator keeps its
  internal travel model, so the planted stories and every measured number are unchanged.
- Oct 16 (after browser testing): **replay keeps the period start and baseline fixed** and grows the end date; a rolling
  window hid both planted stories. Default replay start: From date, else Aug 25 (Jun 25 for summer_surge). Tested (AT-5).
- Oct 16 (team, after reviewing the dashboard): **remove "What Held Up the Call" and the travel-time comparison**
  everywhere (page, `/api/delays`, `/api/google`, `qc.stage_excess`, `qc.travel_vs_estimate`, tests): too much for this
  version and out of the core scope. Overrides the brief's issues 4 and 7. The investigation list keeps its target and
  control evidence; its stage and topics columns went with the card. (H-13 later restored plain stage medians, descriptively.)
- The superseded Z-test "changed recently", Cpk-based status, fault tree and what-if were removed from `app/qc.py`.
- Oct 16-17 (H-13, after a four-part robustness review; SPEC section 10 has the detail): **red targets tiered by area
  type from NFPA 1720 demand zones** as illustrative placeholders (urban 480 s, suburban 600, rural 840, remote 840 with
  rural reused and flagged), a team policy decision replacing the flat 480 s; **exact binomial signals** (above the UCL and
  p < 0.00135), **out of control needs 2 signals or one with p < 0.00135 / m**, else in control + watch; a **Phase I
  baseline screen**; **exact order-statistic percentile intervals**; `chance_below`, `excess_late` ranking, volume fields,
  baseline stability on each card; `/api/flagged`, `/api/stages` (plain stage medians, descriptive), `/api/signal_calls`,
  quality counts in `/api/health`; messy input dropped and counted; "Meets goal; statistically stable" renamed "Meets
  goal; no change signal"; Cpk sigma described as overall (Ppk-like); ANOM vs the call-weighted average; data with day
  effects, seasonality, hour profile, congestion, a messy sample and `data/sensitivity.py`.
- Oct 17 (team, H-15): **the page takes the Open Design prototype's layout** (`design/sentinel/`) on the current schema
  and API, no API change, named **OnScene** with the siren logo. Map: Critical = Act now, Watch = Ongoing gap + Recent
  change, Stable = Meets goal (no change signal), gray = Needs more data. Priority = urgency red/yellow/green; no
  "on-scene wait ≥" filter (not a SPEC input; it would bias the on-time rate). Dataset picker and replay in the top bar.
  Key Metrics: on-time % (k of n, 95% CI vs goal), median and P95 with intervals from `/api/summary` totals, and a plain
  summary from the queue label and reasons (no AI text). Under "<Place> Wait Time Insights": card 1 "Are calls arriving
  on time?" = the geographic comparison; card 2 "Are late calls being unusually frequent?" = the Section 2 p chart as a
  stand-in until the team designs it. The prototype's stage card ("Where the delay sits") is not built.

## Risks and open items

1. **Low-volume ZIP areas** stay Inconclusive / Insufficient baseline at many windows, and their monthly subgroups give
   too few baseline periods for the stability screen (reported as "not checked"). The page says to widen the dates or view
   the county. Only large single-ZIP changes are detectable: 11368 at x1.6 is caught, x1.15, x1.25 and +2%/week are not.
2. **False alarms** of the control rule: 0 of 186 (red) and 1 of 186 (yellow) county-windows over three 90-day windows on
   the clean file; the state's daily chart is less reliable (1 of 4 evaluable red 90-day windows, and the default window
   reads Recent change on the clean file). Measured, tested (fails above 10%), and the page shows the number of Below
   labels expected by chance.
3. **Seasonality and baseline drift** are simulated in the data but not modelled; the 60-day baseline right before the
   period and the baseline screen limit the damage. Monroe's default window shows the screen refusing a baseline that
   contains the start of the surge.
4. **Open dependencies:** `t_received` semantics, authoritative targets (the NFPA tiers are placeholders with a different
   clock), scope (brief issue 12).
5. **Deploy** not done yet; keep the bundle small (gzipped data, simplified shapes).

## Geographic comparison follow-up (H-11)

User requested a supervisor-readable comparison. Section 4 now ranks median-to-P90 ranges
on a linear minutes axis against configured targets, with late percentages, n, sparse warnings
and expandable on-time uncertainty. The summary response is shared with the map and replay;
existing Wilson judgments and control/queue rules remain unchanged. ANOM stays in the API.
Known-answer profile: 1..20, target 12 → median 10.5, P90 18.1, 40% late.
Empty/single/tied/missing cases and urgency/replay integration are tested.
Data profile, all ZIP/urgency counts and run instructions: `app/frontend/docs/geographic-comparison.md`.

- UI follow-up: five compact rows per page and a selected-area place card replace the inner scroll region. All areas remain accessible with a fixed common scale; original ANOM evidence is loaded on demand through the card. Frontend tests: 31 passed; production build passed.

- Version 2 added below version 1 by user request: overall on-time percentage plus three compact goal-line indicators; statistical evidence on tap, all-area picker, unchanged statuses. Frontend tests: 34 passed; build passed.

- Version 2 refinement: one shared line for three areas, staggered marker labels, selectable chips and optional fourth area. One selected explanation shows percentage-point goal gap, late share and n; complete evidence remains under one disclosure. Tests: 36 frontend tests passed; build passed.

- Final version 2 condensation: three zero-based horizontal bars replace shared bubbles. Explicit call-receipt-to-arrival goal, on-time % labels, one selected gap/n line; all supporting metrics under Details. Frontend tests: 37 passed; build passed.

- User rejected the bars: version 2 now uses three area/rate buttons and one direct-number result; Other area replaces the result. Full statistics remain under Details. Frontend: 37 passed; build passed.

## H-16: selected-period AI summary (approved Oct 17)

Replace the fixed-wording Key Metrics summary with Ollama Cloud narration of the selected area's existing QC evidence. Owns backend route/module, frontend, targeted tests, requirements and supporting docs (CONTRACT lists exact paths). The supplied Ollama credential is accepted under OPENAI_API_KEY as an alias; OLLAMA_API_KEY takes precedence. No statistics computed by the model. Test exact selection and aggregate payloads, changed filters, cache separation/expiry, incomplete dates, no valid calls and sanitized provider failures. Frontend suppresses old responses on selection changes and pauses generation during replay playback. Live generation requires a backend credential; no-data and failure UI remain explicit. This overrides the earlier H-15 no-AI-text decision.
