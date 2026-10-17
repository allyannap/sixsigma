# Plan: EMS Response Monitor (Powerpuff Girls)

User: a New York State EMS dispatch center's quality supervisor. Question: which state / county / ZIP areas need
review, and are they below the service goal, showing a new statistical change, or both. Read-only, synthetic data, simulated replay. Deadline: Sat Oct 17, 1 PM ET.
Requirements: [`EMS_RESPONSE_MONITOR_DECISIONS.md`](../EMS_RESPONSE_MONITOR_DECISIONS.md). Formulas and known
answers: SPEC.md section 4. Function signatures and endpoint JSON: docs/api.md. Roles: docs/roles.md.

## Build order (decisions brief section 6.3) and status

Status words: **implemented** (code exists), **tested** (known-answer and degenerate tests pass), **planned**, **deferred**.

| # | Step | Where | Status (Oct 16, evening) |
|---|---|---|---|
| a | Data validation, timestamp definitions | `app/data.py`, `data/validate.py`, `tests/test_data.py` | implemented, tested (55 PASS); `t_received` meaning still provisional |
| b | On-time metrics, Wilson intervals | `qc.on_time`, `qc.wilson_ci` | implemented, tested |
| c | p chart, control status, queue label | `qc.p_chart`, `qc.control_status`, `qc.dispersion_check`, `qc.queue_label` | implemented, tested; false alarms measured 2.7% |
| d | Map drill-down and filters | `/api/summary`, `MapSection.jsx` | implemented, tested (API + render tests), checked in a browser |
| e | What Held Up the Call | – | **removed** Oct 16 (team decision: too much, out of scope) |
| f | Read-only replay (fixed start and baseline, growing end) | `/api/replay`, `ReplayBar.jsx` | implemented, tested, checked in a browser |
| g | Secondary: ANOM, I-MR | `qc.anom`, `qc.imr` | implemented, tested; ANOM single urgency only; I-MR test 1 only |
| – | Travel-time comparison (ambulance vs Google) | – | **removed** Oct 16 with step e |
| – | Investigation list | `InvestigationSection.jsx` | implemented, render-tested |
| – | Deploy to Posit Connect (H-06) | `.github/workflows/` | planned (needs the publisher key) |
| – | Demo walkthrough (`demo/README.md`, H-05) | `demo/` | planned; README section 6 has the walkthrough for now |
| – | Fresh-clone check and Devpost (H-08) | – | planned |
| – | Real public EMS extract compatibility check | – | planned (optional) |
| – | What-if / intervention ranking | – | **deferred** (removed from the MVP) |
| – | Time-of-day filter or adjustment | – | **deferred** (out of scope) |

## Tests (one command each)

- `.venv/bin/python -m pytest tests -q`: 122 tests (stats known answers and degenerates; data rules; API acceptance tests AT-1 to AT-10).
- `cd app/frontend && npm test`: 26 tests (formatting, status rules, every section renders with the brief's wording).
- `.venv/bin/python data/validate.py --reproduce`: 55 data checks including identical rebuilds from the seed.

## Decisions

- Oct 16 (earlier): New York State, 62 counties, ZCTAs; FastAPI + React; synthetic data about 400k calls per file at
  about one-eighth of a real call rate; Census 2020 lookups; baseline 60 days before the range, 120 if under 30 calls.
- Oct 16 (decisions brief, approved): see the brief. Spec (Wilson) and control (p chart) are separate; Cpk, ANOM and I-MR
  are secondary; what-if, `/whatif` and `POST /calls` removed; replay is read-only; "What Held Up the Call" uses stage
  excess with noncausal wording; Google comparison is "unusual travel-time difference"; urgency filters, no time of day.
- Oct 16 (team, after the brief): **red target flat 480 s** (history-based tiers from H-10 made the on-time check
  circular: 60 of 62 counties Inconclusive); `build_targets.py --from-history` keeps the tiers as an option.
  **Default window 90 days** (counties under 30 red calls: 23 → 2). **Below target + insufficient baseline → Needs more
  data**, sorted first. Synthetic drives get 1% slow outliers (drawn last, so other draws are unchanged).
- Oct 16 (after browser testing): **replay keeps the period start and baseline fixed** and grows the end date; a rolling
  window hid both planted stories. Default replay start: From date, else Aug 25 (Jun 25 for summer_surge). Tested (AT-5).
- Oct 16 (team, after reviewing the dashboard): **remove "What Held Up the Call" and the travel-time comparison**
  everywhere (page, `/api/delays`, `/api/google`, `qc.stage_excess`, `qc.travel_vs_estimate`, tests): too much for this
  version and out of the core scope. Overrides the brief's issues 4 and 7. The investigation list keeps its target and
  control evidence; its stage and topics columns went with the card.
- The superseded Z-test "changed recently", Cpk-based status, fault tree and what-if were removed from `app/qc.py`.

## Risks and open items

1. **Low-volume ZIP areas** stay Inconclusive / Insufficient baseline at most windows (median ZCTA: 8 red calls in 90 days).
   That is honest; the page says to widen the dates or view the county. ZIP 11368 needs the Sep 1 window to be judged.
2. **False alarms** of the control rule are about 2.7% per county per 90-day window; more with daily subgroups at the
   state level. Measured, tested (fails above 10%), and stated on the page as "signals to check".
3. **Seasonality and case mix** are not modelled; the 60-day baseline right before the period limits drift. Dispersion is checked.
4. **Open dependencies:** `t_received` semantics, authoritative targets, scope (brief issue 12).
5. **Deploy** not done yet; keep the bundle small (gzipped data, simplified shapes).
