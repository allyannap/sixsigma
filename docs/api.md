# API and function contract (the seams between roles)

Two seams: **A** = `app/qc.py` functions (Stats writes, Data calls) and **B** = `/api/*` JSON (Data serves, UI reads).
Change a seam only with both roles agreeing; then update this file in the same commit.

## Shared definitions (Data computes these in `app/data.py`, SPEC §4)

- Per call: `dispatch_s = t_assigned − t_received`, `turnout_s = t_enroute − t_assigned`, `drive_s = t_onscene − t_enroute`,
  `dispatch_to_scene_s = t_onscene − t_assigned`, `total_s = t_onscene − t_received`, `vs_google_s = drive_s − eta_google_s`,
  `minutes = total_s / 60`, `ln_min = ln(minutes)`; the call's **area type** (`urban_rural`: urban, suburban, rural, remote, from its ZCTA in
  `data/lookup/zcta_county.csv`); `urgency_group`, `target_s`, `goal_on_time_pct` from `config/targets.csv`, looked up by
  **(urgency_code, area type)**; `late = total_s > target_s`; `very_late = total_s > 2 x target_s`;
  `ln_ratio = ln(total_s / target_s)` for timed calls (NaN otherwise; above 0 means late); `date` = `t_received` in America/New_York; `county_fips` from `data/lookup/zcta_county.csv`.
- **Timed call** = `disposition != CANCELLED` and `t_onscene` present and `valid_time == Y`. Untimed calls count in `calls` only.
- **Selection** = calls in [`from`, `to`] (inclusive dates), in the chosen `urgency` groups, inside the place.
- **Baseline** = the same place and urgency, the `baseline_days` (default 60) days before `from`; if under 30 timed calls,
  stretch to 120 days; if still under 30, the place is `not_enough`.
- Places: `level=state` → children are the 62 counties; `level=county&id=<fips>` → children are its ZCTAs;
  `level=zcta&id=<zcta>` → the ZCTA itself.

## A. `app/qc.py` (pure functions: numbers and lists in, plain dicts out; no FastAPI, no file reading)

Every function returns a dict with a `messages` list (plain-English warnings, e.g. "no variation: Cpk undefined").
Never return inf; return `None` plus a message.

| Function | Inputs | Returns (keys) |
|---|---|---|
| `p_chart(n, late, base_n, base_late)` | per-subgroup lists of calls and late calls in the selection; baseline totals | `p_bar, points[{n, late, p, ucl, lcl, signal}], run_signal, messages` (fractions 0-1; display only) |
| `subgroup_unit(base_calls_per_day, p_bar)` | mean timed calls per day in the baseline; baseline p-bar | shortest of `"day"`, `"week"`, `"month"` with calls x days x p-bar ≥ 5, else `None` (low volume) |
| `imr(x, base_x)` | ln-minute values in time order for the selection and the baseline | `cl, ucl, lcl, sigma, mr_bar, mr_ucl, points[{x, mr, tests[]}], tests[{id, rule, alert, fired}], messages` |
| `capability(x, usl, goal_pct, sigma=None)` | `x = ln_ratio` values (each call against its own target); `usl = 0`; goal % = mean `goal_on_time_pct` of the selected timed calls; optional sigma from `imr` | `cpk, upper, bar, n, too_slow, messages` |
| `p95_boot(values, n_boot=2000, seed=0)` | minutes | `p95, median, spread, ci[lo, hi], messages` (order-statistic CI above n = 5,000) |
| `anom(groups, alpha=0.05)` | `{place_id: [ln-minute values]}` | `grand_mean, sigma_p, h, k, N, F, df1, df2, groups{id: {n, mean, ci[lo,hi], lower, upper, verdict}}, messages` |
| `changed_recently(sel_x, base_x, sel_late, sel_n, base_late, base_n)` | ln-minute lists (time order) and late/total counts for selection and baseline | `changed, z_loc, z_p, reasons[], messages` (SPEC §4: either Z > 3, n ≥ 30 each) |
| `status(too_slow, changed, n_sel, n_base)` | booleans and timed calls in selection and baseline | one of `act_now, recent_change, ongoing_gap, on_track, not_enough` (under 30 in either) |
| `fault_tree(late_calls, base_calls)` | late calls and baseline calls, each a list of dicts with `dispatch_s, turnout_s, eta_google_s, drive_s, held` | `counts{held, dispatch, turnout, long_trip, slow_drive, typical_late}, per_call[cause], base{step: {median, sd_ln}}, messages` (standardized excess, SPEC §4.6) |
| `whatif(calls, fix, pct, base_dispatch_nonheld_median)` | list of dicts with the step times, `held`, `target_s`; `fix` in `closer, add_ambulance, center_faster, crew_faster`; pct 0-100 | `now{late, pct_late, p95_min}, with_fix{late, pct_late, p95_min}, avoided, messages` |

