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

## 4. Statistical specification (rubric: valid QC analysis 25)

This section separates two questions that must not be conflated:

| Question | Method | What it tells the supervisor |
|---|---|---|
| Are calls meeting the service goal? | On-time rate + 95% Wilson interval | Whether the observed service level is clearly above, below, or inconclusive against the goal |
| Has the process changed from its own history? | Late-share p chart | Whether there is evidence of a recent increase relative to a fixed baseline |

The first is a **specification** judgment; the second is a **process-control** judgment. Both badges remain visible, and neither substitutes for the other. Each statistic is implemented in a plain function in [`app/qc.py`](app/qc.py). Known answers and degenerate cases are tested in `tests/test_qc.py` (tolerance `5e-4` unless stated).

### 4.1. Definitions and eligible calls

| Term | Definition |
|---|---|
| Valid completed call | Not cancelled; has `t_onscene`; `valid_time = Y`; and timestamps are in order. |
| Response time | `total_s = t_onscene - t_received`. The meaning of `t_received` (original 911 receipt or EMS CAD incident creation) is not confirmed; validate it against the source before real use. |
| Late call | `total_s > target_s(urgency_code, area type)`. A call exactly at its target is on time. |
| Very late call | `total_s > 2 × target_s`. |

Cancelled, invalid, missing, and out-of-order calls count toward volume only; they do not contribute to response-time statistics. Rows with repeated `incident_id`, unreadable `t_received`, unknown ZCTA, or unknown urgency code are dropped during loading and counted by reason in `/api/health`.

Place-level summaries include valid and on-time counts, on-time and late rates, median/P90/P95 response times, 95% intervals for median and P95, cancelled and invalid counts, cancellation percentage, and calls per day for the selected period and baseline.

### 4.2. Service-goal judgment: “Are calls meeting the goal?”

For each place, calculate the on-time proportion and its **95% Wilson score interval**. Let `g` be the goal as a proportion (for example, 90% is `0.90`):

| Result | Rule |
|---|---|
| **Meets goal** | The interval’s lower bound is at least `g`. |
| **Below goal** | The interval’s upper bound is below `g`. |
| **Inconclusive** | The interval includes `g`, or there are fewer than 30 valid calls. The rate and interval are still shown when available. |

Always display the on-time rate, interval, goal, and valid-call count `n` when available. An Inconclusive result is never described as meeting the goal.

#### Chance Below labels

With many places, some will read Below by chance. For each place with at least 30 calls, assume its true on-time rate equals `g`:

```text
X ~ Binomial(n, g)
P(Below) = P(X ≤ k_max)
```

`k_max` is the largest on-time count whose Wilson upper bound is below `g`. Sum `P(Below)` across eligible places to estimate the expected number of chance Below labels. Show that estimate beside the observed count. It is an upper reference—not a correction—because places truly better than the goal have a lower chance of reading Below.

### 4.3. Process-control judgment: “Has the process changed?”

Use a **p chart of the late-call share** for the selected place and urgency group. Compare the selected period with that place’s fixed baseline; this is separate from the service-goal judgment above.

#### Baseline window and subgroup size

- The baseline is the 60 days before `from`; it never overlaps the selected period.
- If the baseline has fewer than 30 valid calls, extend it to 120 days.
- Choose the shortest subgroup—day, week, or calendar month—whose expected late count reaches 5:

```text
baseline calls per day × subgroup days × baseline late share (p̄) ≥ 5
```

If even a month does not reach this threshold, the chart has insufficient baseline for a control judgment.

#### Phase I baseline screen (`baseline_screen`)

Split the baseline into subgroups. Start with `p₀ = total late / total calls`. For each subgroup `i`, calculate the smaller exact binomial tail using `X ~ Binomial(nᵢ, p₀)`. Drop a subgroup when that tail is below `0.00135`, **once**, then recompute `p̄` from the retained subgroups.

The baseline is unstable if any of the following holds:

- A subgroup still has a tail below `0.00135` after the one-time removal.
- More than 10% of baseline subgroups were removed.
- Eight or more consecutive subgroups lie on one side of `p̄`.
- The retained subgroups are overdispersed (Pearson chi-square `p < 0.01`).

With fewer than four baseline subgroups, do not run the screen. Report **not checked**—not evidence that the baseline is stable. This commonly occurs for a ZIP with monthly subgroups.

#### Control limits and signals

For subgroup size `nᵢ`, use the screened baseline late share as the center line and calculate limits as follows:

