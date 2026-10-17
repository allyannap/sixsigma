# Data and codebook

**All incident data here is SYNTHETIC.** No real call, patient or agency is in it. A fixed-seed
generator invents it from the parameters in `params.json`. Population and geography are real
(2020 Census); the calls are not. The dashboard labels it "Synthetic - simulated replay" everywhere.
No real public EMS extract has been checked against the tool yet (planned, see "Real-data compatibility" below).

## Files

| File | What it is |
|---|---|
| `incidents_baseline.csv.gz` | 12 months (2025-10-16 to 2026-10-15), about 400,000 calls, every New York ZCTA. Normal seasonal pattern (summer peak) and no planted change. Rural and remote ZIPs have long trips, so against the flat 8-minute red target they show **persistent gaps** (Below target, in control: "Ongoing gap"). Control signals here are false alarms; they are counted, not assumed away (about 2.7% of county-windows, see "Expected signals"). |
| `incidents_station_closure.csv.gz` | Same as baseline, except in ONE urban ZIP (`station_closure.zcta_resolved` in `params.json`: 11368, Corona, Queens, the most populous urban ZCTA) calls received on or after 2026-09-01 have `eta_google_s` x 1.6, **and the actual drive follows it** (drive = estimate x ratio), so observed response times really get longer, not only the estimate. The team first planned +25%; at that size the rules did not flag the ZIP, so it was raised to +60% on Oct 16. Expected: red late share about 8% before, 26% after; Below target and out of control from the month of Sep 1 (window Sep 1 to Oct 15). All other ZIPs are identical to baseline. |
| `incidents_summer_surge.csv.gz` | Same as baseline, except in Monroe County (36055) for calls received 2026-07-01 to 2026-08-31: volume x 1.30, `held = Y` with probability 0.25 (baseline 0.02), `dispatch_s` x 1.6. Normal from Sep 1. Expected: more arrivals and held calls in Jul-Aug and longer received-to-assigned times, out of control in Jul-Aug only. The tool does not say which intervention is best. |
| `lookup/zcta_county.csv` | One row per New York ZCTA (ZIP area). Built by `build_lookups.py`. |
| `lookup/counties.csv` | The 62 New York counties. Built by `build_lookups.py`. |
| `params.json` | Every generator parameter (see below). |
| `build_lookups.py` | Downloads 2020 Census data and writes `lookup/`. Needs a free Census key. |
| `generate.py` | Writes the three `.csv.gz` files from `params.json` and `lookup/`. No key needed. |
| `validate.py` | PASS/FAIL line per check; exits 1 on any FAIL. Includes a self-test that the time-order check rejects bad data. |
| `requirements.txt` | numpy, pandas, requests. |

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
| `disposition` | text | none | `TRANSPORTED` | `CANCELLED`, `REFUSED`, `TREATED` or `TRANSPORTED` | `incident_disposition_code` |
| `valid_time` | `Y`/`N` | none | `Y` | `N` means the times are not trusted (counts in volume only) | `valid_incident_rspns_time_indc` |
| `eta_google_s` | integer, optional | seconds | `312` | Drive estimate with traffic, made at assignment. Validated, but not used by the dashboard since the travel comparison was removed (Oct 16). **Synthetic here** (generated); real data has no ambulance origin coordinates, so never invent it for real incidents | not in NYC data |
| `held` | `Y`/`N` | none | `N` | The call waited because no ambulance was free | `held_indicator` |

Always `t_received <= t_assigned <= t_enroute <= t_onscene`. The tool derives
`dispatch_s = t_assigned - t_received`, `turnout_s = t_enroute - t_assigned`,
`drive_s = t_onscene - t_enroute`, `total_s = t_onscene - t_received`.

