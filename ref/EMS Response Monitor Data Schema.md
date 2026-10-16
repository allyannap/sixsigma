# EMS Response Monitor: Data Schema

Oct 16, 2026 · @Allyanna

## Overview

One table of calls, `incidents.csv`, feeds all 9 features. Every card is the same query on that table, filtered three ways: **date range**, **urgency** (red, yellow, green), and **place** (all of New York State, one county, or one ZIP code).

- **Level 1, State:** the map shows New York's 62 counties. The summary card shows statewide totals and urgent calls by county.
- **Level 2, County:** clicking a county zooms in and draws its ZIP code areas. Clicking a ZIP code updates the summary card and cards 5 to 9 for that ZIP. A back arrow returns to the county view.
- Nothing is pre-calculated and stored. The API computes every number from `incidents.csv` at request time, so changing the date range or priority updates every card the same way.

&#91;embedded content: data flow · 4 file groups, 1 API, 9 features\]

The rest of this doc lists the files, every column, what each feature needs, and the statistical rules. I read "country" in the feature list as **county**.

## Decisions

The team settled all five on Oct 16, 2026. Time of day ("shift") is dropped: every filter and chart works by date.

| # | Question | Decision |
| --- | --- | --- |
| 1 | What do red, yellow and green mean? | The call's urgency, using the center's own codes: 0 = most urgent, 9 = least. The center maps codes to colors in `targets.csv`. Places that need attention get a flag marker on the map (see Statistical rules). |
| 2 | ZIP code shapes | Census ZCTAs, each assigned to the county holding most of its population. |
| 3 | Too few calls | Fewer than 30 calls in the selection: shaded gray, and hovering shows "Not enough calls (<30 calls)". |
| 4 | Data size | Synthetic volume at a fixed fraction of a realistic rate, stated in the README. |
| 5 | What "normal" means | Baseline = the 60 days before the selected range, which the analyst can override. The synthetic data follows yearly patterns, with a summer peak in June to August. |

## Files at a glance

Six files: one of calls, three small lookups, and two map shapes.

| File | One row is | Rows (approx.) | Used by features |
| --- | --- | --- | --- |
| `data/incidents_<dataset>.csv` | one 911 EMS call | 100,000–150,000 per dataset (12 months) | all 9 |
| `data/zcta_county.csv` | one ZIP code area (ZCTA) | \~1,800 | 1–4, data generator |
| `data/counties.csv` | one county | 62 | 1, 2 |
| `config/targets.csv` | one urgency code | 10 | colors, late flag, capability bar |
| `geo/ny_counties.geojson` | one county shape | 62 | map level 1 |
| `geo/ny_zcta.geojson` | one ZIP code shape | \~1,800 | map level 2 |

The shapes come from the Census Bureau's cartographic boundary files, simplified (for example with mapshaper) so both files load quickly in the browser.

## incidents.csv

One row per 911 EMS call. Columns follow NYC's public [EMS Incident Dispatch Data](https://data.cityofnewyork.us/Public-Safety/EMS-Incident-Dispatch-Data/76xm-jjuj) where one exists, so the codebook can show how to collect each field for real. Times are ISO 8601 with the New York offset; durations are whole seconds.

| Column | Required? | Type | Example | Meaning | Real-world source (NYC field) |
| --- | --- | --- | --- | --- | --- |
| `incident_id` | yes | text, unique | `NY26-0004471` | One call | `incident_id` |
| `zcta` | yes | text, 5 digits | `14612` | ZIP code area where the patient was | `zipcode` |
| `urgency_code` | yes | integer 0–9 | `1` | Center's urgency code when the call was created; 0 = most urgent | `initial_severity_level_code` (NYC uses 1–8; each center maps its own scale in `targets.csv`) |
| `t_received` | yes | datetime | `2026-10-11T22:14:05-04:00` | Call created in dispatch system | `incident_datetime` |
| `t_assigned` | yes | datetime | `2026-10-11T22:15:15-04:00` | First ambulance assigned | `first_assignment_datetime` |
| `t_enroute` | yes | datetime | `2026-10-11T22:16:49-04:00` | First ambulance rolling | `first_activation_datetime` |
| `t_onscene` | yes, can be empty | datetime | `2026-10-11T22:38:41-04:00` | First ambulance on scene; empty if cancelled | `first_on_scene_datetime` |
| `disposition` | yes | text | `TRANSPORTED` | Outcome: transported, treated, refused, cancelled | `incident_disposition_code` |
| `valid_time` | yes | Y/N | `Y` | Times are trustworthy (no entry error) | `valid_incident_rspns_time_indc` |
| `eta_google_s` | optional | integer seconds | `1240` | Google Maps drive estimate with traffic, from the ambulance's position when assigned to the incident | not collected today: Google Routes API call at assignment |
| `held` | optional | Y/N | `N` | Call waited because no ambulance was free | `held_indicator` |

