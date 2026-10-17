# SPEC: Six Sigma Hackathon team project

What your tool IS. Your agent reads this before every task. Where the code and this file
disagree, the code is the bug: change this file first, then the code.

Most of this page is already decided by the event and the [rubric](docs/criteria.md).
**Only the `FILL IN` lines change, and you do not have to write them by hand:** describe your app and ask your agent to update them. They depend on the prompt your team picks at kickoff
(prompts are secret until then, see [`docs/prompts.md`](docs/prompts.md)) and on your team.
The examples after each `FILL IN` show the shape of an answer. They are not hints about the prompts.

The team's design sources, in priority order: **[`EMS_RESPONSE_MONITOR_DECISIONS.md`](EMS_RESPONSE_MONITOR_DECISIONS.md)
(the approved decisions brief, Oct 16, 2026) is the requirement and overrides everything below it**; then the data schema
(`ref/EMS Response Monitor Data Schema.md`) for files and columns; then the mockup ("EMS Statistical Analysis Card") for
look and wording. Where the schema or mockup still describe Cpk status, a fault tree, what-if or `POST /calls`, they are
superseded. Two choices the brief left open were decided by the team on Oct 16 (section 10).

## 1. Team and prompt
- **Team name:** Powerpuff Girls
- **Track:** on-campus (24 hours). See [`docs/schedule.md`](docs/schedule.md).
- **Prompt we chose:** Health Systems: Emergency Response (the [Devpost](https://six-sigma-hackathon.devpost.com/) challenge page lists no prompt number).
  > Ambulance dispatch to on-scene times are varying wildly across city zones, but the 911 center only looks at monthly averages, missing fatal outliers, not where or why these failures occur. Design a statistical tool to help manage dispatchers, response time logging in real-time, generate analyzes, and flag zones that are in need of resolution.
- **Our public repo:** https://github.com/allyannap/sixsigma

## 2. User and use case (rubric: scope 5, user and use case 5)
- **User:** a New York State EMS dispatch center's quality supervisor (not the dispatcher assigning an ambulance, not the public).
- **Decision the tool helps them make, and when:** at the start of a review, for New York State, a county or one ZIP code area (ZCTA): which areas need review; whether each is **below the service goal**, shows a **new statistical change** from its own history, or both; and which **recorded response stage** (received → assigned, assigned → en route, en route → on scene) deserves investigation.
- **Read-only.** The tool reads preloaded synthetic incidents from the back end and can replay them as a simulated stream. No user-entered incidents, no logging forms, no ambulance assignment, no ranking of people, no what-if or intervention ranking.
- **Why this matches the prompt:** it replaces the monthly average with an on-time rate and its uncertainty per place, a control chart against each place's own baseline, tail percentiles, and a stage-by-stage breakdown of late calls, so the places and the recorded stages behind the failures are visible.

## 3. Inputs (rubric: minimal inputs 5)
Only what this user can actually measure or already knows. Fewer is better; every input a user
cannot measure costs points.

| Input | Type and units | Where the user gets it |
|---|---|---|
| `incidents.csv`, one row per EMS call. Required: `incident_id`, `zcta`, `urgency_code`, `t_received`, `t_assigned`, `t_enroute`, `t_onscene` (empty if cancelled), `disposition`, `valid_time` | text IDs; 5-digit ZIP area; integer 0-9; ISO 8601 datetimes with the New York offset; Y/N | the dispatch center's computer-aided dispatch (CAD) export; columns follow NYC's public EMS Incident Dispatch Data. In this project the three files are **synthetic** |
| Optional: `eta_google_s` (travel estimate at assignment), `held` (call waited because no unit was free) | integer seconds; Y/N | `held` is in CAD today; `eta_google_s` needs a routing API call at assignment and is not in public data (here it is generated) |
| `config/targets.csv`: per urgency code and area type, `urgency_group`, `target_s`, `goal_on_time_pct` | seconds; percent | **placeholders: red 480 s, yellow 900 s, green 1800 s, 90% on time**, configurable per center; not certified statewide standards |
| Filters: `from`, `to`, `urgency`, `level` (state/county/zcta), `id`, `baseline_days` | dates; red/yellow/green; FIPS or ZCTA; days | picked on screen (no time-of-day filter) |

Lookups the tool ships with (the user supplies nothing): `data/lookup/zcta_county.csv`, `data/lookup/counties.csv`
(2020 Census) and the map shapes in `geo/`.

**Response-time definition (provisional, open dependency):** `total_wait_s = t_onscene - t_received`. Whether `t_received`
is the original 911 call receipt or the EMS CAD incident creation is **not yet confirmed**; it must be validated against the
source (and kept consistent across test data and any real extract) before real use. It is not silently redefined here.

## 4. The statistics, and why (rubric: valid QC analysis 25)
Every formula is one function in `app/qc.py`; the known answers below are tests in `tests/test_qc.py` (tolerance 5e-4).

- **Valid call and late call.** A valid completed call is not CANCELLED, has `t_onscene`, `valid_time = Y`, and times in order;
  cancelled, invalid, missing and out-of-order rows count in volume only. `late = total_s > target_s(urgency_code, area type)`.
  Per place: `n_valid`, `n_on_time`, on-time rate, late rate, median, P90, P95 (with 95% intervals for the median and P95).
- **A. Specification ("Are calls meeting the service goal?").** On-time rate with a **95% Wilson score interval**,
  compared with the goal g: **Meets target** if the lower bound ≥ g; **Below target** if the upper bound < g; otherwise
  **Inconclusive** (the interval includes g), and also Inconclusive with "insufficient data" under 30 valid calls. The rate,
  interval, goal and n are always shown. Inconclusive is never labelled as meeting the goal.
- **B. Statistical control ("Has the process changed relative to its own history?").** A **p chart of the late share**
  for the selected place and urgency group, with a fixed **baseline**: the 60 days before `from` (never overlapping the
  selection), stretched to 120 days under 30 valid calls. Subgroup = the shortest of day, week or calendar month with
  baseline calls x days x p̄ ≥ 5. CL = p̄ (baseline), UCL_i = min(1, p̄ + 3 sqrt(p̄(1 - p̄)/n_i)), LCL_i = max(0, p̄ - 3 sqrt(...)).
  **Out of control** = at least one subgroup above its UCL (Shewhart rule 1, upper side, because the question is
  deterioration; subgroups below the LCL are listed as improvements). **In control** = adequate baseline and no such
  subgroup. **Insufficient baseline** = under 30 baseline calls after the stretch, no subgroup size reaching n p̄ ≥ 5,
  p̄ of 0 or 1, or no subgroups. The run-of-9 rule is shown for information only. Being in control does not mean good service.
  **Replay keeps the baseline fixed:** the simulated replay holds the period's start (and so its baseline) fixed and moves
  only the end forward one day per tick; a rolling window would let the baseline drift into the change it should detect.
- **C. Queue label (from A and B; both badges are always shown beside it).** Below + Out → **Act now: performance gap +
  recent signal**; Below + In → **Ongoing gap**; Meets or Inconclusive + Out → **Recent process change: investigate**;
  Meets + In → **Meets goal; statistically stable**; anything with Insufficient baseline, and Inconclusive + In →
  **Needs more data / Inconclusive** (places confirmed Below target sort first inside it). "Needs review" = the first three.
- **What Held Up the Call.** For late calls, each stage's recorded time minus the baseline median for that stage
  (received → assigned, assigned → en route, en route → on scene). The stage with the largest positive excess is reported
  per call and on average; `held` is shown only where present. Arithmetic: mean total − Σ stage medians = Σ mean stage excess.
  Wording: possible contributors to review, not causes.
- **Unusual travel-time difference** (optional, only where `eta_google_s` exists): `drive_s − eta_google_s`; "unusual" =
  above the baseline's 95th percentile of the difference (about 5% when nothing changed). Faster and slower are both shown;
  slower is a clue, not a failure. Provenance is stated (synthetic here).
- **Secondary (never set a status):** I chart on ln(minutes) with baseline limits (sigma = MR̄ / 1.128), only test 1 marked,
  with skewness and lag-1 autocorrelation reported; one-sided Cpk on ln(total_s / target_s) with the Bissell bound (assumes
  lognormal times); ANOM on ln(minutes) within one urgency group, descriptive only (not adjusted for time of day, traffic,
  call mix or resources, so no fairness claim).
- **Assumptions and how they are checked:** (1) late counts are binomial within a subgroup: subgroups sized so n p̄ ≥ 5, and
  a Pearson chi-square dispersion check on the baseline subgroups is reported (overdispersion warns that limits are too
  narrow). (2) The baseline is adequate and stable: n ≥ 30, it never overlaps the period, and it is the 60 days just before
  the period so seasonal drift inside it is small; seasonality across the year is not modelled (open limitation).
  (3) Urgency groups are analysed separately; combining groups is allowed but the page warns that case mix is mixed.
  (4) Measured false alarms of the control rule on the no-change file: 5 of 186 county-windows (2.7%), red, 90-day windows.
- **Known-answer checks** (each a test):
  - Wilson: 85 of 100 → [0.76716, 0.90694]. 300 calls, goal 90%: 285 on time → [0.91915, 0.96947] Meets; 255 → [0.80518, 0.88597] Below; 270 → [0.86083, 0.92905] Inconclusive. 0 of 20 → Inconclusive (insufficient data), not Below; 29 of 29 → Inconclusive, not Meets.
  - p chart: 5 days, n = 20, late 2, 3, 1, 4, 10, p̄ = 0.20: UCL 0.4683, LCL 0; only day 5 (p = 0.50) is above → Out of control with that day as evidence. Varying n with p̄ = 0.10: n = 10 → UCL 0.3846; n = 100 → 0.19 (LCL 0.01); n = 1000 → 0.12846.
  - Dispersion: n = 100 x 4, late 0, 20, 0, 20 → chi-square 44.44, df 3, ratio 14.81, overdispersed.
  - Queue: all 9 combinations of A and B.
  - Stage excess: baseline medians 60, 70, 300 s; late calls (120, 75, 330), (55, 65, 500), (50, 60, 290) → largest excess dispatch, drive, none; mean excess +15, −3.33, +73.33 s; total 515 − 430 = 85 s.
  - Travel: baseline differences −50..49 s → threshold 44.05 s; now −30, 10, 45, 60, −5 → 60% slower, 40% faster, 2 unusual.
  - Percentiles: 1..20 → median 10.5, P90 18.1, P95 19.05. I-MR: 1.0, 1.2, 0.9, 1.1, 1.3 → CL 1.1, UCL 1.6984, LCL 0.5016. Cpk (target 8 min) 1.6368, bound 2.8803. ANOM groups A/B/C → h 2.9333, F 26.0.
  - Degenerate: n = 0, n = 1, constant data, p̄ = 0 or 1, no baseline, missing stage times, too few baseline estimates: each returns None or a status of Inconclusive / Insufficient baseline with a message, never inf or a pass.

Fixed for every team:
- The statistic lives in **one plain, tested function** (`app/qc.py` or `app/qc.R`). The API, app or
  package only calls it and displays the result. No statistics inside UI code.
- Every statistic has a test against a known answer and a degenerate case (constant data, n = 1, missing values).
- You can explain every number the tool prints. If you cannot, it is not done.

## 5. Delivery (rubric: working tool 25)
- **Stack:** dashboard: FastAPI (Python) back end, read-only `GET` routes `/api/summary`, `/pchart`, `/delays`, `/google`, `/replay`, `/imr`, `/anom`, `/meta`, `/health` (docs/api.md), with a React front end. Every statistic is in `app/qc.py`.
- **Starting demo:** `demos/fastapi/`, plus `demos/reactfront/` as `app/frontend/`.

Fixed for every team:
- Start from **one** demo in `demos/`, copied to `app/`. Keep its four-script contract
  (`testme`, `manifestme`, `deployme`, `README.md`); `testme` starts the tool with one command.
- Deployed on the course **Posit Connect** server with a public URL (publisher key handed out at the
  event). Deploy early: copy one workflow from
  [`.claude/skills/connect-publish/workflows/`](.claude/skills/connect-publish/workflows/).
- A small tool that runs beats a large tool that does not.

## 6. Outputs
- **What the user sees** (one page, labelled "SYNTHETIC DATA" and "Simulation / Replay"): filters (dataset, urgency, dates; no time-of-day), a replay bar (starts at the From date or a week before the dataset's planted change: Aug 25, or Jun 25 for the surge; fixed baseline; one simulated day every 3 s; shows that day's calls read-only), summary (areas needing review, counts by queue label, on-time k of n with CI against the goal, median and P95 with intervals, very-late count); (1) state → county → ZCTA map with a back button, filled by late share (gray under 30 valid calls), flagged by queue label, and a ranked table with n, on-time rate + CI, Target and Control badges, queue label, P95 + CI, and secondary Cpk; (2) the p chart with baseline window, signal evidence and the dispersion check, plus an optional I chart; (3) "What Held Up the Call" and the unusual travel-time difference; (4) an investigation list of flagged areas with evidence and topics to investigate; (5) a secondary, descriptive geographic comparison (ANOM).

## 7. Test datasets and codebook (rubric: demo 10, datasets 5, codebook 5)
`data/README.md` is the codebook: every file, every column with units, source or synthetic origin, generation assumptions,
the rebuild command, expected signals, and what it would take to collect this data for real.
- **Datasets:** three synthetic 12-month files (Oct 16, 2025 to Oct 15, 2026) covering every New York ZCTA, about 400,000 calls each, gzipped, built by a fixed-seed generator: `incidents_baseline.csv.gz` (seasonal pattern; persistent rural long-trip gaps; no planted change, so control signals are counted false alarms), `incidents_station_closure.csv.gz` (from Sep 1, 2026, travel estimates **and actual drives** in ZIP 11368 rise 60%), `incidents_summer_surge.csv.gz` (Jul 1 to Aug 31, 2026, Monroe County volume +30%, held calls common, received-to-assigned time up). Drives vary both faster and slower than the estimate, with slow outliers. `data/validate.py` checks schema, time order, lookups, interval arithmetic, baseline history, the stories, and (`--reproduce`) identical rebuilds from the seed.

## 8. Documentation and reproducibility (rubric: docs 10, public repo 5)
- `README.md` says what the tool does, for whom, every input and parameter, how to run it in one
  command, and walks through the demo on each test dataset.
- Public GitHub repo; a fresh clone runs `testme` and the tests pass with no extra steps.
- Submit on Devpost: the repo link plus a demo.

## 9. Out of scope
What we will NOT build, so nobody (human or agent) builds it by accident.
- Default: logins, databases, real customer data, a second statistic before the first one is tested.
- Actual ambulance assignment or unit recommendation; ranking individual ambulances, crews or dispatchers (no `unit_id` or dispatcher IDs, by design); route optimization; patient outcomes; a what-if or intervention optimizer (deferred, consider later); user-entered incident logging; a live CAD or FDNY connection; time-of-day filters or time-of-day-adjusted analysis.
- No causal attribution (stage times are evidence to review, not blame) and no fairness claim (urgency stratification does not control for traffic, shift, season, call complexity or resources).

## 10. Decisions and open items (Oct 16, 2026)
- **Replay design (Oct 16, after testing):** fixed start + fixed baseline, growing end date. A rolling 90-day window was tried first and hid both planted stories (11368 never flagged; Monroe's surge absorbed into its own baseline). Tested: from Aug 25, 11368 is in control through Sep 10 and Act now by Sep 20.
- **Decided by the team after the brief:** red target flat 480 s (the brief's placeholder) instead of the history-based tiers of H-10, because tiers made the on-time check circular (60 of 62 counties Inconclusive on the baseline file); default window 90 days (counties under 30 red calls drop from 23 to 2); a place confirmed Below target but with Insufficient baseline is queued "Needs more data" and sorted first, as the brief's table says.
- **Open dependencies (documented, not assumed):** the meaning of `t_received` (911 receipt vs CAD creation); authoritative service targets; the provenance of any real travel estimate (no origin coordinates in public data); the overall 24-hour scope (brief issue 12); a real-data compatibility check; seasonality and case-mix change checks beyond the dispersion test.
