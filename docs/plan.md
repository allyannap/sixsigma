# Plan: EMS Response Monitor (Powerpuff Girls)

User: a New York State EMS dispatch center's quality supervisor. Question: which state / county / ZIP areas need
review, and are they below the service goal, showing a new statistical change, or both. Read-only, synthetic data, simulated replay. Deadline: Sat Oct 17, 1 PM ET.
Requirements: [`EMS_RESPONSE_MONITOR_DECISIONS.md`](../EMS_RESPONSE_MONITOR_DECISIONS.md). Formulas and known
answers: SPEC.md section 4. Function signatures and endpoint JSON: docs/api.md. Roles: docs/roles.md.

## Build order (decisions brief section 6.3) and status

Status words: **implemented** (code exists), **tested** (known-answer and degenerate tests pass), **planned**, **deferred**.

| # | Step | Where | Status (Oct 17, H-19) |
|---|---|---|---|
| a | Data validation, timestamp definitions, messy-input cleaning | `app/data.py`, `data/validate.py`, `tests/test_data.py` | implemented, tested; product clock starts at EMS CAD incident creation; real-extract field mapping still needs validation |
| b | On-time metrics, Wilson intervals, chance Below count | `qc.on_time`, `qc.wilson_ci`, `qc.chance_below` | implemented, tested |
| c | p chart, baseline screen, control status, queue label, excess-late ranking | `qc.p_chart`, `qc.baseline_screen`, `qc.control_status`, `qc.dispersion_check`, `qc.queue_label`, `qc.excess_late` | implemented, tested; false alarms re-measured after H-19 (`data/sensitivity.py`: 2 of 186 red, 3 of 186 yellow county-windows) |
| d | Map drill-down and filters | `/api/summary`, `MapSection.jsx` | API implemented, tested; H-13 page fields (watch chip, volume, baseline stability, excess-late ranking) in progress |
| e | What Held Up the Call | `/api/stages`, `qc.stage_summary` | stage-excess analysis **removed** Oct 16 (H-12); plain stage medians (period vs baseline, % held) **restored descriptively** in H-13: API implemented, tested; page in progress |
| f | Read-only replay (fixed start and baseline, growing end) | `/api/replay`, `ReplayBar.jsx` | implemented, tested (AT-5) |
| g | Secondary: ANOM, I-MR | `qc.anom`, `qc.imr` | implemented, tested; ANOM single urgency only, vs the call-weighted average; I-MR test 1 only |
| – | Travel-time comparison (ambulance vs Google) | – | **removed** Oct 16 (H-12) |
| – | Investigation list + statewide flagged ZIPs | `InvestigationSection.jsx`, `/api/flagged` | API implemented, tested; page in progress |
| – | Calls behind a signal | `/api/signal_calls` | API implemented, tested; page in progress |
| – | Percentile intervals | `qc.percentiles` | implemented, tested (exact order statistics; bounds can be n/a) |
| – | Synthetic data realism + sensitivity | `data/generate.py`, `data/sensitivity.py` | implemented, tested (`validate.py --reproduce` 75 PASS) |
| – | Doubled synthetic volume + xz files (H-17) | `data/params.json`, `data/generate.py`, `data/*.csv.xz` | implemented, tested (validate 71 / `--reproduce` 75 / `--messy` 14 PASS; pytest 181 passed) |
| – | Call rate 0.09 per person per year (H-19) | `data/params.json`, `data/*.csv.xz`, `config/targets.csv` | implemented, tested (validate 71 / `--reproduce` 75 / `--messy` 14 PASS; pytest 181 passed) |
| – | Deploy to Posit Connect (H-06) | `.github/workflows/` | planned (needs the publisher key) |
| – | Demo walkthrough (`demo/README.md`, H-05) | `demo/` | planned; README section 6 has the walkthrough for now |
| – | Fresh-clone check and Devpost (H-08) | – | planned |
| – | Real public EMS extract compatibility check | – | planned (optional) |
| – | What-if / intervention ranking | – | **deferred** (removed from the MVP) |
| – | Time-of-day filter or adjustment | – | **deferred** (out of scope) |

## Tests (one command each)

- `.venv/bin/python -m pytest tests -q`: 181 passed (93 stats known answers and degenerates; 33 data rules incl. the messy sample; 55 API incl. acceptance tests AT-1 to AT-10).
- `cd app/frontend && npm test`: 89 passed; 7 failing tests belong to the in-progress UI rewrite (H-15) (formatting, status rules, section rendering).
- `.venv/bin/python data/validate.py`: 71 checks; `--reproduce`: 75 including identical rebuilds of all four files from the seed; `--messy`: 14 checks.
- `PYTHONPATH=. .venv/bin/python data/sensitivity.py`: false-alarm and detection tables (README section 7).

## Decisions

- Oct 16 (earlier): New York State, 62 counties, ZCTAs; FastAPI + React; synthetic data about 400k calls per file at
  about one-eighth of a real call rate (raised in H-17 and H-19, below); Census 2020 lookups; baseline 60 days before the range, 120 if under 30 calls.
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
- Oct 17 (H-18, after reviewing the ZIP map): **gray means only "too few calls"**. The map groups (`mapTier`) split
  "Needs more data" into Near goal (30+ valid calls, interval includes the goal), Stable (meets target, too few late calls
  to chart), Watch (confirmed below target, change unknown) and gray (under 30 valid calls); a Status / Late % switch adds a
  late-share hot-spot view. Display only. Manhattan ZIP areas went from 68 gray of 69 to 30 gray; counties from 9 gray to 1 (0.04 data). On the H-19 data (0.09):
  counties Watch 40, Near goal 3, Stable 19, gray 0; Manhattan Near goal 32, Stable 11, gray 26.