```text
CL    = p̄
UCLᵢ  = min(1, p̄ + 3 × √(p̄(1 − p̄) / nᵢ))
LCLᵢ  = max(0, p̄ − 3 × √(p̄(1 − p̄) / nᵢ))
```

For each selected-period subgroup, compute the exact upper-tail probability `P(X ≥ lateᵢ | nᵢ, p̄)`. A **signal** requires both conditions:

1. The late share is above that subgroup’s UCL.
2. The exact p-value is below `0.00135` (the one-sided tail probability of a 3-sigma point).

The exact-test condition prevents small subgroups from signaling solely because the normal approximation is poor.

| Control result | Rule |
|---|---|
| **Out of control** | At least two signals, or one signal with `p < 0.00135 / m` (Bonferroni adjustment across the `m` selected-period subgroups). |
| **In control + watch** | Exactly one signal that does not meet the stronger single-signal threshold. Set `watch = true`. |
| **In control** | No signals, with an adequate, stable baseline. |
| **Improvement** | A selected-period subgroup below its LCL; list it separately. The lower side does not count as deterioration. |

Report **Insufficient baseline** when there are fewer than 30 baseline calls after any extension, no subgroup size reaches the expected-late threshold, `p̄` is 0 or 1, the baseline is unstable, or the selected period has no subgroups. Nine consecutive selected-period subgroups above the center line are shown as information only and do not set status. **In control does not mean good service**; the service-goal judgment answers that question.

#### Replay behavior

Replay fixes the selected period’s start date and its baseline, then advances only the end date by one day per tick. A rolling window could move the baseline into the change the chart is meant to detect.

### 4.4. Queue labels and ranking

The service-goal and control judgments are both shown next to the queue label. The mapping covers all nine combinations:

| Goal judgment | Control judgment | Queue label |
|---|---|---|
| Below | Out of control | **Act now** — performance gap and recent signal |
| Below | In control | **Ongoing gap** |
| Below | Insufficient baseline | **Needs more data / Inconclusive**; confirmed Below places sort first within this label |
| Meets | Out of control | **Recent process change: investigate** |
| Meets | In control | **Meets goal; no change signal** |
| Meets | Insufficient baseline | **Needs more data / Inconclusive** |
| Inconclusive | Out of control | **Recent process change: investigate** |
| Inconclusive | In control | **Needs more data / Inconclusive** |
| Inconclusive | Insufficient baseline | **Needs more data / Inconclusive** |

The first three labels are **Needs review**: Act now and Recent process change are reported as recent signals; Ongoing gap is reported separately.

Within each label, rank places by `excess_late`, the number of late calls beyond the count allowed by the goal:

```text
excess_late = n_late − (1 − g) × n_valid
```

This prioritizes total excess volume: a large place with a modest gap can rank ahead of a small place with a high late rate.

### 4.5. Distribution summaries and supporting analyses

#### Response-time percentiles (`percentiles`)

Calculate the median, P90, and P95 by linear interpolation. The median and P95 receive exact, distribution-free 95% order-statistic intervals for every sample size (Hahn & Meeker, 1991). For quantile `q`, let `B ~ Binomial(n, q)`; interval `[x₍ₗ₎, x₍ᵤ₎]` covers the quantile with probability `F(u − 1) − F(l − 1)`. Use the narrowest interval reaching 95%; otherwise use one-sided bounds with a 2.5% tail. If a bound requires more observations than exist, return `None` (“n/a”). A median interval needs at least 6 calls; the P95 upper bound needs 59. With 2–58 calls, only the P95 lower bound exists.

#### Stage summaries (`stage_summary`)

Descriptive only: report median received-to-assigned, assigned-to-en-route, and en-route-to-on-scene times, plus percent held, for the selected period beside its baseline. Do not calculate excess, rank stages, or infer a cause.

#### Secondary analyses (never set a status)

- **I chart:** individual values of `ln(minutes)` with baseline limits; `σ = MR̄ / 1.128`. Mark only test 1. Also report skewness and lag-1 autocorrelation.
- **Cpk:** one-sided capability on `ln(total_s / target_s)` with the Bissell bound, assuming lognormal times. Estimate `σ = MR̄ / 1.128` from calls in time order across all places and days in the selected period. This mixes between-place and between-day variation, so it is an overall, Ppk-like rough summary—not a within-subgroup capability estimate.
- **ANOM:** analyze `ln(minutes)` within one urgency group. Decision limits are around the call-weighted average across places (sum of all values divided by `N`; larger places pull the reference toward themselves), with Bonferroni `h`. This is descriptive, not adjusted for time of day, traffic, call mix, geography, or resources; it makes no fairness claim.

### 4.6. Assumptions and measured limitations

