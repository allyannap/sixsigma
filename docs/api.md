# API and function contract (the seams between roles)

Two seams: **A** = `app/qc.py` functions (Stats writes, Data calls) and **B** = `/api/*` JSON (Data serves, UI reads).
Change a seam only with both roles agreeing; then update this file in the same commit.
Requirements: [`EMS_RESPONSE_MONITOR_DECISIONS.md`](../EMS_RESPONSE_MONITOR_DECISIONS.md) (approved Oct 16, 2026).

**Read-only.** Every route is a `GET` over the three synthetic files. There is no incident-entry route
(`POST /api/calls` was removed), no what-if route (`/api/whatif` was removed), and no live CAD feed.

## Shared definitions (Data computes these in `app/data.py`, SPEC §4)

- Per call: `dispatch_s = t_assigned − t_received` (received → assigned), `turnout_s = t_enroute − t_assigned`
  (assigned → en route), `drive_s = t_onscene − t_enroute` (en route → on scene), `total_s = t_onscene − t_received`
  (= the sum of the three), `dispatch_to_scene_s = t_onscene − t_assigned`, `vs_google_s = drive_s − eta_google_s`,
  `minutes = total_s / 60`, `ln_min = ln(minutes)`; the call's area type (`urban_rural`) from `data/lookup/zcta_county.csv`;
  `urgency_group`, `target_s`, `goal_on_time_pct` from `config/targets.csv` by **(urgency_code, area type)**;
  `late = total_s > target_s`; `very_late = total_s > 2 × target_s`; `date` = `t_received` in America/New_York.
  **`t_received` semantics are provisional** (911 call receipt vs EMS CAD incident creation is not yet confirmed; SPEC §3).
- **Valid (timed) call** = `disposition != CANCELLED`, `t_onscene` present, `valid_time == Y`, and the four times in order.
  Cancelled, invalid, missing and out-of-order rows count in `calls` only, never in any time statistic.
- **Selection** = calls in [`from`, `to`] (inclusive dates), in the chosen `urgency` groups, inside the place.
- **Baseline** = the same place and urgency, the `baseline_days` (default 60) days **before** `from` (never overlapping it);
  if under 30 valid calls, stretched to 120 days; if still under 30, `enough = false`.
- Places: `level=state` → children are the 62 counties; `level=county&id=<fips>` → its ZCTAs; `level=zcta&id=<zcta>` → itself.

## A. `app/qc.py` (pure functions: numbers and lists in, plain dicts out; no FastAPI, no file reading)

Every function returns a dict with a `messages` list. Never inf or NaN: `None` plus a message.

| Function | Inputs | Returns (keys) |
|---|---|---|
| `wilson_ci(k, n)` | successes, trials | `[lo, hi]` 95% Wilson interval (`[None, None]` if n = 0) |
| `on_time(n_valid, n_on_time, goal_pct, min_n=30)` | counts, goal % | **A. spec**: `n_valid, n_on_time, n_late, on_time_rate, late_rate, ci, goal, status (meets/below/inconclusive), reason` |
| `spec_from_interval(lo, hi, goal)` | interval, goal fraction | `meets` if lo ≥ goal, `below` if hi < goal, else `inconclusive` |
| `subgroup_unit(base_calls_per_day, p_bar)` | baseline valid calls per day, baseline p̄ | shortest of `day`, `week`, `month` with calls × days × p̄ ≥ 5, else `None` |
| `p_chart(n, late, base_n, base_late)` | per-subgroup counts; baseline totals | `p_bar, points[{n, late, p, ucl, lcl, signal}], run_signal` |
| `control_status(points, p_bar, baseline_enough, unit)` | p-chart points (with `start`), baseline facts | **B. control**: `status (in_control/out_of_control/insufficient_baseline), reason, signals[], improvements[]` |
| `dispersion_check(n, late)` | baseline subgroup counts | `chi2, df, ratio, p_value, overdispersed` (binomial assumption) |
| `queue_label(spec, control)` | the two statuses | **C.** one of `act_now, ongoing_gap, recent_change, meets_stable, needs_data` |
| `p95_boot(values)` | minutes | `median, median_ci, p90, p95, ci (P95), spread, n` (bootstrap ≤ 5,000, order statistics above) |
| `stage_excess(late_calls, base_calls)` | dicts with `dispatch_s, turnout_s, drive_s[, held]` | `base_median{}, late_mean{}, mean_excess{}, total{late_mean, base_median_sum, excess}, counts{stage..., none}, per_call[], top_stage, held` |
| `travel_vs_estimate(diff_s, base_diff_s)` | `drive_s − eta_google_s`, now and baseline | `median_s, pct_slower, pct_faster, threshold_s (baseline P95), n_unusual, pct_unusual` |
| `imr(x, base_x)`, `nelson_tests(z)` | ln-minutes | secondary I-MR; only test 1 is used by the API |
| `assumption_checks(x)` | ln-minutes | `skew, lag1` with warnings |
| `capability(x, usl, goal_pct)` | `ln(total_s / target_s)`, USL 0 | **secondary** Cpk and Bissell bound; never sets a status |
| `anom(groups)` | `{place: [ln-minutes]}` | secondary, descriptive ANOM + ANOVA F |

