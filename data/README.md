# Data and codebook

**All incident data here is SYNTHETIC.** No real call, patient or agency is in it. A fixed-seed
generator invents it from the parameters in `params.json`. Population and geography are real
(2020 Census); the calls are not. The replay controls identify the stream as synthetic, and the “How it works” guide
explains that it contains invented calls.
No real public EMS extract has been checked against the tool yet (planned, see "Real-data compatibility" below).

## Files

| File | What it is |
|---|---|
| `incidents_baseline.csv.xz` | 1,818,312 calls, 21,974,896 bytes (about 22.0 MB). 12 months (2025-10-16 to 2026-10-15), every New York ZCTA. Normal seasonal pattern (summer peak) and no planted change. Since H-13 (Oct 16) it is also less tidy: day-to-day effects shared by a county, winter and summer effects on lateness, an hour-of-day profile and congestion (see "How the generator works"). Rural and remote ZIPs have long trips, so against their red targets they show **persistent gaps** (Below goal, in control: "Ongoing gap"). Control signals here are false alarms; they are counted, not assumed away. Measured Oct 17 after H-19 (60-day baseline, county-windows): red 2 of 186 (1.1%) and yellow 3 of 186 (1.6%) over the three non-overlapping 90-day windows ending Oct 15 (`data/sensitivity.py`), and red 3 of 186 (1.6%) over the three windows of `tests/test_api.py`; one ZIP (11212) is flagged by chance in the default window; see "Expected signals". |
| `incidents_station_closure.csv.xz` | 1,818,312 calls, 21,974,612 bytes. Same as baseline, except in ONE urban ZIP (`station_closure.zcta_resolved` in `params.json`: 11368, Corona, Queens, the most populous urban ZCTA) calls received on or after 2026-09-01 have their travel estimate x 1.6 in the generator (internal, not in the file), **and the actual drive follows it** (drive = estimate x ratio), so observed response times really get longer, not only the estimate. The team first planned +25%; at that size (and at the old 0.0198 volume) the rules did not flag the ZIP, so it was raised to +60% on Oct 16. Measured after H-19 (late = over 480 s): red late share 5.90% in Jul-Aug, 27.76% from Sep 1 to Oct 15. All other ZIPs, and this ZIP before Sep 1, are identical to baseline. |
| `incidents_summer_surge.csv.xz` | 1,822,235 calls, 22,040,352 bytes. Same as baseline, except in Monroe County (36055) for calls received 2026-07-01 to 2026-08-31: volume x 1.30, `held = Y` with probability 0.25 (baseline 0.02), `dispatch_s` x 1.6. Normal from Sep 1. Since H-13 the extra surge calls come from a separate random stream (an additional Poisson(expected x 0.30) per ZIP and surge day), so every other row of the file, Monroe's included, is identical to baseline outside Jul 1 to Aug 31. Measured after H-19: Monroe Jul-Aug volume 1.300 x baseline (17,017 vs 13,094 calls, all urgencies), held 26.4% in Jul-Aug and 1.8% in Sep 1-Oct 15. The tool does not say which intervention is best. |
| `incidents_messy_sample.csv.xz` | **A small separate file (13,327 rows, 176,920 bytes) for testing data cleaning; NOT mixed into the three files above.** Baseline rows of Suffolk County (36103) for July 2026 (13,309 calls) with problems injected into disjoint rows; the exact counts are the injection log in `params.json` (`messy_sample`): 8 missing `t_received`, 8 missing `t_assigned`, 10 out-of-order times (5 with `t_assigned` after `t_enroute`, 5 with `t_onscene` before `t_received`), 12 exact duplicate rows, 6 repeated `incident_id` with different content (`t_onscene` 45 s later), 5 unknown ZCTA (`99999`), 5 unknown urgency codes (10 or 99), 8 rows with `valid_time = N` and genuinely bad times (arrival 8 to 30 hours after the crew left). `python data/validate.py --messy` detects each type and must find exactly the logged count. |
| `lookup/zcta_county.csv` | One row per New York ZCTA (ZIP area). Built by `build_lookups.py`. |
| `lookup/counties.csv` | The 62 New York counties. Built by `build_lookups.py`. |
| `params.json` | Every generator parameter (see below). |
| `build_lookups.py` | Downloads 2020 Census data and writes `lookup/`. Needs a free Census key. |
| `generate.py` | Writes the three `.csv.xz` files and the messy sample from `params.json` and `lookup/` (about 29 minutes; xz preset 9 is the slow part). No key needed. `--messy` rewrites only the sample from the baseline file. |
| `validate.py` | PASS/FAIL line per check; exits 1 on any FAIL. Includes a self-test that the time-order check rejects bad data. `--messy` checks only the sample; `--reproduce` rebuilds everything from the seed. |
| `sensitivity.py` | Reproduces the false-alarm and detection tables in "Expected signals" (about 75 s). Writes no files. |
| `requirements.txt` | numpy, pandas, requests. |