- Oct 17 (team, H-15): **the page takes the Open Design prototype's layout** (`design/sentinel/`) on the current schema
  and API, no API change, named **OnScene** with the siren logo. Map: Critical = Act now, Watch = Ongoing gap + Recent
  change, Stable = Meets goal (no change signal), gray = Needs more data (gray refined by H-18 below). Priority = urgency red/yellow/green (renamed "Call urgency" with numbered, uncoloured chips in H-21); no
  "on-scene wait ≥" filter (not a SPEC input; it would bias the on-time rate). Dataset picker and replay in the top bar.
  Key Metrics: on-time % (k of n, 95% CI vs goal), median and P95 with intervals from `/api/summary` totals, and a plain
  summary from the queue label and reasons (no AI text). Under "<Place> Wait Time Insights": card 1 "Are calls arriving
  on time?" = the geographic comparison; card 2 "Are late calls being unusually frequent?" = the Section 2 p chart as a
  stand-in until the team designs it. The prototype's stage card ("Where the delay sits") is not built.
- Oct 17 (H-17, user decision; rate raised again in H-19 below): **synthetic call rate 0.0198 → 0.04 per person per year** (about 2x; about 800,000 calls
  per file, one-quarter to one-third of a real rate instead of one-eighth) so single ZIPs carry enough calls; no other
  generator parameter changed, so the planted stories and effect sizes are the same. **Incident files are now xz-compressed
  CSV** (`data/incidents_*.csv.xz`, preset 9, about 10 MB per main file; `.csv.gz` before) to stay under 25 MB. Two behaviour
  changes, both measured: 11368's x1.15 and x1.25 sensitivity variants are now detected (only the drift is missed), and
  replay flags 11368 from Sep 3 with no blip; Monroe Sep 1-Oct 15 on `summer_surge` now reads Insufficient baseline (its
  baseline is the surge, overdispersed) instead of in control. False alarms 2 of 186 (red) on the clean file.
- Oct 17 (H-19, user decision): **synthetic call rate 0.04 → 0.09 per person per year** (2.25x; about 1.82 million calls
  per file, about 60% of a real US rate of ~0.15). 0.09 is as far as the project's own 25 MB file limit allows: the xz
  files are about 22 MB each, and a real rate would need about 37.5 MB files. No other generator parameter changed.
  Measured: 11368 Sep 1-Oct 15 reads Act now at 72.2% of 407 valid red calls (was 69.2% of 201); replay out of control
  from Sep 4, Act now from Sep 8; Monroe Jul-Aug 80.2% of 5,285, 10 weekly signals; clean-file county false alarms
  2 of 186 (red, `sensitivity.py`) and 3 of 186 (API test windows); one false-alarm ZIP (11212, Recent change) is now
  flagged on the clean file, and the flagged-ZIP test allows up to 1% such ZIPs but never 11368. The +2%/week drift is
  still not detected. Generation takes about 29 minutes; one dataset loads in the API in about 29 s.

- Oct 17 (user-approved H-11 follow-up): add a Documentation button beside How it works. It opens a separate in-dashboard
  reference with a table of contents, product workflow, filter and replay guidance, metric interpretation, data provenance,
  statistical methods, assumptions, limitations, and links to the API documentation and codebook. Closing it preserves the
  dashboard state; keyboard navigation is supported.
- Oct 18 (user-requested H-11 follow-up): add case-insensitive full-text search across documentation section text. Show only
  matching sections and navigation links, announce the result count, explain when nothing matches, and let Escape clear the
  query; leave the section content and dashboard analytics unchanged.

## Risks and open items

1. **Low-volume ZIP areas** stay Inconclusive / Insufficient baseline at many windows, and their monthly subgroups give
   too few baseline periods for the stability screen (reported as "not checked"). The page says to widen the dates or view
   the county. After H-19 (0.09 calls per person per year) 11368 at x1.6, x1.25 and x1.15 are all caught as Act now; a
   +2%/week drift is not, and smaller ZIPs (median 26 valid red calls in the default window) see only large changes.
2. **False alarms** of the control rule (after H-19): 2 of 186 (red) and 3 of 186 (yellow) county-windows over three
   90-day windows on the clean file, 5 of 310 / 5 of 310 over five 180-day windows; the default window shows one county
   (Erie, Recent change) and one ZIP (11212, Recent change). The state's daily chart is rarely evaluable (0 of 8 red and 2 of 8 yellow 90-day windows, none out of control). Measured, tested (fails above 10%), and the page shows the number of Below
   labels expected by chance.
3. **Seasonality and baseline drift** are simulated in the data but not modelled; the 60-day baseline right before the
   period and the baseline screen limit the damage. Monroe's default window shows the screen refusing a baseline that
   contains the start of the surge.
4. **Open dependencies:** `t_received` semantics, authoritative targets (the NFPA tiers are placeholders with a different
   clock), scope (brief issue 12).
5. **Deploy** not done yet; keep the bundle small (xz-compressed data, about 22 MB per main file, about 66 MB for the three; simplified shapes).

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

## H-16 — AI summary integration, restored against current checkout

User explicitly requested the supplied agent pattern adapted to the EMS dashboard. Use backend Ollama Cloud calls with the root .env credential alias; ground a 2-3 sentence investigation briefing in existing selected-area/child/stage evidence. Reuse all QC functions and preserve single-priority controls and the current Investigate rail. Bind requests to displayed dates, selected area, priority and dataset. Verify credential isolation, exact route reconciliation, cache isolation, missing/invalid data and provider failures; browser-check date/area/priority changes, initial visible defaults and stale-response suppression. No fine-tuning, unrelated risk tools or new statistical rules.