## B. HTTP endpoints (all `GET`; FastAPI also serves `app/frontend/dist/` at `/`)

Common query parameters: `dataset` (`baseline` | `station_closure` | `summer_surge`, default `baseline`),
`from`, `to` (YYYY-MM-DD; default **the dataset's last 90 days, Jul 18 – Oct 15, 2026**), `urgency` (comma list of
`red,yellow,green`; default `red`), `level` (`state` | `county` | `zcta`; default `state`), `id`, `baseline_days` (default 60).
No time-of-day parameter exists. Every response echoes
`selection{dataset, source, level, id, name, from, to, urgency, baseline_from, baseline_to, baseline_days}` and has `messages[]`.
`source` is always `"Synthetic - simulated replay"`. Percents are 0–100 with 1 decimal; p-chart values are fractions 0–1.

A **place card** (in `/api/summary` as `place` and each `places[]` row) has:
`calls, valid, on_time, late, on_time_pct, on_time_ci[], goal_pct, spec, spec_reason, very_late,
control, control_reason, unit, signals[{start, n, late, p, ucl, lcl}], baseline{from, to, days, valid, stretched, enough},
queue, median_min, p95_min, p95_ci[], cpk, cpk_upper (secondary), top_stage`.

| Endpoint | Card | Response body (besides `selection`, `messages`) |
|---|---|---|
| `GET /api/health` | – | `{status, source, datasets[], rows{dataset: n}}` |
| `GET /api/meta` | filters | `{source, datasets[], date_min, date_max, default_from, default_to, counties[], targets[]}` |
| `GET /api/summary` | 1, 4 | `totals{calls, valid, on_time, late, on_time_pct, on_time_ci, goal_pct, spec, very_late, median_min, median_ci, p90_min, p95_min, p95_ci, spread_min, median_dispatch_to_scene_min, p95_dispatch_to_scene_min, p95_dispatch_to_scene_ci}, place{card}, queue_counts{label: n}, needs_attention (act_now + ongoing_gap + recent_change), places[{id, name, ...card}], calls_by_county[]` |
| `GET /api/pchart` | 2 | `{unit, p_bar, base_n, base_late, baseline{}, points[{start, n, late, p, ucl, lcl, signal}], run_signal, control, control_reason, signals[], improvements[], dispersion{m, ratio, p_value, overdispersed}}` |
| `GET /api/imr` | 2 (optional) | `{cl_min, ucl_min, lcl_min, mr_ucl, points[{incident_id, t_received, minutes, ln_min, mr, beyond_3_sigma}], n_beyond, assumptions{n, skew, lag1}, before_median_min, after_median_min}` |
| `GET /api/delays` | 3 | `{late_calls, base_median{stage}, late_mean{stage}, mean_excess{stage}, total{late_mean, base_median_sum, excess}, counts{dispatch_s, turnout_s, drive_s, none}, top_stage, held (null = not recorded), worst_call{incident_id, t_received, held, total_s, dispatch_s, turnout_s, drive_s, excess{}}}` (seconds) |
| `GET /api/google` | 3 | `{available, provenance, now{eta_med_s, drive_med_s}, baseline{...}, diff{n, median_s, pct_slower, pct_faster, base_median_s, threshold_s, n_unusual, pct_unusual}, hist{edges_s[], now[], baseline[]}}`; `available: false` → "comparison unavailable" |
| `GET /api/replay?day=&limit=` | replay | `{source, day, received, valid, late, cancelled, events[{incident_id, t_received, zcta, county, urgency_group, disposition, valid, total_s, late, held}]}` (newest first; read-only). The page's replay calls the other routes with a **fixed** `from` (so a fixed baseline) and `to` = the simulated day |
| `GET /api/anom` | 5 | `{grand_mean_min, h, k, N, F, df1, df2, places[{id, name, n, mean_min, ci_min[], lower_min, upper_min, verdict}]}`; empty with a message unless exactly one urgency group is selected |
| `GET /geo/ny_counties.geojson`, `GET /geo/ny_zcta.geojson` | 1 | static map shapes |

Errors: unknown `dataset`, `level`, `id`, `urgency` or bad dates → HTTP 400 `{detail}`; empty selection → 200 with zero
counts and `needs_data`, never a 500. Any non-GET method → 404/405.