**File format (H-17, Oct 17; volume raised in H-19).** The incident files are CSV compressed with xz (preset 9); they were
stored as `.csv.gz` before H-17. pandas reads them directly (`pd.read_csv("data/incidents_baseline.csv.xz")`), and
`xz -dk <file>` unpacks one to plain CSV (about 235 MB each). At the H-19 rate (0.09 calls per person per year) xz keeps
each main file at about 22 MB, under the project's own 25 MB check; that limit is why the rate stops at 0.09: a real rate
of ~0.15 would need files of about 37.5 MB.

The `config/targets.csv` file lives in `config/` (not here) and is read by the generator (urgency group
only), the validator and the app. It has 40 rows, one per urgency code (0-9) and area type, with columns
`urgency_code, urban_rural, urgency_group, target_s, goal_on_time_pct, reference_p90_s, n_reference`.
It is built by `config/build_targets.py` (see "Area types and targets" below).

## Incident columns

Real-world source: NYC "EMS Incident Dispatch Data" (NYC Open Data) field names. The tool reads
`incidents.csv` from a 911 center's computer-aided dispatch (CAD) export in the same shape.

| Column | Type | Units | Example | Meaning | NYC EMS field |
|---|---|---|---|---|---|
| `incident_id` | text | none | `NY26-0000001` | Unique call ID within a file, numbered in time order | `incident_id` |
| `zcta` | text, 5 digits | ZIP area | `14607` | Census ZIP code tabulation area where the call happened | `zipcode` |
| `urgency_code` | integer 0-9 | code | `2` | Initial severity; 0-2 red, 3-5 yellow, 6-9 green (`config/targets.csv`) | `initial_severity_level_code` |
| `t_received` | ISO 8601 datetime with New York offset | seconds precision | `2026-10-11T22:14:05-04:00` | Start of the response clock. **Provisional:** whether this is the original 911 call receipt or EMS CAD incident creation is not confirmed; it must be checked against the source before real use | `incident_datetime` |
| `t_assigned` | same | same | `2026-10-11T22:15:02-04:00` | First ambulance assigned | `first_assignment_datetime` |
| `t_enroute` | same | same | `2026-10-11T22:16:10-04:00` | Crew starts driving | `first_activation_datetime` |
| `t_onscene` | same, **empty if cancelled** | same | `2026-10-11T22:21:44-04:00` | First ambulance arrives | `first_on_scene_datetime` |
| `cancelled` | `Y`/`N` | none | `N` | `Y` when the call was cancelled (then `t_onscene` is empty). Replaces the old `disposition` column (H-14, Oct 17): the only distinction any output uses | `incident_disposition_code` (CANCELLED value) |
| `valid_time` | `Y`/`N` | none | `Y` | `N` means the times are not trusted (counts in volume only) | `valid_incident_rspns_time_indc` |
| `held` | `Y`/`N` | none | `N` | The call waited because no ambulance was free | `held_indicator` |