The 9 required columns are things dispatch systems already log. The 2 optional ones unlock extra detail: without `eta_google_s`, card 7 is hidden and card 8 can't split a long trip from slow driving; without `held`, card 8 drops "no ambulance free". Cut from the first draft because no feature used them: `county_fips` (looked up from `zcta`), `call_type`, `unit_id`, and the separate severity and priority columns (replaced by `urgency_code`). No street address or coordinates are stored, only the ZIP code area, to protect patient privacy.

## Derived fields (computed in code, never stored)

The library computes these from each row, so the CSV can't disagree with itself. Calls with `disposition = CANCELLED`, an empty `t_onscene`, or `valid_time = N` are left out of all response-time statistics but still counted in call volume.

| Field | Formula | Used by |
| --- | --- | --- |
| `dispatch_s` | `t_assigned − t_received` (911 center step) | 8, 9 |
| `turnout_s` | `t_enroute − t_assigned` (crew step) | 8, 9 |
| `drive_s` | `t_onscene − t_enroute` | 7, 8, 9 |
| `dispatch_to_scene_s` | `t_onscene − t_assigned`, the prompt's own measure | 2, 7 |
| `total_s` | `t_onscene − t_received`, the patient's whole wait; the headline measure | all |
| `vs_google_s` | `drive_s − eta_google_s` (negative = beat Google) | 7, 8 |
| `urgency_group` | red / yellow / green, from `targets.csv` by `urgency_code` | 1–4 and every filter |
| `target_s`, `goal_on_time_pct` | from `targets.csv` by `urgency_code` | all |
| `late` | `total_s > target_s` | 1–5, 8, 9 |
| `date` | from `t_received`, New York time | filters, 5, 6 |
| `county_fips` | joined from `zcta_county.csv` | 1, 2 |

The headline uses `total_s` rather than the prompt's dispatch-to-scene time, so delays at the 911 center before an ambulance is assigned are caught too. Card 2 shows both.

## Lookup and config tables

**`zcta_county.csv`**, one row per ZIP code area. Built once from the Census ZCTA-to-county relationship file and population counts.

| Column | Type | Example | Meaning |
| --- | --- | --- | --- |
| `zcta` | text, 5 digits | `14612` | Key; matches `GEOID` in `ny_zcta.geojson` |
| `county_fips` | text, 5 digits | `36055` | County holding most of the ZCTA's population |
| `population` | integer | `34512` | Residents, sets synthetic call volume |
| `urban_rural` | text | `urban` | urban / suburban / rural; rural areas get longer drives in the generator |

**`counties.csv`**, one row per county.

| Column | Type | Example | Meaning |
| --- | --- | --- | --- |
| `county_fips` | text, 5 digits | `36055` | Key; matches `GEOID` in `ny_counties.geojson` |
| `county_name` | text | `Monroe` | Name shown on the map and summary card |
| `population` | integer | `759443` | Residents |

**`config/targets.csv`**, one row per urgency code (10 rows, grouped below to save space). The 911 center sets these once; the values are placeholders until the team picks them.

| `urgency_code` | `urgency_group` | `target_s` | Shown as | `goal_on_time_pct` |
| --- | --- | --- | --- | --- |
| 0–2 | red | 480 | 8:00 | 90 |
| 3–5 | yellow | 900 | 15:00 | 90 |
| 6–9 | green | 1800 | 30:00 | 90 |

`goal_on_time_pct` sets the bar for "too slow overall": the Cpk threshold is z(goal) ÷ 3, so 90% gives 0.43 and 95% gives 0.55. A center with different goals for rural areas can add an `urban_rural` column here; the late flag then joins on both.

## Filters and what each feature needs

Every API request carries the same five filters, so every card always describes the same calls.

