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
superseded. The team later removed the brief's "What Held Up the Call" stage-excess analysis and the travel-time comparison, then restored plain, descriptive stage medians (section 10). Where the team changed or overrode the brief (targets, default window, control rule, removed cards), section 10 lists each decision and its date.

## 1. Team and prompt
- **Team name:** Powerpuff Girls
- **Track:** on-campus (24 hours). See [`docs/schedule.md`](docs/schedule.md).
- **Prompt we chose:** Health Systems: Emergency Response (the [Devpost](https://six-sigma-hackathon.devpost.com/) challenge page lists no prompt number).
  > Ambulance dispatch to on-scene times are varying wildly across city zones, but the 911 center only looks at monthly averages, missing fatal outliers, not where or why these failures occur. Design a statistical tool to help manage dispatchers, response time logging in real-time, generate analyzes, and flag zones that are in need of resolution.
- **Our public repo:** https://github.com/allyannap/sixsigma

## 2. User and use case (rubric: scope 5, user and use case 5)
- **User:** a New York State EMS dispatch center's quality supervisor (not the dispatcher assigning an ambulance, not the public).
- **Decision the tool helps them make, and when:** at the start of a review, for New York State, a county or one ZIP code area (ZCTA): which areas need review; whether each is **below the service goal**, shows a **new statistical change** from its own history, or both.
- **Read-only.** The tool reads preloaded synthetic incidents from the back end and can replay them as a simulated stream. No user-entered incidents, no logging forms, no ambulance assignment, no ranking of people, no what-if or intervention ranking.
- **Why this matches the prompt:** it replaces the monthly average with an on-time rate and its uncertainty per place, a control chart against each place's own baseline, and tail percentiles, so the places behind the failures, and whether they are chronic or new, are visible.

## 3. Inputs (rubric: minimal inputs 5)
Only what this user can actually measure or already knows. Fewer is better; every input a user
cannot measure costs points.

| Input | Type and units | Where the user gets it |
|---|---|---|
| `incidents.csv`, one row per EMS call. Required (10 columns): `incident_id`, `zcta`, `urgency_code`, `t_received`, `t_assigned`, `t_enroute`, `t_onscene` (empty if cancelled), `cancelled`, `valid_time`, `held` | text IDs; 5-digit ZIP area; integer 0-9; ISO 8601 datetimes with the New York offset; Y/N | the dispatch center's computer-aided dispatch (CAD) export; columns follow NYC's public EMS Incident Dispatch Data. In this project the three files are **synthetic** |
| Minimal set for the core statistics: `zcta`, `urgency_code`, `t_received`, `t_onscene`, `cancelled`, `valid_time`. The other columns feed only the descriptive stage table | Y/N; seconds | Every column is recorded by a CAD system today. **The travel-estimate column was removed (H-14, Oct 17):** it needs a paid routing call at assignment plus an ambulance origin, and no output used it. The file no longer contains it |
| `config/targets.csv`: per urgency code and area type, `urgency_group`, `target_s`, `goal_on_time_pct` | seconds; percent | **illustrative placeholders (team policy, H-13): red by area type, adapted from NFPA 1720 demand zones: urban 480 s, suburban 600 s, rural 840 s, remote 840 s** (NFPA 1720 gives no remote time, so rural is reused, flagged); yellow 900 s, green 1800 s; 90% on time everywhere. Configurable per center (`config/build_targets.py`, `--flat` for red 480 s everywhere, `--from-history` for area P90s); not certified standards. NFPA 1720 is a volunteer fire-service standard with a different clock (dispatch or notification to arrival), and our area types come from Census density |
| Filters: `from`, `to`, `urgency`, `level` (state/county/zcta), `id`, `baseline_days` | dates; red/yellow/green; FIPS or ZCTA; days | picked on screen (no time-of-day filter) |

Lookups the tool ships with (the user supplies nothing): `data/lookup/zcta_county.csv`, `data/lookup/counties.csv`
(2020 Census) and the map shapes in `geo/`.

**Response-time definition (provisional, open dependency):** `total_wait_s = t_onscene - t_received`. Whether `t_received`
is the original 911 call receipt or the EMS CAD incident creation is **not yet confirmed**; it must be validated against the
source (and kept consistent across test data and any real extract) before real use. It is not silently redefined here.

## 4. The statistics, and why (rubric: valid QC analysis 25)
Every formula is one function in `app/qc.py`; the known answers below are tests in `tests/test_qc.py` (tolerance 5e-4 unless stated).

- **Valid call and late call.** A valid completed call is not CANCELLED, has `t_onscene`, `valid_time = Y`, and times in order;
  cancelled, invalid, missing and out-of-order rows count in volume only. Rows with a repeated `incident_id`, an unreadable
  `t_received`, an unknown ZCTA or an unknown urgency code are dropped on loading and counted by reason (`/api/health`).
  `late = total_s > target_s(urgency_code, area type)`; `very_late = total_s > 2 x target_s`.
  Per place: `n_valid`, `n_on_time`, on-time rate, late rate, median, P90, P95 (with 95% intervals for the median and P95),
  cancelled, invalid, cancel %, calls per day (period and baseline).
- **A. Specification ("Are calls meeting the service goal?").** On-time rate with a **95% Wilson score interval**,
  compared with the goal g: **Meets target** if the lower bound ≥ g; **Below target** if the upper bound < g; otherwise
  **Inconclusive** (the interval includes g), and also Inconclusive with "insufficient data" under 30 valid calls. The rate,
  interval, goal and n are always shown. Inconclusive is never labelled as meeting the goal.
- **Multiplicity of the Below label (`chance_below`).** With many places, some read Below by chance. For each place with
  n ≥ 30, if its true on-time rate were exactly g, the on-time count is X ~ Binomial(n, g) and P(Below) = P(X ≤ k_max), where
  k_max is the largest k whose Wilson upper bound is under g. The expected number of chance Below labels is the sum over
  places; the page shows it beside the observed count. (Places truly better than the goal have a smaller chance, so this is
  an upper reference, not a correction.)
- **B. Statistical control ("Has the process changed relative to its own history?").** A **p chart of the late share**
  for the selected place and urgency group, against a fixed **baseline**: the 60 days before `from` (never overlapping the
  selection), stretched to 120 days under 30 valid calls. Subgroup = the shortest of day, week or calendar month with
  baseline calls per day x days x p̄ ≥ 5.
  - **Baseline adequacy and stability (Phase I screen, `baseline_screen`).** The baseline is split into subgroups of that
    unit. p0 = total late / total calls; a subgroup whose exact binomial tail (the smaller of P(X ≥ late) and P(X ≤ late),
    X ~ Binomial(nᵢ, p0)) is under 0.00135 is dropped, **once**, and p̄ is recomputed from the rest. The baseline is
    **unstable** if, after dropping, another subgroup still has a tail under 0.00135; or more than 10% of the subgroups
    were dropped; or 8 or more in a row lie on one side of p̄; or the kept subgroups are overdispersed (Pearson chi-square
    p < 0.01). With fewer than 4 baseline subgroups the screen is **not run** (reported as "not checked", not as stable
    evidence); this is the usual case for a single ZIP with monthly subgroups.
  - **Limits** from the screened baseline: CL = p̄, UCL_i = min(1, p̄ + 3 sqrt(p̄(1 - p̄)/n_i)), LCL_i = max(0, p̄ - 3 sqrt(...)).
  - **Control rule.** Each subgroup gets the exact binomial p-value P(X ≥ late_i | n_i, p̄). A **signal** = above its UCL
    **and** p-value < 0.00135 (the one-sided tail of a 3-sigma point), so a tiny subgroup cannot signal on the normal
    approximation's error. **Out of control** = 2 or more signals, **or** one signal with p-value < 0.00135 / m
    (Bonferroni over the m subgroups on the chart). Exactly one weaker signal leaves the place **In control** with
    `watch = true` (shown as a "watch" chip). Only the upper side counts, because the question is deterioration; subgroups
    below the LCL are listed as improvements. **Insufficient baseline** = under 30 baseline calls after the stretch, no
    subgroup size reaching n p̄ ≥ 5, p̄ of 0 or 1, an unstable baseline, or no subgroups. The run-of-9 rule is shown for
    information only. Being in control does not mean good service.
  - **Replay keeps the baseline fixed:** the simulated replay holds the period's start (and so its baseline) fixed and moves
    only the end forward one day per tick; a rolling window would let the baseline drift into the change it should detect.
- **C. Queue label (from A and B; both badges are always shown beside it).** Below + Out → **Act now: performance gap +
  recent signal**; Below + In → **Ongoing gap**; Meets or Inconclusive + Out → **Recent process change: investigate**;
  Meets + In → **Meets goal; no change signal**; anything with Insufficient baseline, and Inconclusive + In →
  **Needs more data / Inconclusive** (places confirmed Below target sort first inside it). "Needs review" = the first three,
  reported as recent signal (Act now + Recent change) and ongoing gap.
- **Ranking (`excess_late`).** Inside a queue label, places rank by late calls beyond what the goal allows:
  `n_late - (1 - g) n_valid`. A big place with a modest gap outranks a tiny place with a high late rate.
- **Percentiles (`percentiles`).** Median, P90, P95 by linear interpolation. 95% intervals for the median and P95 are exact
  distribution-free order-statistic intervals at every n (Hahn & Meeker 1991): with B ~ Binomial(n, q), [x_(l), x_(u)] covers
  the q quantile with probability F(u - 1) - F(l - 1); the narrowest pair reaching 95% is used, else each side alone with a
  2.5% tail. A bound that needs more calls than exist is `None` ("n/a"): any median interval needs 6 calls; the P95
  upper bound needs 59 (from 2 to 58 calls only the P95 lower bound exists).
- **Stage medians (`stage_summary`), descriptive only.** Median received → assigned, assigned → en route and en route → on
  scene seconds, and % held, for the period beside its baseline. No excess, no ranking, no cause.
- **Secondary (never set a status):** I chart on ln(minutes) with baseline limits (sigma = MR̄ / 1.128), only test 1 marked,
  with skewness and lag-1 autocorrelation reported. One-sided Cpk on ln(total_s / target_s) with the Bissell bound (assumes
  lognormal times); its sigma is MR̄ / 1.128 over calls in time order across **all** places and days of the selection, so it
  mixes between-place and between-day variation: an **overall, Ppk-like** sigma, not a within-subgroup one; read it as a rough
  summary. ANOM on ln(minutes) within one urgency group: decision limits around the **call-weighted average** of the places
  (sum of all values / N, so a big place pulls the reference toward itself), Bonferroni h; descriptive only (not adjusted for
  time of day, traffic, call mix, urban vs rural geography or resources, so no fairness claim).
- **Assumptions and how they are checked:**
  1. **Independence.** Calls within a subgroup are independent Bernoulli trials with a common late probability. Not tested
     directly; the dispersion check and the baseline screen catch strong extra-binomial variation (overdispersion makes
     3-sigma limits too narrow). The synthetic data has shared county-day effects, so this is only partly true there too.
  2. **n·p̄ sizing holds only on average.** The subgroup unit is chosen so the baseline's average subgroup has n·p̄ ≥ 5;
     individual subgroups (a quiet week, a short final month) can be smaller. The exact binomial p-value requirement
     protects these from false signals; the 3-sigma limits are approximate for them.
  3. **The baseline is normal operation.** The 60 days before the period are assumed to be in control and comparable; the
     screen drops isolated unusual periods once and refuses unstable baselines, but a slow drift or seasonal shift inside
     the baseline is not modelled (open limitation; the data now has winter and summer effects).
  4. **ANOM assumes equal variance** of ln(minutes) across places (pooled sigma) and approximately normal log times.
  5. Urgency groups are analysed separately; combining groups is allowed but the page warns that case mix is mixed.
  6. Measured false alarms on the no-change file (`data/sensitivity.py`, re-measured Oct 17 on the H-19 files): counties,
     red, three non-overlapping 90-day windows, 2 of 186 (1.1%); yellow 3 of 186 (1.6%); five overlapping 180-day windows,
     red 5 of 310 (1.6%), yellow 5 of 310 (1.6%). The state's daily chart is rarely evaluable (0 of 8 red 90-day windows,
     2 of 8 yellow), and none of the evaluable windows was out of control. The API test windows give 3 of 186 (1.6%; fails
     above 10%). Detection (11368, drive time scaled from Sep 1): x1.6, x1.25 and x1.15 are detected (all Act now) at the
     H-19 volume; a +2% per week drift is not.
- **Known-answer checks** (each a test; each re-run with `app/qc.py` on Oct 17):
  - Wilson: 85 of 100 → [0.76716, 0.90694]. 300 calls, goal 90%: 285 on time → [0.91915, 0.96947] Meets; 255 → [0.80518, 0.88597] Below; 270 → [0.86083, 0.92905] Inconclusive. 0 of 20 → Inconclusive (insufficient data), not Below; 29 of 29 → Inconclusive, not Meets.
  - p chart: 5 days, n = 20, baseline p̄ = 0.20 (UCL 0.4683, LCL 0). Late 2, 3, 1, 4, **12**: day 5 (p = 0.60) is above the UCL with exact p-value 1.017e-4 < 0.00135 / 5 = 2.7e-4 → **Out of control** on one strong signal. Late 2, 3, 1, 4, **10**: day 5 (p = 0.50) is above the UCL but its p-value 0.002595 ≥ 0.00135 → **not a signal**, In control (no watch). Varying n with p̄ = 0.10: n = 10 → UCL 0.3846; n = 100 → 0.19 (LCL 0.01); n = 1000 → 0.12846.
  - Baseline screen: 10 days of n = 100, late 20 x 9 and 40 → the 40 day (tail 3.8e-5) is dropped, p̄ = 0.20, stable. Late 20 x 8 and 45, 45 → 2 of 10 dropped (> 10%), unstable. 23 x 8 then 17 x 2 → 8 in a row above p̄ = 0.218, unstable. 12, 30 alternating → chi-square / df 5.425, overdispersed, unstable. 3 subgroups → not checked.
  - Dispersion: n = 100 x 4, late 0, 20, 0, 20 → chi-square 44.44, df 3, ratio 14.81, overdispersed.
  - `chance_below`: one place, n = 30, goal 90% → 0.025827 (Below for k ≤ 23 on time; P(X ≤ 23 | 30, 0.9)).
  - `excess_late`: 200 valid, 30 late, goal 90% → 10 (the goal allows 20).
  - Queue: all 9 combinations of A and B.
  - Percentiles: 1..20 → median 10.5 with 95% CI [6, 15], P90 18.1, P95 19.05 with CI [17, n/a] (the upper bound needs 59 calls).
  - I-MR: 1.0, 1.2, 0.9, 1.1, 1.3 → CL 1.1, UCL 1.6984, LCL 0.5016. Cpk (target 8 min) 1.6368, bound 2.8803. ANOM groups A/B/C → h 2.9333, F 26.0.
  - Stage medians: dispatch 10, 20, 30, missing → 20; held 1 of 3 known → 33.3%.
  - Degenerate: n = 0, n = 1, constant data, p̄ = 0 or 1, no baseline, too few baseline subgroups: each returns None or a status of Inconclusive / Insufficient baseline / not checked with a message, never inf or a pass.

Fixed for every team:
- The statistic lives in **one plain, tested function** (`app/qc.py` or `app/qc.R`). The API, app or
  package only calls it and displays the result. No statistics inside UI code.
- Every statistic has a test against a known answer and a degenerate case (constant data, n = 1, missing values).
- You can explain every number the tool prints. If you cannot, it is not done.

## 5. Delivery (rubric: working tool 25)
- **Stack:** dashboard: FastAPI (Python) back end, read-only `GET` routes `/api/summary`, `/flagged`, `/pchart`, `/stages`, `/signal_calls`, `/replay`, `/imr`, `/anom`, `/meta`, `/health` (docs/api.md), with a React front end. Every statistic is in `app/qc.py`.
- **Starting demo:** `demos/fastapi/`, plus `demos/reactfront/` as `app/frontend/`.

Fixed for every team:
- Start from **one** demo in `demos/`, copied to `app/`. Keep its four-script contract
  (`testme`, `manifestme`, `deployme`, `README.md`); `testme` starts the tool with one command.
- Deployed on the course **Posit Connect** server with a public URL (publisher key handed out at the
  event). Deploy early: copy one workflow from
  [`.claude/skills/connect-publish/workflows/`](.claude/skills/connect-publish/workflows/).
- A small tool that runs beats a large tool that does not.

## 6. Outputs
- **What the user sees** (one page, labelled "SYNTHETIC DATA" and "Simulation / Replay"): filters (dataset, urgency, explicit From and To dates; blank or incomplete dates show No date selected across all sections with no analysis requests; no time-of-day), a replay bar (requires both dates and starts at the selected From date, ending at the selected To date or dataset end; fixed baseline; one simulated day every 3 s; shows that day's calls read-only), summary (places needing review split into recent signal and ongoing gap, with the number expected Below by chance; counts by queue label; on-time k of n with CI against the goal; median and P95 with intervals; very-late count; calls, cancelled, invalid, cancel %, calls per day); (1) state → county → ZCTA map with a back button, coloured by map group (Critical / Watch / Near goal / Stable, gray only under 30 valid calls; see section 10) or by late share with the Status / Late % switch, and a table ranked by label then excess late calls, with n, on-time rate + CI, Target and Control badges (plus a watch chip), queue label, excess late, P95 + CI, volume, baseline stability, and secondary Cpk; (2) the p chart with the screened baseline window, signal evidence (exact p-values), the dispersion check, the calls behind a signal, a descriptive stage-median table (period vs baseline, % held); (3) an investigation list of flagged areas with their target and control evidence, and a statewide list of flagged ZIP areas; (4) a geographic comparison histogram of area on-time rates, with selected-area median, P90, configured target, sample size and the existing Wilson target judgment; ANOM remains available through the API. The footer states the response-clock-start caveat and that the targets are NFPA 1720-based placeholders.

## 7. Test datasets and codebook (rubric: demo 10, datasets 5, codebook 5)
`data/README.md` is the codebook: every file, every column with units, source or synthetic origin, generation assumptions,
the rebuild command, expected signals, and what it would take to collect this data for real.
- **Datasets:** three synthetic 12-month files (Oct 16, 2025 to Oct 15, 2026) covering every New York ZCTA, about 1.82 million calls each (0.09 calls per person per year, about 60% of a real US rate of ~0.15; 0.0198 until H-17, 0.04 until H-19), xz-compressed CSV of about 22 MB each (under the project's 25 MB limit), built by a fixed-seed generator: `incidents_baseline.csv.xz` (seasonal pattern; persistent rural long-trip gaps; no planted change, so control signals are counted false alarms), `incidents_station_closure.csv.xz` (from Sep 1, 2026, travel estimates **and actual drives** in ZIP 11368 rise 60%), `incidents_summer_surge.csv.xz` (Jul 1 to Aug 31, 2026, Monroe County volume +30%, held calls common, received-to-assigned time up). Drives vary both faster and slower than the estimate, with slow outliers. Since H-13 the files also carry day-to-day effects shared by a county, winter and summer effects on lateness, an hour-of-day arrival profile and congestion-driven held calls; Monroe is identical to baseline outside Jul-Aug. A separate `incidents_messy_sample.csv.xz` (13,327 rows with injected duplicates, missing and out-of-order times, unknown ZIPs and codes) tests cleaning. `data/validate.py` checks schema, time order, lookups, interval arithmetic, baseline history, the stories, the H-13 features, `--messy` the sample, and `--reproduce` identical rebuilds from the seed. `data/sensitivity.py` measures false alarms and detection power.

## 8. Documentation and reproducibility (rubric: docs 10, public repo 5)
- `README.md` says what the tool does, for whom, every input and parameter, how to run it in one
  command, and walks through the demo on each test dataset.
- Public GitHub repo; a fresh clone runs `testme` and the tests pass with no extra steps.
- Submit on Devpost: the repo link plus a demo.

## 9. Out of scope
What we will NOT build, so nobody (human or agent) builds it by accident.
- Default: logins, databases, real customer data, a second statistic before the first one is tested.
- Actual ambulance assignment or unit recommendation; ranking individual ambulances, crews or dispatchers (no `unit_id` or dispatcher IDs, by design); route optimization; patient outcomes; a what-if or intervention optimizer (deferred, consider later); user-entered incident logging; a live CAD or FDNY connection; time-of-day filters or time-of-day-adjusted analysis; a stage-by-stage delay attribution ("What Held Up the Call" stage excess) and an ambulance-vs-estimate travel comparison (removed Oct 16, see section 10; plain stage medians are shown, descriptive only).
- No causal attribution or blame, and no fairness claim (urgency stratification does not control for traffic, shift, season, call complexity or resources).

## 10. Decisions and open items (Oct 16-17, 2026)
- **Map colours split (Oct 17, H-18):** the map no longer paints every "Needs more data / Inconclusive" place gray. One rule (`mapTier`) colours each area Critical (Act now), Watch (Ongoing gap, Recent change, or confirmed below target when change cannot be judged), Near goal (30+ valid calls, on-time interval includes the goal), Stable (meets the goal) or gray (under 30 valid calls). A Status / Late % switch shows late share as a hot-spot ramp, with sparse areas faded. Display only: queue labels, badges, statistics and the API are unchanged. Reason: ZIP 10025 (318 red calls, 91.8% on time, CI 88.3-94.4, on the 0.04 data) read gray although it had plenty of data. On the H-19 data (baseline, red, default window) counties read Watch 40, Near goal 3, Stable 19, gray 0; Manhattan's 69 ZIPs Near goal 32, Stable 11, gray 26.
- **Input contract reduced (Oct 17, H-14):** the travel-estimate column and `disposition` were removed from the file; `cancelled` Y/N replaces `disposition`. Verified: every API response is identical to the pre-change snapshot except the replay event field. The synthetic generator keeps its internal travel model.
- **Removed by the team (Oct 16, after the first build):** "What Held Up the Call" (stage excess per late call) and the "Unusual travel-time difference" (actual drive minus the Google estimate), with their API routes (`/api/delays`, `/api/google`), statistics and tests. Reason: too much for this version and out of the core scope (spec + control). This overrides the brief's issues 4 and 7 and items 7-8 of its section 4; the data files still carry `held` and `eta_google_s`, so either card could return later.
- **Replay design (Oct 16, after testing):** fixed start + fixed baseline, growing end date. A rolling 90-day window was tried first and hid both planted stories (11368 never flagged; Monroe's surge absorbed into its own baseline). Re-measured after H-19: from Aug 25, 11368 is in control through Sep 3 (a watch chip on Sep 3) and out of control every day from Sep 4 to Oct 15 (Act now from Sep 8); the one-day blip of the 0.0198 data is gone.
- **Decided by the team after the brief (Oct 16, superseded for targets by H-13 below):** red target flat 480 s (the brief's placeholder) instead of the history-based tiers of H-10, because tiers made the on-time check circular (60 of 62 counties Inconclusive on the baseline file); default window 90 days (counties under 30 red calls drop from 23 to 2); a place confirmed Below target but with Insufficient baseline is queued "Needs more data" and sorted first, as the brief's table says.
- **H-13 (Oct 16-17, after a four-part robustness review):**
  - **Targets (team policy decision):** red tiered by area type, adapted from NFPA 1720 demand zones as illustrative placeholders: urban 480 s, suburban 600, rural 840, remote 840 (NFPA gives no remote value; rural reused, flagged); yellow 900, green 1800; goal 90%. Unlike the H-10 history tiers this is not circular (targets do not come from the data). `--flat` and `--from-history` remain.
  - **Control rule:** exact binomial point p-values (signal = above the UCL and p < 0.00135); out of control needs 2 signals or one with p < 0.00135 / m, else in control with a watch chip; a Phase I baseline screen (drop unusual periods once; unstable baselines give Insufficient baseline; fewer than 4 periods are not checked). Measured false alarms on the clean file after H-13: 0 of 186 county-windows (red) and 1 of 186 (yellow), three 90-day windows; re-measured after H-17: 2 of 186 and 2 of 186; after H-19 (below): 2 of 186 and 3 of 186. The planted 11368 and Monroe stories are detected (README section 7).
  - **Percentile intervals:** exact order-statistic intervals at every n replace the bootstrap; bounds can be n/a.
  - **Supervisor data:** `chance_below` beside the Below count, `excess_late` ranking, cancelled / invalid / cancel % / calls per day, baseline stability on each card, a statewide flagged-ZIP list (`/api/flagged`), the calls behind a signal (`/api/signal_calls`), data-quality counts in `/api/health`; messy input is dropped and counted, never raised.
  - **Stage medians restored, descriptively:** `/api/stages` and `qc.stage_summary` give plain medians of each stage and % held, period vs baseline, with no excess, ranking or cause. This partly restores the brief's "inspect abnormal timing stages"; its AT-6 (stage excess) and AT-7 (Google comparison) stay overridden.
  - **Wording:** "Meets goal; statistically stable" became "Meets goal; no change signal"; Cpk's sigma is described as overall (Ppk-like); ANOM is compared with the call-weighted average, with a geography note.
  - **Data:** day-to-day county effects, winter/summer seasonality, hour-of-day profile, congestion, a messy sample file and `data/sensitivity.py` (data/README.md).
- **H-17 (Oct 17, user decision; the rate was raised again in H-19 below): synthetic volume doubled and files xz-compressed.** The generator's call rate went from 0.0198 to 0.04 calls per person per year (about 800,000 calls per file instead of 400,000; about one-quarter to one-third of a typical US rate of ~0.13-0.15 instead of one-eighth). No other generator parameter changed, so the planted stories and their effect sizes are the same. Why: at one-eighth of real volume a single ZIP had too few calls for anything but a very large change to be seen (11368 had 68 valid red calls in Sep 1-Oct 15). To keep each file under 25 MB the incident files are now xz-compressed CSV (`data/incidents_{baseline,station_closure,summer_surge,messy_sample}.csv.xz`, preset 9; the three main files are about 10 MB each, the messy sample 82 KB; they were `.csv.gz` before). Two behaviour changes, both measured: (1) **smaller changes are now detected**: the x1.15 and x1.25 variants of 11368 are out of control (x1.25 Act now from Sep 9; x1.15 Recent change from Sep 15), the planted x1.6 is out of control every replay day from Sep 3 with no blip, and the +2%/week drift is still missed; (2) **Monroe Sep 1-Oct 15 on `summer_surge` now reads Insufficient baseline** (Meets target, 95.0%; its 60-day baseline Jul 3-Aug 31 is the surge, overdispersed, chi-square / df 1.68) instead of in control. Clean-file false alarms: 2 of 186 county-windows (red, 1.1%), within the 10% test limit. Synthetic times are still faster than published benchmarks (urban red median about 4.7 min). Verified: `validate.py` 71 PASS, `--reproduce` 75, `--messy` 14; pytest 181 passed.
- **H-19 (Oct 17, user decision): synthetic call rate 0.04 → 0.09 calls per person per year** (2.25x; about 1.82 million calls per file; about 60% of a real US rate of ~0.15, up from about one-quarter). Why 0.09 and not the real rate: the project keeps every data file under its own 25 MB limit, and at 0.09 the xz files are about 22 MB each (baseline 21,974,896 bytes); a real rate of ~0.15 would need files of about 37.5 MB. No other generator parameter changed, so the planted stories and their effect sizes are the same; `config/targets.csv` targets are unchanged (only the reference P90 columns were recomputed). Measured behaviour changes vs H-17: 11368 Sep 1-Oct 15 72.2% on time of 407 valid red calls (was 69.2% of 201), still Act now; replay out of control from Sep 4 (was Sep 3), Act now from Sep 8; Monroe Jul-Aug 80.2% of 5,285 with 10 weekly signals (was 78.5% of 2,438, 9); x1.15 and x1.25 both read Act now; the +2%/week drift is still missed. False alarms on the clean file: 2 of 186 county-windows red and 3 of 186 yellow (`sensitivity.py`), 3 of 186 in the API test windows (Erie, Orange, Greene); one clean-file ZIP (11212, Kings) is now flagged Recent change, a false alarm the flagged-ZIP test allows (up to 1% of ZIPs, never 11368). Map groups on the baseline default window: counties Watch 40, Near goal 3, Stable 19, gray 0. Cost: generation about 29 minutes, `validate.py --reproduce` about 15 minutes, one dataset loads in the API in about 29 s (all three about 88 s). Synthetic times are still faster than published benchmarks (urban red median 279 s, about 4.7 min). Verified: `validate.py` 71 PASS, `--reproduce` 75, `--messy` 14; pytest 181 passed.
- **Open dependencies (documented, not assumed):** the meaning of `t_received` (911 receipt vs CAD creation); authoritative service targets (the NFPA-based tiers are placeholders, with a different clock); the overall 24-hour scope (brief issue 12); a real-data compatibility check; seasonal adjustment and slow baseline drift (seasonality is now simulated but not modelled); the size of real overdispersion.

## Single-priority selection (team instruction, Oct 17)

The dashboard allows exactly one **call urgency**: 1 Most urgent (API `red`, codes 0-2) OR 2 Urgent (`yellow`, 3-5) OR 3 Less urgent (`green`, 6-9), default 1. It is shown as numbered chips, never in red / amber / green, because those colours belong to the map status; a hint under the chips says they choose which calls are analysed (H-21). Selecting another replaces the previous selection; clicking the selected priority cannot clear it. The state stores a single priority, and all analysis/replay requests contain only that group. Priority uses accessible radio semantics with arrow/Home/End navigation. API clients may still request mixed groups with the existing warning.

## AI investigation briefing (H-16, user approved Oct 17)

The Key Metrics summary generates a short EMS investigation briefing with Ollama Cloud from existing backend aggregate results. It uses the selected area, inclusive visible From/To dates, one priority and dataset, distinguishing a target gap from recent deterioration. Its compact card shows the map legend tier (Critical, Watch, Near goal, Stable, Too few calls) and its matching color, followed by one short AI-written finding and one AI-written evidence-review next step. The tier mirrors the frontend `mapTier` rule; the model cannot choose it. A key fact is bolded. “Expand full briefing” opens the model-written supporting explanation and the same next step. The prompt requests a small JSON object, which the backend validates and rejects if malformed or too long. Ollama Cloud does not currently support structured-output mode. It may cite existing P95/very-late counts and descriptive stage medians and identify ranked child areas, but cannot infer causes, fatalities or staffing actions. Root .env is backend-only; OLLAMA_API_KEY takes priority over the existing OPENAI_API_KEY alias, which is an Ollama credential. OLLAMA_MODEL configures the model. API route `/api/ai_summary` requires explicit dates; the UI passes its displayed default dates once metadata loads. Changing filters hides superseded prose; empty data and provider errors are explicit. Replay generation waits until playback is paused. Identical evidence is cached in memory for ten minutes (128 entries). This overrides the previous no-AI-text design choice; the existing statistical judgments remain authoritative.

## Compact geographic insights (H-11 follow-up, user approved Oct 17)

Keep the geographic comparison chart and a compact area summary inside the insights card. The area summary follows the map's selected county or ZIP when present in the comparison. Move area search, full response profile, longest wait, area-type explanation, low-volume caution, lowest-rate areas and statistical confidence into an Area details sidebar styled like Investigate. Clicking or keyboard-activating a histogram bar opens its area list in that sidebar; picking an area also updates the dashboard selection. The sidebar traps focus, closes with Escape and restores focus to its opener. Key Metrics shows a three-line AI briefing preview on desktop; its full text and filter context remain available through Read full briefing. Short laptop screens keep only the on-time metric beside the chart; the full profile remains in the sidebar. Mobile uses the full-width chart and an overlay drawer, with normal page scrolling.

## Compact response trends and labeled tabs (H-11 follow-up, user approved Oct 17)

Replace the insight carousel's arrows, dots and page count with two persistent labeled tabs: Area comparison and Response trends. Each controls one mounted panel, preserves its selection when switching, supports arrow/Home/End keys, and honors investigation links to section-4 and section-2. Response trends keeps the finding, responsive p chart, limit legend, period picker and compact missed-target snapshot inside the card. Details & evidence opens a matching Response details sidebar with Period, Flagged periods, Calls, Stage times and Method tabs. Call review selects the corresponding period and opens Calls; call records load only while that panel is open. Baseline checks remain accessible when history is insufficient or no chart is available. On short laptop screens, repeated baseline context and full limit values move into the sidebar to preserve chart space. The statistical computations, classifications and query windows are unchanged.