**Required vs optional.** The loader needs all ten columns in this header order: `incident_id, zcta, urgency_code,
t_received, t_assigned, t_enroute, t_onscene, cancelled, valid_time, held`. For the core on-time and control statistics only
`zcta`, `urgency_code`, `t_received`, `t_onscene`, `cancelled` and `valid_time` are used. `t_assigned` and `t_enroute` feed the
ordering check and the stage table; `held` feeds the stage table and the replay feed (any value other than `Y` counts as `N`).
Calls with an empty `t_onscene` must have `cancelled = Y`.

Always `t_received <= t_assigned <= t_enroute <= t_onscene`. The tool derives
`dispatch_s = t_assigned - t_received`, `turnout_s = t_enroute - t_assigned`,
`drive_s = t_onscene - t_enroute`, `total_s = t_onscene - t_received`.

**How to collect it for real.** Every column is already in a CAD system and in NYC's public data (the cancelled flag
is the CANCELLED disposition code). The file no longer contains a travel-estimate column: collecting one would need a
paid routing call at assignment and the ambulance's origin, which the center does not store (removed Oct 17, H-14).

## Lookup columns

`lookup/zcta_county.csv`

| Column | Type | Units | Example | Meaning |
|---|---|---|---|---|
| `zcta` | text | 5-digit ZCTA | `14607` | ZIP area (the New York part, if it crosses a border) |
| `county_fips` | text | 5-digit FIPS | `36055` | County with the largest apportioned share of the ZCTA's residents |
| `population` | integer | people | `21034` | 2020 Census population of the ZCTA (or part) in New York |
| `urban_rural` | text | none | `urban` | Area type from density = `population / land_sqmi`: urban >= 3,000 people per square mile of land, suburban 500 to < 3,000, rural 50 to < 500, remote < 50 (land or population 0 counts as remote). The column keeps its old name `urban_rural` so nothing else breaks; it now has four values. |
| `land_sqmi` | number | square miles | `1.512` | Land area of the New York part (1 sq mi = 2,589,988 m^2) |

`lookup/counties.csv`: `county_fips` (text, `36055`), `county_name` (text, `Monroe`), `population`
(integer, 2020 Census people).

## Census sources and method

2020 Census Demographic and Housing Characteristics (DHC), variable `P1_001N` (total population), from
`https://api.census.gov/data/2020/dec/dhc` for NY tracts, NY ZCTAs (or part) and NY counties
(needs a free key from <https://api.census.gov/data/key_signup.html>). ZCTA-to-tract relationship file
(no key): `https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_tract20_natl.txt`.

Apportionment: each NY tract's population is split among the ZCTAs overlapping it in proportion to
`AREALAND_PART / AREALAND_TRACT_20` (land area of the overlap over the tract's land area). A ZCTA's
county is the county with the largest apportioned population (largest land share if all are 0). Population
written is the Census value for the ZCTA (or part), not the apportioned sum. This assumes people are spread
evenly over a tract's land, which is only approximate.

## Area types and targets

**Target vs goal.** `target_s` is the time limit for one call (a call is late when `total_s > target_s`);
`goal_on_time_pct` (90) is the share of calls that should be within their target. The page's place judgment (Meets goal /
Below goal / Inconclusive) compares the on-time rate with the goal, never with the target.

Area type per ZCTA (2020 Census density, people per square mile of land): urban >= 3,000, suburban 500 to
< 3,000, rural 50 to < 500, remote < 50. Counts in the lookup: urban 376, suburban 320, rural 693, remote 437.

`config/targets.csv` is written by `python config/build_targets.py`. **Default since H-13 (team policy decision, Oct 16): the red
target depends on the area type, adapted from the demand-zone response-time objectives of NFPA 1720** (Standard for the
Organization and Deployment of Fire Suppression Operations, Emergency Medical Operations, and Special Operations to the Public
by Volunteer Fire Departments), as illustrative placeholders:

| Area type | Red target | Source |
|---|---|---|
| urban | 480 s (8 min) | the decisions brief's placeholder, kept (NFPA 1720's own urban figure is 9 min) |
| suburban | 600 s (10 min) | NFPA 1720 suburban zone, 10 min |
| rural | 840 s (14 min) | NFPA 1720 rural zone, 14 min |
| remote | 840 s (14 min) | **flagged:** NFPA 1720 says remote-zone response depends on travel distance and gives no fixed time, so the rural value is reused; a center must set its own |