**How to collect it for real.** Everything except `eta_google_s` is already in a CAD system and in
NYC's public data. `eta_google_s` is NOT collected today: the center would call the Google Routes API
(traffic-aware drive time from the ambulance's position to the scene) at the moment of assignment and
store the seconds in the CAD record.

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

Area type per ZCTA (2020 Census density, people per square mile of land): urban >= 3,000, suburban 500 to
< 3,000, rural 50 to < 500, remote < 50. Counts in the lookup: urban 376, suburban 320, rural 693, remote 437.

`config/targets.csv` is written by `python config/build_targets.py`. **Default (team decision Oct 16, decisions brief):
flat placeholders, red 480 s, yellow 900 s, green 1800 s in every area type, goal 90% on time.** These are configurable
placeholders, not certified standards. The 40-row shape (code x area type) is kept so a center can set tiered targets.
`python config/build_targets.py --from-history` instead sets each area type's red target from history (below); it is not the
default because it is circular for the on-time check (each area's target is its own P90, so its on-time rate is about 90%
by construction and almost every place reads Inconclusive: 60 of 62 counties on the baseline file). For the reference
columns (written in both modes): take timed red calls (urgency codes 0-2; not CANCELLED, `t_onscene` present, `valid_time = Y`, times in order)
received in the **reference period 2025-10-16 to 2026-04-15** (inclusive, America/New_York dates); for each area
type compute the 90th percentile of `total_s` (numpy linear interpolation) and round UP to a multiple of 10 s.
With `--from-history` that is the red `target_s`. Yellow is 900 s and green 1800 s in every area type.
`reference_p90_s` and `n_reference` record the exact P90 and the number of calls it came from. Rerunning
gives the same file byte for byte. The reference period ends before every demo window (Jul 2026 on), so the
targets are not graded against themselves.

## How the generator works (assumptions and every parameter)

All values are in `params.json`; changing them and re-running `generate.py` rebuilds the files.

- Seed 20261016. Each ZCTA has its own random generator seeded from (seed, zcta), so ZIPs no story touches
  are identical across the three files.
- Dates 2025-10-16 to 2026-10-15 inclusive, America/New_York (correct offsets across daylight saving).
  Time of day is uniform.
- Daily calls per ZCTA are Poisson(population x base_rate / 365 x month factor x day-of-week factor).
  Base rate 0.0198 calls per person per year, which gives about 400,000 calls a year. That is
  **roughly one-eighth of a typical US EMS rate (~0.15 calls per person per year)**, kept small so the files stay under 25 MB.
- Month factors Jan..Dec 0.92, 0.90, 0.94, 0.96, 1.00, 1.10, 1.15, 1.13, 1.00, 0.97, 0.95, 0.98
  (normalized to mean 1; summer peak). Day-of-week factors Mon..Sun 0.98, 0.97, 0.97, 0.98, 1.03, 1.05, 1.02.
- Urgency code probabilities 0-9: 0.04, 0.12, 0.18, 0.12, 0.15, 0.13, 0.10, 0.08, 0.05, 0.03.
- All durations are lognormal (median, sigma), rounded to whole seconds, minimum 1:
  `dispatch_s` median red 40, yellow 90, green 180, sigma 0.5; `turnout_s` median 50, sigma 0.35;
  `eta_google_s` median urban 200, suburban 215, rural 500, remote 750, sigma 0.45 (remote added Oct 16 with the same sigma as rural, so remote trips are longer; everything else and the seed are unchanged);
  `drive_s = eta_google_s x lognormal(median red 0.85, yellow 0.95, green 1.05, sigma 0.15)`, and with probability
  0.01 also x lognormal(median 1.4, sigma 0.25) (slow outliers: detours, wrong addresses; added Oct 16 and drawn last, so
  every other draw is unchanged). So ambulances are usually a little faster than the estimate but often slower
  (about 36% of drives), with a long slow tail. `eta_google_s` is generated, not a Google response.
  These medians were tuned from the starting values (red dispatch 55, turnout 65, eta 240/330/780) so the
  baseline red % late falls in the bands below. Sigmas were not changed.
- `held = Y` with probability 0.02; if held, `dispatch_s` gets an extra lognormal(median 240, sigma 0.6).
- Disposition: CANCELLED 0.06 (`t_onscene` empty), REFUSED 0.08, TREATED 0.10, TRANSPORTED 0.76.
  `valid_time = N` with probability 0.01.
- Story settings are in `params.json` under `station_closure` and `summer_surge`. In the surge the
  1.6 multiplier applies to the ordinary dispatch time, then the held extra is added.

## How to rebuild

```
python -m venv .venv && .venv/bin/pip install -r data/requirements.txt
CENSUS_API_KEY=your_key .venv/bin/python data/build_lookups.py   # or put CENSUS_API_KEY=... in the repo-root .env
.venv/bin/python data/generate.py     # no key needed; reads data/lookup/
.venv/bin/python data/validate.py     # PASS/FAIL per check
```

`validate.py` checks per file: times in order, sorted, ZCTAs in the lookup (ZCTA -> county), urgency codes in
`config/targets.csv`, `eta_google_s > 0` when on scene, CANCELLED <=> empty `t_onscene`, stage intervals add up to
`total_s`, drive vs estimate goes both ways (and slow outliers exist), at least 120 baseline days before every demo window,
summer volume peak, size under 25 MB, unique IDs, all 62 counties have calls. It then checks the baseline red % late bands
(late = `total_s` over 480 s; cancelled, no-onscene and `valid_time = N` excluded): urban 5-10%, suburban 6-10%, rural over
30%, remote > rural. It checks the stories: closure ZIP red % late from Sep 1 to Oct 15 is at least 2x its Jul-Aug value,
other ZIPs identical to baseline; surge Monroe Jul-Aug volume 1.25 to 1.35 x baseline, held rate over 0.15 in Jul-Aug and
under 0.05 in Sep-Oct. `python data/validate.py --reproduce` also rebuilds the three files from the seed in a temporary
folder and checks the content is identical (last run Oct 16: 55 PASS, 0 FAIL).

## Expected signals (checked by `tests/test_api.py`)

| Scenario | Window | Result on the dashboard (red calls) |
|---|---|---|
| baseline, statewide | 3 windows of 90 days | 5 of 186 county-windows out of control (false alarms, 2.7%); the test fails above 10% |
| baseline, rural counties | any | Below target, in control: Ongoing gap |
| station_closure, ZIP 11368 | 2026-09-01 to 2026-10-15 | Below target (73.5% on time, 95% CI 62.0-82.6%), out of control in the months of Sep and Oct: Act now |
| station_closure, ZIP 11368 | default 90 days | Needs more data: its May-Jul baseline has too few late calls for even a monthly subgroup (n x p-bar < 5). Honest, not tuned away |
| summer_surge, Monroe | 2026-07-01 to 2026-08-31 | Below target, 8 weekly signals: Act now |
| station_closure, ZIP 11368, replay | from 2026-08-25 (fixed baseline Jun 26 to Aug 24), to Sep 10 / to Sep 20 | in control (Needs more data) / Act now |
| summer_surge, Monroe | 2026-09-01 to 2026-10-15 | in control again (Ongoing gap: Monroe is below the flat target anyway) |

## Test fixtures (small, controlled)

`tests/fixtures/three_calls.csv` and `dst_call.csv` (hand-worked durations, a cancelled call, a daylight-saving call), and
tables built inside `tests/test_data.py` for: cancelled, `valid_time = N`, missing `t_onscene`, out-of-order times
(none enter time statistics), a sparse ZCTA (baseline stretch to 120 days and "not enough"), a no-change period followed
by a sudden shift (the baseline must not see the shift). Statistical fixtures with known answers are in `tests/test_qc.py`.

## Real-data compatibility (planned, not done)

The column names follow NYC's public EMS Incident Dispatch Data, so a separately labelled compatibility check on a real
extract is possible: map its fields, confirm what `incident_datetime` means (911 receipt or CAD creation), drop
`eta_google_s` (it does not exist there) and run the same `validate.py` schema checks. This has not been run. The three
files here are synthetic and must never be presented as historical data.