| Filter | Type | Default |
| --- | --- | --- |
| `from`, `to` | dates | last 30 days |
| `urgency` | any of red, yellow, green | red |
| `level` | `state` / `county` / `zcta` | `state` |
| `id` | county FIPS or ZCTA | none (whole state) |
| `baseline_days` | integer | 60 days before `from` |

| # | Feature | Returns, per place or per call | Statistics |
| --- | --- | --- | --- |
| 1 | Map, county → ZIP drill-down with back arrow | per county or ZCTA: calls, late calls, % late, P95, status flag | % late, P95, status rule below |
| 2 | Summary card | places needing attention; urgent calls by county; % late, median wait, median dispatch-to-scene time and P95 for the selection | counts, percentiles |
| 3 | Map coloring | fill in the selected urgency's color, darker = higher % late; flag marker on places that need attention; gray with tooltip "Not enough calls (<30 calls)" | status rule below |
| 4 | Map toggles | red / yellow / green chips and the date range re-run 1–3 | none new |
| 5 | Real change or bad days? | per day, or per week for low-volume places: calls, late calls, % late, control limits, signal flags | p chart with varying limits; run test |
| 6 | Every urgent call (I-MR) | per call: time, minutes, moving range, limits, flags; the 8 test results | I-MR on log minutes |
| 7 | Ambulance vs Google | median Google estimate and median drive, selected range vs baseline; histogram of `vs_google_s`; % slower than Google | medians, histogram |
| 8 | What held up each late call | late calls per cause: long trip, 911 center, crew, drive slower than Google, no ambulance free (`held`) | fault tree; excess over baseline median |
| 9 | Which fix helps most | % late, P95 and late calls avoided under one fix: post an ambulance closer, add an ambulance (removes held waits), 911 center faster, crew faster | replay of the selected calls with one step changed |

Suggested endpoints: `GET /summary` (1–4), `GET /pchart` (5), `GET /imr` (6), `GET /google` (7), `GET /delays` (8), `GET /whatif?fix=&pct=` (9). All take the filters above. `POST /calls` appends one call in the `incidents.csv` format; replay mode uses it to stream a dataset in time order, which is how the demo shows real-time logging.

## Statistical rules

One place's status comes from two questions: is it **too slow overall**, and has it **changed recently**?

| Status | Map flag | Too slow overall? | Changed recently? |
| --- | --- | --- | --- |
| Act now | filled flag + thick outline | yes | yes |
| Recent change | hollow flag | no | yes |
| Ongoing gap | dotted outline | yes | no |
| On track | no mark | no | no |
| Not enough calls | gray fill; tooltip "Not enough calls (<30 calls)" | fewer than 30 calls in the selection | — |

The fill color stays the selected urgency (decision 1), so status is shown by flags and outlines, never by a second red/yellow/green.

- **Too slow overall:** the one-sided 95% upper bound of Cpk is below z(goal) ÷ 3 (0.43 for a 90% goal). Cpk is computed on log minutes against log of `target_s`, with σ from the average moving range ÷ 1.128.
- **Changed recently:** in the selected range, the p chart has a point above its upper limit, or the I chart fires test 1, 2 or 5. Limits come from the baseline.
- **Subgroup size:** the p chart groups by day when the place averaged at least 10 calls a day in the baseline, otherwise by week. A ZIP with 1 call a day would otherwise swing between 0% and 100% late.
- **Baseline too small:** if the 60-day baseline has fewer than 30 calls, it stretches to 120 days; still under 30, the place is "Not enough calls".
- **Seasons:** because the baseline is the 60 days just before the range, slow seasonal change is mostly absorbed. A summer surge that raises late calls within a few weeks still flags, which is intended.
- **P95 interval:** bootstrap, 2,000 resamples, 2.5th and 97.5th percentiles.
- **County level:** the same rules on all of the county's calls, not an average of its ZIP codes.
- **Known-answer checks:** before styling, each function is tested against a case with a known result (course examples, and the planted stories below).

## Synthetic datasets and validation

All three cover every New York ZCTA for 12 months (Oct 16, 2025 to Oct 15, 2026), use the same columns, and each plants one story with a known answer. The generator draws each step from a lognormal distribution with fixed parameters and a fixed random seed, so anyone can rebuild the files exactly.

**Yearly pattern in every dataset.** Daily call volume per ZIP = population × a base rate × a month factor × a day-of-week factor. The month factor peaks in June to August, following the team's research that call volume rises in summer with outdoor activity, travel and heat illness. All factors sit in one parameters file and are listed in the README, so the pattern is a stated assumption, not a hidden one.

