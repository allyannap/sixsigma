# API and function contract (the seams between roles)

Two seams: **A** = `app/qc.py` functions (Stats writes, Data calls) and **B** = `/api/*` JSON (Data serves, UI reads).
Change a seam only with both roles agreeing; then update this file in the same commit.
Requirements: [`EMS_RESPONSE_MONITOR_DECISIONS.md`](../EMS_RESPONSE_MONITOR_DECISIONS.md) (approved Oct 16, 2026), with the
team's later decisions in SPEC.md section 10 (H-12, H-13).

**Read-only.** Every route is a `GET` over the three synthetic files. There is no incident-entry route
(`POST /api/calls` was removed), no what-if route (`/api/whatif` was removed), and no live CAD feed. The stage-excess
breakdown (`/api/delays`, "What Held Up the Call") and the travel comparison (`/api/google`) were removed on Oct 16;
`/api/stages` (H-13) gives plain, descriptive stage medians instead.

## Shared definitions (Data computes these in `app/data.py`, SPEC §4)

- **Loading (never raises for bad values).** Rows are dropped and counted, under the first reason that applies:
  `duplicate_id` (a repeated `incident_id`; the first row is kept), `missing_t_received` (empty or unreadable),
  `unknown_zcta` (not in `data/lookup/zcta_county.csv`), `unknown_urgency_code` (not in `config/targets.csv`).
  A missing required column is still an error.
- Per call: `dispatch_s = t_assigned − t_received` (received → assigned), `turnout_s = t_enroute − t_assigned`
  (assigned → en route), `drive_s = t_onscene − t_enroute` (en route → on scene), `total_s = t_onscene − t_received`
  (= the sum of the three), `dispatch_to_scene_s = t_onscene − t_assigned`,
  `minutes = total_s / 60`, `ln_min = ln(minutes)`, `ln_ratio = ln(total_s / target_s)`; the call's area type
  (`urban_rural`: urban / suburban / rural / remote) from `data/lookup/zcta_county.csv`;
  `urgency_group`, `target_s`, `goal_on_time_pct` from `config/targets.csv` by **(urgency_code, area type)**
  (red 480 / 600 / 840 / 840 s by area type, yellow 900, green 1800, goal 90%: illustrative placeholders);
  `late = total_s > target_s`; `very_late = total_s > 2 × target_s`; `date` = `t_received` in America/New_York.
  **`t_received` semantics are provisional** (911 call receipt vs EMS CAD incident creation is not yet confirmed; SPEC §3).
- **Valid (timed) call** = `cancelled = N`, `t_onscene` present, `valid_time == Y`, and the four times in order.
  Cancelled, invalid, missing and out-of-order rows count in `calls` only, never in any time statistic.
  `invalid` on a card = calls − cancelled − valid.
- **Selection** = calls in [`from`, `to`] (inclusive dates), in the chosen `urgency` groups, inside the place.
- **Baseline** = the same place and urgency, the `baseline_days` (default 60) days **before** `from` (never overlapping it);
  if under 30 valid calls, stretched to 120 days; if still under 30, `enough = false`.
- **Control pipeline** (`main.control_card`): unit = `qc.subgroup_unit(baseline calls per day, raw p̄)`; the baseline is split
  into subgroups of that unit and screened by `qc.baseline_screen`; the p chart uses the **kept** baseline subgroups;
  `qc.control_status` judges it (an unstable screen gives `insufficient_baseline`).
- Places: `level=state` → children are the 62 counties; `level=county&id=<fips>` → its ZCTAs; `level=zcta&id=<zcta>` → itself.

## A. `app/qc.py` (pure functions: numbers and lists in, plain dicts out; no FastAPI, no file reading)

Every function returns a dict with a `messages` list (except `wilson_ci`, `spec_from_interval`, `subgroup_unit`,
`queue_label`, `excess_late`, which return a plain value). Never inf or NaN: `None` plus a message.
`ALPHA_POINT = 0.00135` is the exact signal level throughout.