Yellow is 900 s and green 1800 s in every area type; the goal is 90% on time everywhere. **Caveat:** NFPA 1720 is a fire-service standard
for volunteer departments, and its clock (dispatch or notification to arrival) is not our call-received-to-on-scene clock
(`t_received` to `t_onscene`); our area types come from Census density, not NFPA's demand-zone definitions. The numbers are used as
a source of tier ratios and round values only. They are configurable placeholders, not certified standards for any center.
The 40-row shape (code x area type) is unchanged. `python config/build_targets.py --flat` reproduces the earlier flat red 480 s;
`--from-history` sets each area type's red target from history (below); it is not the default because it is circular for the
on-time check (each area's target is its own P90, so its on-time rate is about 90% by construction and almost every place reads
Inconclusive). For the reference columns (written in every mode): take timed red calls (urgency codes 0-2; not CANCELLED,
`t_onscene` present, `valid_time = Y`, times in order) received in the **reference period 2025-10-16 to 2026-04-15** (inclusive,
America/New_York dates); for each area type compute the 90th percentile of `total_s` (numpy linear interpolation). With
`--from-history` that P90 rounded UP to a multiple of 10 s is the red `target_s`. `reference_p90_s` and `n_reference` record the
exact P90 and the number of calls it came from (after H-19: urban 460.0 s from 169,613 calls, suburban 483.0 s from 52,518,
rural 965.0 s from 41,208, remote 1,412.8 s from 6,913; the targets themselves did not change). Rerunning
gives the same file byte for byte. The reference period ends before every demo window (Jul 2026 on).
Red calls late against the tier targets in the baseline file (all months, valid calls, after H-19): urban 7.6%, suburban 3.5%, rural 15.5%, remote 41.3%.

## How the generator works (assumptions and every parameter)

All values are in `params.json`; changing them and re-running `generate.py` rebuilds the files.

- Seed 20261016. Each ZCTA has its own random generator seeded from (seed, zcta), so ZIPs no story touches
  are identical across the three files.
- Dates 2025-10-16 to 2026-10-15 inclusive, America/New_York (correct offsets across daylight saving).
- Daily calls per ZCTA are Poisson(population x base_rate / 365 x month factor x day-of-week factor).
  Base rate 0.09 calls per person per year, which gives about 1.82 million calls a year (1,818,312 in the baseline file).
  That is **about 60% of a typical US EMS rate (~0.15 calls per person per year)**. It was 0.0198 (about one-eighth, about
  400,000 calls) until H-17 (Oct 17), then 0.04 (about one-quarter, about 800,000 calls) until H-19 (Oct 17), when the
  team raised it to 0.09 so single ZIPs carry more calls. 0.09 is as high as the project's own 25 MB file limit allows
  (about 22 MB per xz file; the real rate would need about 37.5 MB). No other parameter changed, so the planted stories and
  their effect sizes are the same.
- Month factors Jan..Dec 0.92, 0.90, 0.94, 0.96, 1.00, 1.10, 1.15, 1.13, 1.00, 0.97, 0.95, 0.98
  (normalized to mean 1; summer peak). Day-of-week factors Mon..Sun 0.98, 0.97, 0.97, 0.98, 1.03, 1.05, 1.02.
- **Hour of day (H-13).** A call's time inside its local day follows `hour_of_day.arrival_weights_0_to_23` (normalized to mean 1:
  overnight trough 0.5, afternoon peak 1.4; measured after H-19, the busiest hour 17:00 has 2.82 x the calls of the quietest, 04:00). It is placed as a
  fraction of the local day, so 23- and 25-hour daylight-saving days work. The dispatch median is also multiplied by
  weight^0.2 (busiest hours +7%, quietest -13%). The profile is invented.