| File | Planted story | The tool should show |
| --- | --- | --- |
| `incidents_baseline.csv` | Only the yearly pattern. Rural ZIP codes have long Google estimates because ambulances travel far. | Rural ZIPs = Ongoing gap; card 8 says long trip; no recent-change flags |
| `incidents_station_closure.csv` | From Sep 1, 2026, Google estimates in one ZIP code rise about 25%. Crews and the 911 center don't change. | That ZIP turns Act now in early September; card 7 shows Google's estimate rising while ambulances still beat it; card 9's "post an ambulance closer" helps most |
| `incidents_summer_surge.csv` | Jul 1 to Aug 31, 2026, one county's volume rises 30% beyond the normal summer peak; `held = Y` becomes common and `dispatch_s` grows. Back to normal in September. | County flagged in July and August only; card 8 points to no ambulance free and the 911 center; card 9's "add an ambulance" helps most |

**Checks the generator and loader run on every file**

- [ ] Times are in order: `t_received ≤ t_assigned ≤ t_enroute ≤ t_onscene`
- [ ] Every `zcta` is in `zcta_county.csv`
- [ ] Every `urgency_code` is in `targets.csv`
- [ ] `eta_google_s` is positive whenever `t_onscene` is filled
- [ ] Cancelled calls have an empty `t_onscene`
- [ ] Monthly call volume peaks in June to August as set in the parameters file
- [ ] Each file is under 25 MB (GitHub's limit is 100 MB) and the API answers a request in under 2 seconds
- [ ] The tool finds each planted story at the expected place and dates

## Check against the prompt and rubric

Every part of the prompt and every rubric line is covered by 9 required columns and 1 config file. Checking found 6 gaps, all fixed above; 2 items are still to do.

| Requirement | Where the schema covers it | Result |
| --- | --- | --- |
| Prompt: dispatch-to-scene times vary across zones | `t_assigned`, `t_onscene`, `zcta`; `dispatch_to_scene_s`; map by county and ZIP | Fixed: added `dispatch_to_scene_s`, the prompt's exact measure |
| Prompt: monthly averages miss fatal outliers | P95 with interval (cards 1–2); every call on the I chart (card 6) | Covered. We flag extreme waits; with no patient-outcome data, we don't claim deaths |
| Prompt: where failures occur | county → ZIP drill-down | Covered |
| Prompt: why failures occur | step times, `eta_google_s`, `held` (cards 7–8) | Fixed: added `held` for "no ambulance free" |
| Prompt: help manage dispatchers | `dispatch_s` (911 center step) in cards 8–9 | Covered at center level. No dispatcher IDs, by design: fewer inputs and no blame on individuals |
| Prompt: response time logging in real time | `POST /calls`; replay mode streams a dataset in time order | Fixed: added `POST /calls` |
| Prompt: flag zones that need resolution | status rule; flags and outlines on the map | Fixed: flags replace status colors, since colors now mean urgency |
| Rubric: valid QC analyses (25) | p chart, I-MR, one-sided Cpk with interval, bootstrap P95, fault tree, what-if replay, known-answer tests | Fixed: weekly subgroups for low-volume ZIPs; Cpk bar tied to the center's own goal |
| Rubric: minimal requirements (5) | 9 columns dispatch systems already log, plus `targets.csv`; 2 optional columns | Fixed: cut `county_fips`, `call_type`, `unit_id`, severity and priority |
| Rubric: clear use case (5) | User: the 911 center's quality supervisor. Decision: which ZIP to investigate and which fix to fund | Covered |
| Rubric: demonstration and test datasets (15) | 3 datasets, each with a planted story and an expected result | Covered |
| Rubric: dataset explainers (5) | this doc's column tables, with the real-world source of each field and how to capture `eta_google_s` | Covered; becomes `CODEBOOK.md` |
| Rubric: documentation (10) | inputs, outputs and method of each function and endpoint | To do: a function reference page |
| Rubric: reproducibility (5) | fixed-seed generator, parameters file, scripts that download the Census shapes and ZCTA-county file | To do: add these scripts and run steps to the repo |

**What sets it apart:** comparing each drive with Google's estimate separates "the trip was long" from "the drive was slow", which most response-time tools can't do. The what-if card then turns that into a funding choice (move an ambulance, add one, or speed up dispatch), in plain language a supervisor can act on.