| Function | Inputs | Returns (keys) |
|---|---|---|
| `wilson_ci(k, n)` | successes, trials | `[lo, hi]` 95% Wilson interval (`[None, None]` if n = 0) |
| `spec_from_interval(lo, hi, goal)` | interval, goal fraction | `meets` if lo ≥ goal, `below` if hi < goal, else `inconclusive` |
| `on_time(n_valid, n_on_time, goal_pct, min_n=30)` | counts, goal % | **A. spec**: `n_valid, n_on_time, n_late, on_time_rate, late_rate, ci, goal, status (meets/below/inconclusive), reason` |
| `chance_below(ns, goal_pct)` | valid calls per place, goal % | `expected` (places expected "below" by chance if every place with n ≥ 30 sat exactly at the goal), `n_places` |
| `excess_late(n_valid, n_late, goal_pct)` | counts, goal % | `n_late − (1 − g) n_valid` (late calls beyond what the goal allows; negative = fewer), `None` if n = 0 |
| `subgroup_unit(base_calls_per_day, p_bar)` | baseline valid calls per day, baseline p̄ | shortest of `day`, `week`, `month` with calls × days × p̄ ≥ 5, else `None` |
| `baseline_screen(n, late)` | baseline subgroup counts | Phase I: `p_bar` (after dropping), `n, late` (kept), `m, removed[]` (positions), `stable, checked, reasons[], dispersion{ratio, p_value, overdispersed}` |
| `p_chart(n, late, base_n, base_late)` | per-subgroup counts; baseline totals | `p_bar, points[{n, late, p, ucl, lcl, p_value, signal}], run_signal`; `signal` = p > UCL and exact p-value < 0.00135 |
| `control_status(points, p_bar, baseline_enough, unit, baseline=None)` | p-chart points (with `start`), baseline facts, the screen dict | **B. control**: `status (in_control/out_of_control/insufficient_baseline), reason, signals[], improvements[], watch, m`. Out of control = ≥ 2 signals or one with p < 0.00135 / m; one weaker signal = in control + `watch` |
| `dispersion_check(n, late, p_bar=None, alpha=0.01)` | subgroup counts | `m, chi2, df, ratio, p_value, overdispersed` (binomial assumption) |
| `queue_label(spec, control)` | the two statuses | **C.** one of `act_now, ongoing_gap, recent_change, meets_stable, needs_data` |
| `percentiles(values)` | minutes | `n, median, median_ci, p90, p95, p95_ci, spread`; exact order-statistic 95% intervals at every n, a bound is `None` when n is too small (median 6 calls, P95 upper 59) |
| `stage_summary(now, base)` | `{dispatch_s, turnout_s, drive_s, held}` lists for period and baseline | `now{dispatch_s, turnout_s, drive_s, held_pct, n}`, `base{...}`: plain medians, descriptive only |
| `imr(x, base_x)`, `nelson_tests(z)` | ln-minutes | secondary I-MR; only test 1 is used by the API |
| `assumption_checks(x)` | ln-minutes | `n, skew, lag1` with warnings |
| `capability(x, usl, goal_pct, sigma=None)` | `ln(total_s / target_s)`, USL 0 | **secondary** `cpk, upper` (Bissell), `bar`, `n`; sigma is an overall (Ppk-like) moving-range sigma; never sets a status |
| `anom(groups, alpha=0.05)` | `{place: [ln-minutes]}` | secondary, descriptive: `grand_mean` (call-weighted), `reference`, `sigma_p, h, k, N, F, df1, df2, groups{n, mean, ci, lower, upper, verdict (slower/inside/faster)}` |

## B. HTTP endpoints (all `GET`; FastAPI also serves `app/frontend/dist/` at `/`)

Common query parameters: `dataset` (`baseline` | `station_closure` | `summer_surge`, default `baseline`),
`from`, `to` (YYYY-MM-DD; default **the dataset's last 90 days, Jul 18 – Oct 15, 2026**), `urgency` (comma list of
`red,yellow,green`; default `red`), `level` (`state` | `county` | `zcta`; default `state`), `id`, `baseline_days` (default 60).
No time-of-day parameter exists. Every response except `/api/health` and `/api/meta` echoes
`selection{dataset, source, level, id, name, from, to, urgency, baseline_from, baseline_to, baseline_days}` and has `messages[]`.
`source` is always `"Synthetic - simulated replay"`. Percents are 0–100 with 1 decimal; p-chart values are fractions 0–1;
exact p-values have 3 significant figures.

A **place card** (in `/api/summary` as `place` and each `places[]` row) has:
`calls, valid, on_time, late, on_time_pct, on_time_ci[], goal_pct, spec, spec_reason,
control, control_reason, watch, unit, signals[{start, n, late, p, ucl, lcl, p_value}],
baseline{from, to, days, valid, stretched, enough, p_bar, checked, stable, reasons[], removed, removed_starts[], dispersion{ratio, p_value, overdispersed}},
queue, excess_late, very_late, cancelled, invalid, cancel_pct, calls_per_day, base_calls_per_day,
median_min, median_ci[], p90_min, p95_min, p95_ci[], cpk, cpk_upper (secondary, only with 30+ valid calls)`.
Any interval bound may be `null` (too few calls).