- **Day effect (H-13).** Each (county, day) has two lognormal(0, 0.15) multipliers, one on the drive estimate and one on dispatch
  time, shared by every ZIP in the county and seeded from (seed, county FIPS) so they do not depend on ZIP order. They make
  calls on the same day alike (weather, load). Measured daily Pearson dispersion of red late counts (baseline file, one pooled late
  share per county, after H-19): median 1.47 over the 39 counties with 5 or more red calls a day (1 = binomial); median 1.24
  over all 62 counties, max 6.34. The all-county median stays nearer 1 because a county with about one red call a day cannot show
  day-to-day dependence in a daily count, whatever the size of the effect; the tool's own dispersion check uses weekly or monthly
  subgroups. Sigma 0.15 is a tuning choice.
- **Seasonality in lateness (H-13).** The drive-estimate median is multiplied by 1.10 in Dec-Feb, 1.03 in Mar and Nov (winter roads);
  the dispatch median by 1.05 in Jul-Aug, 1.03 in Jun and Sep. Measured red late share (at 480 s, after H-19), Dec-Feb vs other months: urban
  9.35% vs 7.12%, statewide 20.51% vs 17.59%. Volume month factors are unchanged.
- **Congestion (H-13).** `p_held = held_probability x clip(((calls + 5) / (expected + 5))^2, 0.5, 4)` for that county-day, where
  `expected` is the county's expected calls with no random variation and no surge (the +5 stops a tiny county from reading one extra
  call as overload). Overall held rate 2.1% (baseline file, after H-19). In the surge the planted extra (0.25 - 0.02) is added on top, so Monroe's surge volume
  also adds a few held calls by itself.
- Urgency code probabilities 0-9: 0.04, 0.12, 0.18, 0.12, 0.15, 0.13, 0.10, 0.08, 0.05, 0.03.
- All durations are lognormal (median, sigma), rounded to whole seconds, minimum 1:
  `dispatch_s` median red 40, yellow 90, green 180, sigma 0.5; `turnout_s` median 50, sigma 0.35;
  `eta_google_s` (internal to the generator; not written to the file since H-14) median urban 200, suburban 215, rural 500, remote 750, sigma 0.45 (remote added Oct 16 with the same sigma as rural, so remote trips are longer; everything else and the seed are unchanged);
  `drive_s = eta_google_s (internal) x lognormal(median red 0.85, yellow 0.95, green 1.05, sigma 0.15)`, and with probability
  0.01 also x lognormal(median 1.4, sigma 0.25) (slow outliers: detours, wrong addresses; added Oct 16 and drawn last, so
  every other draw is unchanged). So ambulances are usually a little faster than the estimate but often slower
  (about 36% of drives), with a long slow tail. The travel estimate is generated, not a Google response.
  These medians were tuned from the starting values (red dispatch 55, turnout 65, eta 240/330/780) so the
  baseline red % late falls in the bands below. Sigmas were not changed.
- `held = Y` with probability 0.02; if held, `dispatch_s` gets an extra lognormal(median 240, sigma 0.6).
- Disposition: CANCELLED 0.06 (`t_onscene` empty), REFUSED 0.08, TREATED 0.10, TRANSPORTED 0.76.
  `valid_time = N` with probability 0.01.
- Story settings are in `params.json` under `station_closure` and `summer_surge`. In the surge the
  1.6 multiplier applies to the ordinary dispatch time, then the held extra is added. Surge extra calls use their own random
  stream (seed, ZIP, 2), so Monroe outside Jul 1 to Aug 31 equals baseline row for row (apart from `incident_id`).
- The messy sample is built with the stream (seed, 7777) from baseline rows; see the files table above.

### What the synthetic data does and does not claim

- Response times are **faster than published benchmarks**: the urban red median is about 4.7 min (279 s; suburban 292 s = 4.9 min,
  rural 543 s = 9.05 min, remote 764 s = 12.7 min; baseline file, whole year, after H-19), where NYC and NEMSIS reports show roughly
  7 to 10 min. Raising the volume (H-17, H-19) did not change any duration. The generator was tuned to land the late share in the bands below,
  not to match any real center.
- The red late-share bands in `validate.py` (urban 5-10%, suburban 6-10%, rural over 30%, remote above rural, all against 480 s) are
  **generator tuning targets, not external benchmarks**.