## B. HTTP endpoints (Data serves under `/api`; FastAPI also serves `app/frontend/dist/` at `/`)

Common query parameters on every GET below: `dataset` (`baseline` | `station_closure` | `summer_surge`, default `baseline`),
`from`, `to` (YYYY-MM-DD; default the dataset's last 30 days, Sep 16 – Oct 15, 2026), `urgency` (comma list of
`red,yellow,green`; default `red`), `level` (`state` | `county` | `zcta`; default `state`), `id` (FIPS or ZCTA), `baseline_days` (default 60).
Every response echoes `selection{dataset, level, id, name, from, to, urgency, baseline_from, baseline_to}` and has `messages[]`.
Times in minutes are rounded to 2 decimals; percents are 0-100 with 1 decimal.
`goal_pct` is the call-weighted **on-time** goal of the selected timed calls (90 means at most 10% late). Very-late and late percentages use **timed** calls as the base.
When `/api/pchart` returns `unit: null`, `p_bar` is still the baseline value and `points` is an empty list.
`reasons[]` strings read like "time: Z = 7.4 > 3" or "share late: Z = 4.1 > 3".

| Endpoint | Card | Response body (besides `selection`, `messages`) |
|---|---|---|
| `GET /api/health` | – | `{status: "ok", datasets: [...], rows: {dataset: n}}` |
| `GET /api/meta` | filters | `{datasets[], date_min, date_max, counties[{county_fips, county_name}], targets[{urgency_code, urban_rural, urgency_group, target_s, goal_on_time_pct, reference_p90_s, n_reference}]}` (40 rows: 10 codes x 4 area types; the last two are null except for red) |
| `GET /api/summary` | 1-4 | `totals{calls, timed, late, very_late, pct_late, median_min, median_dispatch_to_scene_min, p95_min, p95_ci[], p95_dispatch_to_scene_min, p95_dispatch_to_scene_ci[], spread_min, goal_pct}, needs_attention (int: act_now + recent_change + ongoing_gap), places[{id, name, calls, timed, late, very_late, pct_late, p95_min, p95_ci[], spread_min, cpk, cpk_upper, too_slow, z_loc, z_p, changed, reasons[], status}], urgent_by_county[{county_fips, name, calls}]` |
| `GET /api/anom` | 2 | `{grand_mean_min, h, k, N, F, df1, df2, places[{id, name, n, mean_min, ci_min[], lower_min, upper_min, verdict}]}` (`verdict` in `slower, faster, inside`) |
| `GET /api/pchart` | 3 | `{unit: "day"|"week"|"month"|null, p_bar, base_n, points[{start, n, late, p, ucl, lcl, signal}], run_signal}` (p, p_bar, ucl, lcl are fractions 0-1; `unit` null = low volume, no marks) |
| `GET /api/imr` | 3 | `{cl_min, ucl_min, lcl_min, mr_ucl, points[{incident_id, t_received, minutes, ln_min, mr, tests[]}], tests[{id, rule, alert, fired}], before_median_min, after_median_min}` |
| `GET /api/delays` | 4 | `{late_calls, steps{now{dispatch_s, turnout_s, drive_s, total_s}, baseline{...}}, causes{held, dispatch, turnout, long_trip, slow_drive, typical_late}, worst_call{incident_id, t_received, dispatch_s, turnout_s, eta_google_s, drive_s, total_s}}` |
| `GET /api/google` | 4 | `{available, now{eta_med_s, drive_med_s}, baseline{eta_med_s, drive_med_s}, pct_slower_than_google, hist{edges_s[], now[], baseline[]}}` |
| `GET /api/whatif?fix=&pct=` | 5 | `{fix, pct, now{late, pct_late, p95_min}, with_fix{late, pct_late, p95_min}, avoided, n}` |
| `GET /geo/ny_counties.geojson`, `GET /geo/ny_zcta.geojson` | 1 | static files from `geo/` (properties: `GEOID`, `NAME`; ZCTAs also `county_fips`) |
| `POST /api/calls` | logging | body = one `incidents.csv` row as JSON; appends to an in-memory `live` dataset; returns `{ok, incident_id, rows}` |

Errors: unknown `dataset`, `level` or `id` → HTTP 400 `{detail}`; empty selection → 200 with zero counts and a message, never a 500.