| Endpoint | Section | Response body (besides `selection`, `messages`) |
|---|---|---|
| `GET /api/health` | – | `{status, source, datasets[], rows{dataset: n}, quality{dataset: {rows_in, rows_kept, dropped_total, duplicate_id, missing_t_received, unknown_zcta, unknown_urgency_code, timed, cancelled, invalid_time_flag, missing_time, out_of_order}}}` |
| `GET /api/meta` | filters | `{source, datasets[], date_min, date_max, default_from, default_to, counties[], targets[]}` (40 target rows) |
| `GET /api/summary` | summary, 1 | `totals{calls, valid, on_time, late, on_time_pct, on_time_ci, goal_pct, spec, spec_reason, very_late, cancelled, invalid, cancel_pct, calls_per_day, base_calls_per_day, excess_late, median_min, median_ci, p90_min, p95_min, p95_ci, spread_min, median_dispatch_to_scene_min, p95_dispatch_to_scene_min, p95_dispatch_to_scene_ci}, place{card}, queue_counts{label: n}, needs_attention (act_now + ongoing_gap + recent_change), chance_below{expected, n_places, observed_below}, places[{id, name, ...card}], calls_by_county[]` |
| `GET /api/flagged` | 3 | **statewide** (level and id are ignored): `{scope: "statewide", n_checked (ZIPs with 30+ valid calls), n_flagged, flagged[{id, county_fips, county, calls, valid, on_time_pct, on_time_ci, goal_pct, spec, control, watch, queue, signals, excess_late}], chance_below{...} over the ZIPs checked}`; only `act_now` and `recent_change`, Act now first, then by excess late |
| `GET /api/pchart` | 2 | `{unit, p_bar, base_n, base_late (kept baseline), baseline{...as on the card}, points[{start, n, late, p, ucl, lcl, p_value, signal}], run_signal, control, control_reason, watch, signals[], improvements[], dispersion{m, ratio, p_value, overdispersed} or null}` |
| `GET /api/stages` | 2 | `{now{dispatch_s, turnout_s, drive_s, held_pct, n}, base{...}}`: medians in seconds, period vs baseline; descriptive only |
| `GET /api/signal_calls?start=&end=&limit=` | 2 | the valid calls of the selected place and urgency received in [`start`, `end`] (default the selection; `limit` 1–500, default 50), newest first: `{start, end, valid, late, returned, calls[{incident_id, t_received, zcta, total_s, late, dispatch_s, turnout_s, drive_s, held}]}` |
| `GET /api/imr` | 2 (optional) | `{cl_min, ucl_min, lcl_min, mr_ucl, points[{incident_id, t_received, minutes, ln_min, mr, beyond_3_sigma}], n_beyond, assumptions{n, skew, lag1}, before_median_min, after_median_min}` |
| `GET /api/replay?day=&limit=` | replay | `{source, day, received, valid, late, cancelled, events[{incident_id, t_received, zcta, county, urgency_group, cancelled, valid, total_s, late, held}]}` (newest first; read-only). The page's replay calls the other routes with a **fixed** `from` (so a fixed baseline) and `to` = the simulated day |
| `GET /api/anom` | 4 | `{grand_mean_min, reference ("call-weighted mean of the places"), h, k, N, F, df1, df2, places[{id, name, n, mean_min, ci_min[], lower_min, upper_min, verdict}]}`; places with under 30 valid calls are left out; empty with a message unless exactly one urgency group is selected |
| `GET /geo/ny_counties.geojson`, `GET /geo/ny_zcta.geojson` | 1 | static map shapes |

Errors: unknown `dataset`, `level`, `id`, `urgency` or bad dates → HTTP 400 `{detail}`; empty selection → 200 with zero
counts and `needs_data`, never a 500. Any non-GET method → 404/405. If `app/qc.py` cannot be imported, the statistics
routes answer 503 while `/api/health` and `/api/meta` still work.

## Geographic response profile (H-11 follow-up)

Each `/api/summary` place (and its `place` card) additionally contains
`response_profile`: `n`, `median_min`, `p90_min`, `max_min`, `over_target_pct`,
`target_min`, `low_n`, `messages`. Durations are minutes; late share is 0–100.
`qc.response_profile(minutes, targets_min)` excludes missing/nonfinite/nonpositive
input pairs, uses linear-interpolated quantiles and strictly `time > target`.
Empty samples have null numeric summaries; `target_min` is null when targets vary
or no valid calls exist. `low_n` means fewer than 30 valid calls. These fields
are descriptive; existing `spec`, `control` and `queue` remain authoritative.
The frontend reuses this response during replay and removes its separate ANOM
request. `/api/anom` remains available for API consumers.

## AI interpretation — H-16

`GET /api/ai_summary` accepts the same selection filters as `/api/summary`, but **requires explicit From and To dates**. It computes the selected area's `place_card` and submits aggregate statistics/judgments plus the inclusive selection and baseline context to Ollama Cloud. It does not change statistical classifications.

Response: `selection`, `messages`, `text`, `status` (`ok` or `no_data`), `provider`, `model`, `cached`. Missing/incomplete/invalid dates return 400; missing credentials, provider rejection, rate limit, timeout, malformed or truncated response return 503 with a sanitized explanation. No-data selections return 200 without contacting the provider. Cache keys include all evidence, model, prompt and credential; cache TTL 600 seconds, maximum 128 entries. No browser key or raw incident records. AI prose must be checked against the chart evidence.

H-16 briefing refinement: aggregate evidence now includes `place.very_late`, `place.excess_late`, `stages` (the existing route's period/baseline stage medians), and `geography` (queue counts, chance-Below reference, review count and top three ranked child areas). At state scope, `geography.statewide_zip_signals` contains the existing statewide signal count and up to three ZIP rows; it is excluded from county/ZIP briefs. Top-child ordering matches the map table (queue, confirmed below target, excess late descending); confirmed below-target children with insufficient baseline remain eligible but are not called recent deterioration. All values come from existing QC routes; no new statistical formulas or classifications. Six invented teaching examples accompany the system prompt, and the whole message sequence participates in cache invalidation.