- **Independence:** calls within a subgroup are assumed to be independent Bernoulli trials with a common late probability. This is not tested directly. The dispersion check and baseline screen catch strong extra-binomial variation; overdispersion makes 3-sigma limits too narrow. Synthetic data has shared county-day effects, so independence is only partly true there.
- **Subgroup size:** `n·p̄ ≥ 5` is met only by the baseline’s average subgroup. A quiet week or short final month may be smaller. Exact binomial p-values protect against false signals in small subgroups; 3-sigma limits remain approximate.
- **Baseline:** the 60 days before the selected period are assumed comparable and in control. The screen removes isolated unusual periods once and rejects unstable baselines, but does not model slow drift or seasonal shifts within the baseline.
- **ANOM:** assumes approximately normal log times and equal variance of `ln(minutes)` across places (pooled sigma).
- **Urgency mix:** analyze urgency groups separately. Combining groups is allowed, but the dashboard warns that case mix is mixed.

Measured on the no-change file with [`data/sensitivity.py`](data/sensitivity.py), using H-19 data and windows re-measured Oct 17:

- Counties, three non-overlapping 90-day windows: red 2/186 (1.1%); yellow 3/186 (1.6%). Five overlapping 180-day windows: red 5/310 (1.6%); yellow 5/310 (1.6%).
- Statewide daily charts are rarely evaluable: 0/8 red and 2/8 yellow 90-day windows; none of the evaluable windows was out of control.
- API test windows: 3/186 (1.6%), below the 10% threshold.
- Detection: the 11368 closure scenario detects multipliers ×1.6, ×1.25, and ×1.15 (all Act now) at H-19 volume. A +2% per week drift is not detected.

### 4.7. Known-answer and degenerate-case checks

Each check below is covered by a test and was re-run with `app/qc.py` on Oct 17:

- **Wilson interval:** 85/100 → `[0.76716, 0.90694]`. At 300 calls and a 90% goal: 285 on time → `[0.91915, 0.96947]` Meets; 255 → `[0.80518, 0.88597]` Below; 270 → `[0.86083, 0.92905]` Inconclusive. 0/20 is Inconclusive (insufficient data), not Below; 29/29 is Inconclusive, not Meets.
- **p chart:** five days of `n = 20`, baseline `p̄ = 0.20`: UCL 0.4683, LCL 0. With late counts 2, 3, 1, 4, **12**, day 5 has `p = 0.60` and exact p-value `1.017e-4 < 0.00135/5 = 2.7e-4`, so one strong signal gives Out of control. With final count **10**, `p = 0.50` is above UCL but p-value `0.002595 ≥ 0.00135`, so it is not a signal and is In control (no watch). With `p̄ = 0.10`, UCLs are 0.3846 (`n = 10`), 0.19 (LCL 0.01; `n = 100`), and 0.12846 (`n = 1000`).
- **Baseline screen:** ten days with `n = 100`, late counts 20 × 9 and 40: the 40 day (tail `3.8e-5`) is dropped; `p̄ = 0.20`, stable. Counts 20 × 8 and 45, 45: 2/10 dropped (>10%), unstable. Counts 23 × 8 then 17 × 2: eight consecutive above `p̄ = 0.218`, unstable. Alternating 12 and 30: chi-square/df 5.425, overdispersed and unstable. Three subgroups: not checked.
- **Dispersion:** four subgroups with `n = 100`, late counts 0, 20, 0, 20 → chi-square 44.44, df 3, ratio 14.81; overdispersed.
- **`chance_below`:** one place, `n = 30`, goal 90% → 0.025827 (`Below` for at most 23 on-time calls; `P(X ≤ 23 | 30, 0.9)`).
- **`excess_late`:** 200 valid, 30 late, goal 90% → 10 excess late calls (the goal allows 20).
- **Queue labels:** all nine combinations of service-goal and control judgments are tested.
- **Percentiles:** values 1…20 → median 10.5, 95% CI `[6, 15]`; P90 18.1; P95 19.05, CI `[17, n/a]` (the upper bound needs 59 calls).
- **Secondary methods:** I chart values 1.0, 1.2, 0.9, 1.1, 1.3 → CL 1.1, UCL 1.6984, LCL 0.5016. Cpk (target 8 min) 1.6368, bound 2.8803. ANOM groups A/B/C → `h = 2.9333`, `F = 26.0`.
- **Stage medians:** dispatch values 10, 20, 30, missing → median 20; 1 of 3 known calls held → 33.3%.