- Volume is about 60% of a real EMS system's (0.09 vs ~0.15 calls per person per year), capped by the 25 MB file limit. The
  closure effect was sized up to +60% on the drive estimate on Oct 16, when volume was one-eighth and +25% was not flagged. At
  the H-19 volume, ZIP 11368 has 407 valid red calls in six weeks and x1.15 and x1.25 are detected too (see "Expected
  signals"); the planted size was kept at x1.6.
- Day effects, seasonality, the hour profile and congestion are invented shapes with invented sizes. They make the data less
  tidy than independent calls; they are not estimates from real data.


## How to rebuild

```
python -m venv .venv && .venv/bin/pip install -r data/requirements.txt
CENSUS_API_KEY=your_key .venv/bin/python data/build_lookups.py   # or put CENSUS_API_KEY=... in the repo-root .env
.venv/bin/python data/generate.py     # no key needed; reads data/lookup/; about 29 minutes (xz preset 9 is the slow part)
.venv/bin/python config/build_targets.py   # rewrites config/targets.csv (reference P90 columns) from the new baseline file
.venv/bin/python data/validate.py     # 71 PASS, 0 FAIL (Oct 17, after H-19; about 2 minutes)
.venv/bin/python data/validate.py --reproduce   # 75 PASS: also rebuilds all four files from the seed and compares content (about 15 minutes)
.venv/bin/python data/validate.py --messy       # 14 PASS: the messy sample only
PYTHONPATH=. .venv/bin/python data/sensitivity.py   # false-alarm and detection tables (about 75 s)
```

`validate.py` checks per file: times in order, sorted, ZCTAs in the lookup (ZCTA -> county), urgency codes in
`config/targets.csv`, the exact 10-column header (no travel-estimate or disposition column), `cancelled = Y` <=> empty
`t_onscene`, stage intervals add up to `total_s`, at least 120 baseline days before every demo window,
summer volume peak, size under 25 MB, about 1.8 million calls (band 1,600,000-2,000,000; the messy sample 10,000-16,000 rows),
unique IDs, all 62 counties have calls. It then checks the baseline red % late bands
(late = `total_s` over 480 s; cancelled, no-onscene and `valid_time = N` excluded): urban 5-10%, suburban 6-10%, rural over
30%, remote > rural. It checks the stories: closure ZIP red % late from Sep 1 to Oct 15 is at least 2x its Jul-Aug value,
other ZIPs identical to baseline; surge Monroe Jul-Aug volume 1.25 to 1.35 x baseline, held rate over 0.15 in Jul-Aug and
under 0.05 in Sep-Oct. `python data/validate.py --reproduce` also rebuilds the four files from the seed in a temporary
folder and checks the content is identical (see the last line printed). Since H-13 it also checks: daily
red late counts are overdispersed (median Pearson dispersion over counties with 5 or more red calls a day above 1.15), red late
share Dec-Feb at least 1.15 x other months in urban ZIPs and 1.10 x statewide, hour-of-day arrivals (busiest hour more than 1.8 x
the quietest), the closure ZIP before Sep 1 and every other ZIP identical to baseline, the surge file's non-Monroe ZIPs and all
rows outside Jul 1 to Aug 31 identical to baseline, and the messy sample (`--messy`: each injected problem type detected with
exactly the logged count, and the untouched rows equal the baseline rows).

## Messy sample: what is injected and what the loader does

`incidents_messy_sample.csv.xz` is 13,327 rows built from Suffolk County (36103) calls of July 2026 (13,309 baseline calls plus
the 18 repeated-ID rows), with problems injected into disjoint rows. The injection counts are logged in `params.json`
(`messy_sample`), and `python data/validate.py --messy` checks that each problem type is found with exactly the logged count.
Measured Oct 17 after H-19 with the current loader (`app/data.py`; `data.derive(data.read_raw(path)).attrs["quality"]`):

| Problem | Injected | Loader count | What happens |
|---|---|---|---|
| Repeated `incident_id` (12 exact duplicate rows and 6 IDs reused for different calls) | 18 | 18 | Dropped; the first row is kept |
| Unknown ZIP (`99999`) | 5 | 5 | Dropped (not a New York ZCTA) |
| Unknown urgency codes (`10`, `99`) | 5 | 5 | Dropped (no target exists) |
| Missing or unreadable `t_received` | 8 | 8 | Dropped (the response clock cannot start) |
| Missing `t_assigned` | 8 | 8 | Kept, counted as untimed (`missing_time`) |
| Out-of-order times | 10 | 10 | Kept, counted as untimed (`out_of_order`). The loader counts each untimed call once, under the first reason; in this build no injected out-of-order row also carries a natural `valid_time = N`, so all 10 land here (`validate.py --messy`, which looks for the problem itself, also finds 10) |
| `valid_time = N` with bad times | 8 | 116 flagged in all | Kept, counted as untimed (`invalid_time_flag`). The 116 includes these 8 and the natural `valid_time = N` rows (about 1% of calls) |

Totals: 13,327 rows in, 36 dropped, 13,291 kept, 12,336 timed, 821 cancelled (a natural rate), 116 invalid-time, 8 missing a
time, 10 out of order. Nothing raises an error. `/api/health` reports the same counts, under `quality`, for each of the three main
files. Untimed rows never enter a time statistic.

## Expected signals (checked by `tests/test_api.py`)

Measured Oct 17, 2026 on the H-19 files (0.09 calls per person per year) with the H-13 rules (60-day baseline, red calls; the
dashboard's default 90-day window is Jul 18 to Oct 15; every row is a test). `python data/sensitivity.py` reproduces the
false-alarm and detection tables.

| Scenario | Window | Result on the dashboard (red calls) |
|---|---|---|
| baseline, statewide | 3 windows of 90 days (Jul 18-Oct 15, Apr 1-Jun 29, Jan 15-Apr 14) | 3 of 186 county-windows out of control (false alarms, 1.6%: Erie in Jul-Oct and Orange in Apr-Jun, both Recent change; Greene in Jan-Apr, which reads Act now); the test fails above 10%. `sensitivity.py`: 2 of 186 (red) and 3 of 186 (yellow) for the three non-overlapping 90-day windows ending Oct 15, 5 of 310 (red, 1.6%) and 5 of 310 (yellow, 1.6%) for the five overlapping 180-day windows. In those windows 11-19% of county-windows are "insufficient baseline", not "in control" |
| baseline, state chart (daily) | 90-day and 180-day windows | rarely evaluable: day-to-day effects make the daily baseline unstable, so the state place is usually "insufficient baseline" (0 of 8 red 90-day windows evaluable, 2 of 8 yellow; 0 of 5 red 180-day, 1 of 5 yellow); none of the evaluable ones was out of control. In the default window the state reads Meets goal, Insufficient baseline (chi-square / df 2.15). Read the state chart with that in mind |
| baseline, default window, 62 counties | Jul 18 - Oct 15 | Act now 0, Ongoing gap 35, Recent change 1 (Erie 36029, a false alarm: one strong weekly signal, week of Aug 10, p = 5.1e-5), Meets 10, Needs more data 16; needs attention 36. Watch chips: Oneida, Ulster, Wayne (all Ongoing gap). State totals: 150,495 valid calls, 91.8% on time, median 5.05 min, P95 12.67 min. Statewide flagged ZIPs: 1 of 807 with 30+ valid calls, 11212 (Kings, Recent change, 93.1% of 696; a false alarm; `tests/test_api.py` allows up to 1% such ZIPs on the clean file, never 11368). The 807 ZIPs: Ongoing gap 28, Meets 109, Recent change 1, Needs more data 669. Chance alone would put about 1.74 of 62 counties and 25.55 of 807 ZIPs "Below goal" if all truly met the goal; 39 counties and 94 ZIPs are. A ZIP has a median of 26 valid red calls in this window (over the 1,694 ZIPs with any; 22 over all 1,826 lookup ZIPs) |
| baseline, rural counties | any | Below goal, in control: Ongoing gap (persistent long trips, by design) |
| station_closure, ZIP 11368 | 2026-09-01 to 2026-10-15 | Below goal (72.2% on time of 407 valid calls, 95% CI 67.7-76.4%), out of control in both Sep and Oct (exact p = 3.1e-27 and 8.5e-18): Act now, 72.3 late calls beyond the goal. The same window on the clean file: 91.4% on time (CI 88.3-93.8%), Inconclusive, in control, Needs more data |
| station_closure, ZIP 11368 | default 90 days | Below goal (83.9%, CI 81.3-86.2%, 875 valid calls), out of control (Sep and Oct above the limit): Act now. First of the two entries in `/api/flagged` (807 ZIPs with 30+ valid calls checked); the other is 11212, the clean file's false alarm |
| station_closure, ZIP 11368, replay | from 2026-08-25 (fixed baseline Jun 26 to Aug 24), to Sep 10 / to Sep 20 | Act now (162 valid calls, 82.1%) / Act now (251 calls, 79.3%). In control Aug 25 to Sep 3 (a watch chip on Sep 3), out of control every day from Sep 4 to Oct 15 (Recent change Sep 4-7, Act now from Sep 8). No blip |
| summer_surge, Monroe | 2026-07-01 to 2026-08-31 | Below goal (80.2% of 5,285 valid calls, CI 79.1-81.2%), 10 weekly signals: Act now, 518.5 late calls beyond the goal. The clean file's Monroe over the same dates: 94.2%, Meets, in control |
| summer_surge, Monroe | 2026-09-01 to 2026-10-15 | Meets (94.7% of 2,532), but **Insufficient baseline** (Needs more data): its 60-day baseline, Jul 3 to Aug 31, is the surge itself, and the screen finds it overdispersed (chi-square / df 2.10) with 8 days in a row on one side. Changed in H-17 from "in control"; honest, not tuned away. The clean file over the same dates: Meets, in control |
| summer_surge, Monroe | default 90 days | Below goal (85.8%, 6,405 valid calls) but Insufficient baseline (Needs more data): the 60-day baseline (May 19 to Jul 17) contains the start of the surge; the screen drops 8 of 60 days and finds the rest overdispersed (chi-square / df 2.67), and refuses to set limits |
| summer_surge, Monroe, replay | from 2026-06-25 | out of control from Jul 2 (Recent change Jul 2-4), Act now from Jul 5 to the end of the surge |
| sensitivity, ZIP 11368 (drive time scaled in the clean file) | Sep 1 - Oct 15 | x1.6 (the planted change) detected: Act now, 72.2% on time, first out-of-control replay day Sep 4. x1.25 detected: Act now, 83.5%, first out of control Sep 7 and to the end from Sep 10. x1.15 detected: Act now, 87.0%, first out of control Sep 21, and stays. A +2% per week drift is NOT detected (88.7% on time, in control). No change: 91.4%, in control. Before H-17 (0.0198 calls per person per year) x1.15 and x1.25 were not detected; the ZIP now has 407 valid red calls in six weeks (201 at 0.04, about 68 at 0.0198) |

## Test fixtures (small, controlled)

`tests/fixtures/three_calls.csv` and `dst_call.csv` (hand-worked durations, a cancelled call, a daylight-saving call), and
tables built inside `tests/test_data.py` for: cancelled, `valid_time = N`, missing `t_onscene`, out-of-order times
(none enter time statistics), a sparse ZCTA (baseline stretch to 120 days and "not enough"), a no-change period followed
by a sudden shift (the baseline must not see the shift). Statistical fixtures with known answers are in `tests/test_qc.py`.

## Real-data compatibility (planned, not done)

The column names follow NYC's public EMS Incident Dispatch Data, so a separately labelled compatibility check on a real
extract is possible: map its fields, confirm what `incident_datetime` means (911 receipt or CAD creation), apply the same
minimal input set (no travel-estimate column is needed), and run the same `validate.py` schema checks. This has not been run. The three
files here are synthetic and must never be presented as historical data.