Degenerate cases include `n = 0`, `n = 1`, constant data, `p̄ = 0` or `1`, no baseline, and too few baseline subgroups. Each returns `None` or an explicit Inconclusive / Insufficient baseline / not checked result with a message—never infinity or a passing status.

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
- **What the user sees** (one page; the "How it works" guide says the data is simulated; "Simulation / Replay"): filters (dataset, urgency, explicit From and To dates; blank or incomplete dates show No date selected across all sections with no analysis requests; no time-of-day), a replay bar (requires both dates and starts at the selected From date, ending at the selected To date or dataset end; fixed baseline; one simulated day every 3 s; shows that day's calls read-only), summary (places needing review split into recent signal and ongoing gap, with the number expected Below by chance; counts by queue label; on-time k of n with CI against the goal; median and P95 with intervals; very-late count; calls, cancelled, invalid, cancel %, calls per day); (1) state → county → ZCTA map with a back button, coloured by map group (Critical / Watch / Near goal / Stable, gray only under 30 valid calls; see section 10) or by late share with the Status / Late % switch, and a table ranked by label then excess late calls, with n, on-time rate + CI, Target and Control badges (plus a watch chip), queue label, excess late, P95 + CI, volume, baseline stability, and secondary Cpk; (2) the p chart with the screened baseline window, signal evidence (exact p-values), the dispersion check, the calls behind a signal, a descriptive stage-median table (period vs baseline, % held); (3) an investigation list of flagged areas with their target and control evidence, and a statewide list of flagged ZIP areas; (4) a geographic comparison histogram of area on-time rates, with selected-area median, P90, configured target, sample size and the existing Wilson target judgment; ANOM remains available through the API. The footer states the response-clock-start caveat and that the targets are NFPA 1720-based placeholders.
- **Documentation:** a top-bar button beside **How it works** opens a separate dashboard reference with a table of contents and full-text section search. It explains the tool and audience, a step-by-step workflow, filters and replay, metric and judgment meanings, data provenance and fields, statistical methods and assumptions, limitations, and links to the API documentation and data codebook. It preserves the dashboard state when closed and is keyboard accessible.

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
- **Decided by the team after the brief (Oct 16, superseded for targets by H-13 below):** red target flat 480 s (the brief's placeholder) instead of the history-based tiers of H-10, because tiers made the on-time check circular (60 of 62 counties Inconclusive on the baseline file); default window 90 days (counties under 30 red calls drop from 23 to 2); a place confirmed Below goal but with Insufficient baseline is queued "Needs more data" and sorted first, as the brief's table says.
- **H-13 (Oct 16-17, after a four-part robustness review):**
  - **Targets (team policy decision):** red tiered by area type, adapted from NFPA 1720 demand zones as illustrative placeholders: urban 480 s, suburban 600, rural 840, remote 840 (NFPA gives no remote value; rural reused, flagged); yellow 900, green 1800; goal 90%. Unlike the H-10 history tiers this is not circular (targets do not come from the data). `--flat` and `--from-history` remain.
  - **Control rule:** exact binomial point p-values (signal = above the UCL and p < 0.00135); out of control needs 2 signals or one with p < 0.00135 / m, else in control with a watch chip; a Phase I baseline screen (drop unusual periods once; unstable baselines give Insufficient baseline; fewer than 4 periods are not checked). Measured false alarms on the clean file after H-13: 0 of 186 county-windows (red) and 1 of 186 (yellow), three 90-day windows; re-measured after H-17: 2 of 186 and 2 of 186; after H-19 (below): 2 of 186 and 3 of 186. The planted 11368 and Monroe stories are detected (README section 7).
  - **Percentile intervals:** exact order-statistic intervals at every n replace the bootstrap; bounds can be n/a.
  - **Supervisor data:** `chance_below` beside the Below count, `excess_late` ranking, cancelled / invalid / cancel % / calls per day, baseline stability on each card, a statewide flagged-ZIP list (`/api/flagged`), the calls behind a signal (`/api/signal_calls`), data-quality counts in `/api/health`; messy input is dropped and counted, never raised.
  - **Stage medians restored, descriptively:** `/api/stages` and `qc.stage_summary` give plain medians of each stage and % held, period vs baseline, with no excess, ranking or cause. This partly restores the brief's "inspect abnormal timing stages"; its AT-6 (stage excess) and AT-7 (Google comparison) stay overridden.
  - **Wording:** "Meets goal; statistically stable" became "Meets goal; no change signal"; Cpk's sigma is described as overall (Ppk-like); ANOM is compared with the call-weighted average, with a geography note.
  - **Data:** day-to-day county effects, winter/summer seasonality, hour-of-day profile, congestion, a messy sample file and `data/sensitivity.py` (data/README.md).
- **H-17 (Oct 17, user decision; the rate was raised again in H-19 below): synthetic volume doubled and files xz-compressed.** The generator's call rate went from 0.0198 to 0.04 calls per person per year (about 800,000 calls per file instead of 400,000; about one-quarter to one-third of a typical US rate of ~0.13-0.15 instead of one-eighth). No other generator parameter changed, so the planted stories and their effect sizes are the same. Why: at one-eighth of real volume a single ZIP had too few calls for anything but a very large change to be seen (11368 had 68 valid red calls in Sep 1-Oct 15). To keep each file under 25 MB the incident files are now xz-compressed CSV (`data/incidents_{baseline,station_closure,summer_surge,messy_sample}.csv.xz`, preset 9; the three main files are about 10 MB each, the messy sample 82 KB; they were `.csv.gz` before). Two behaviour changes, both measured: (1) **smaller changes are now detected**: the x1.15 and x1.25 variants of 11368 are out of control (x1.25 Act now from Sep 9; x1.15 Recent change from Sep 15), the planted x1.6 is out of control every replay day from Sep 3 with no blip, and the +2%/week drift is still missed; (2) **Monroe Sep 1-Oct 15 on `summer_surge` now reads Insufficient baseline** (Meets goal, 95.0%; its 60-day baseline Jul 3-Aug 31 is the surge, overdispersed, chi-square / df 1.68) instead of in control. Clean-file false alarms: 2 of 186 county-windows (red, 1.1%), within the 10% test limit. Synthetic times are still faster than published benchmarks (urban red median about 4.7 min). Verified: `validate.py` 71 PASS, `--reproduce` 75, `--messy` 14; pytest 181 passed.
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

## Sparse ZIP response trends (H-11 follow-up, user approved Oct 17)

<<<<<<< Updated upstream
When a ZIP's baseline is insufficient, show its observed late-call rate, late-call count, and pointwise 95% Wilson interval for each selected period under the status “Descriptive—limited baseline.” Do not show control limits, flagged periods, or statistical change signals for this view. Keep county p charts and their statistical change signals unchanged; a county result describes the county process and is not evidence about any individual ZIP. The intervals describe per-period binomial uncertainty and do not create missing history or justify a ZIP control claim.

## Target vs goal wording and the "How it works" guide (H-27, user approved Oct 17)

- **Target** = the time limit for one call (`target_s` by urgency and area type: urgency 1 = 8 / 10 / 14 / 14 min for
  urban / suburban / rural / remote, urgency 2 = 15 min, urgency 3 = 30 min); a call that misses it is late. **Goal** = the
  share of calls that should be within their target (90%). The specification judgment compares the on-time rate with the
  goal, so it is labelled **Meets goal / Below goal / Inconclusive** (it was "Meets / Below target"). The API codes
  (`spec: meets / below / inconclusive`) and every number are unchanged; "target" is kept only where it means the minutes.
- The top bar's "i" tooltip is replaced by a **How it works** button that opens a four-page guide, also shown once on
  the first visit: (1) target vs goal with the target table read from `/api/meta` (`targets`), urgency shown as numbers
  1 / 2 / 3, with a footnote that remote reuses the rural time (NFPA 1720 has no fixed remote time); (2) the five map
  colours; (3) the Investigate table's labels in ranking order, one plain line each, plus the "watch" tag (one
  unconfirmed high period; it changes no label, rank or colour); (4) how to use the page plus the caveats (simulated data, provisional `t_received`, placeholder targets). The
  page itself gains no extra text.
=======
When a ZIP's baseline is insufficient, label the view with its ZIP code and “observed trend”, show the late-call rate/count for the user's full selected date range, and plot period rates with simple uncertainty whiskers. A call is late when elapsed time from call receipt (`t_received`) to on-scene arrival (`t_onscene`) exceeds that call's configured response target (`target_s`). This measures a late arrival; it does not mean an ambulance failed to reach its designated area. Calculate the rate only from valid completed calls, and show the count over that denominator. An Evidence button opens a concise selected-period count/rate and definition. Keep the legend and Evidence button visible without an internally scrollable card. Give both axes labels; omit the long warning banner, per-week selector and statistical interval jargon from the card. Do not show control limits, flagged periods, or statistical change signals for this view. Keep county p charts and their statistical change signals unchanged; a county result describes the county process and is not evidence about any individual ZIP. The intervals describe per-period binomial uncertainty and do not create missing history or justify a ZIP control claim.
>>>>>>> Stashed changes
