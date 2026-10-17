# OnScene data codebook

**All incident records are synthetic.** The fixed-seed generator in
[generate.py](generate.py) invents calls; no real EMS extract, patient,
crew, or agency record appears in these files. Geographic boundaries
and population lookups come from the 2020 U.S. Census. The data are
suited to demonstrating and testing OnScene, not estimating the
performance of a real dispatch center.

For a short dashboard walkthrough, see the [project README](../README.md).
For the analysis rules and limitations, see [SPEC.md](../SPEC.md).

## Files and provenance

| File | Contents and purpose |
|---|---|
| `incidents_baseline.csv.xz` | **1,818,312 synthetic calls**, October 16, 2025–October 15, 2026. Seasonal and geographic differences, but no deliberately planted process change. |
| `incidents_station_closure.csv.xz` | **1,818,312 synthetic calls** over the same dates. Identical to Baseline outside ZCTA 11368 after September 1, 2026; longer generated drives there simulate a station closure. |
| `incidents_summer_surge.csv.xz` | **1,822,235 synthetic calls** over the same dates. Monroe County has extra calls and dispatch delay July 1–August 31, 2026; unaffected call contents match Baseline (generated IDs may differ). |
| `incidents_messy_sample.csv.xz` | **13,327 synthetic rows** from Suffolk County in July 2026, with deliberate input problems. A cleaning test fixture, **not** a fourth dashboard dataset. |
| `lookup/zcta_county.csv` | New York ZCTA → county, population, land area, and derived area type from 2020 Census data. |
| `lookup/counties.csv` | Names and 2020 populations for New York's 62 counties. |
| `params.json` | Seed, dates, distributions, scenario settings, and messy-sample injection counts. |
| `generate.py`, `validate.py`, `sensitivity.py` | Rebuild the incidents, check their schema/stories, and measure false alarms and detection. |
| `build_lookups.py` | Rebuild the Census lookups; requires a Census API key. |
| `requirements.txt` | Python dependencies for the data scripts. |

The three main files are xz-compressed CSVs of about 22 MB each. The
generator seed is **20261016** and the timezone is
`America/New_York`, with daylight-saving offsets in timestamps.
`config/targets.csv` lives outside this folder and supplies the
target and goal for each urgency code and area type.

## Incident fields

Each dashboard CSV normally has one row per call and exactly these ten columns;
the messy sample deliberately repeats some IDs. Timestamps
are ISO 8601 with seconds and the New York UTC offset; durations derived
from them are in **seconds**. The field mapping follows the public NYC
EMS Incident Dispatch Data vocabulary but has **not** been validated
against a real extract.

| Column | Type / units | Definition | Related NYC EMS field |
|---|---|---|---|
| `incident_id` | text | Unique call ID within a file, ordered by received time | `incident_id` |
| `zcta` | five-digit text | Census ZIP Code Tabulation Area where the call occurs | `zipcode` |
| `urgency_code` | integer 0–9 | Initial severity: 0–2 red, 3–5 yellow, 6–9 green | `initial_severity_level_code` |
| `t_received` | datetime | Start of OnScene's response clock; whether this would mean original 911 receipt or EMS CAD creation in real data is **unconfirmed** | `incident_datetime` |
| `t_assigned` | datetime | First ambulance assigned | `first_assignment_datetime` |
| `t_enroute` | datetime | Crew starts driving | `first_activation_datetime` |
| `t_onscene` | datetime, empty if cancelled | First ambulance arrives | `first_on_scene_datetime` |
| `cancelled` | `Y` / `N` | Call was cancelled; synthetic cancelled calls have no `t_onscene` | `incident_disposition_code` = CANCELLED |
| `valid_time` | `Y` / `N` | Whether the timestamps are trusted for response-time analysis | `valid_incident_rspns_time_indc` |
| `held` | `Y` / `N` | Call waited because no unit was free; used descriptively | `held_indicator` |

The CSV header must contain all ten fields even though the core
statistics chiefly need ZCTA, urgency, received/on-scene times, and
the eligibility flags. The intermediate timestamps support ordering
checks and descriptive stage times; `held` supports the held-call
percentage. No unit, dispatcher, address, patient, or travel-estimate
field is required.

For a completed, valid call, times must satisfy
`t_received ≤ t_assigned ≤ t_enroute ≤ t_onscene`. OnScene derives:

| Measure | Formula |
|---|---|
| Response time (`total_s`) | `t_onscene − t_received` |
| Received → assigned (`dispatch_s`) | `t_assigned − t_received` |
| Assigned → en route (`turnout_s`) | `t_enroute − t_assigned` |
| En route → scene (`drive_s`) | `t_onscene − t_enroute` |

A call is **late** when `total_s > target_s` for its urgency and
area type, and **very late** when it exceeds twice that target. A call
exactly at its target is on time. Cancelled, untrusted, missing-time,
or out-of-order calls count toward volume but not timing statistics.
Rows with repeated IDs, unreadable `t_received`, unknown ZCTAs, or
unknown urgency codes are dropped and counted by reason.

## Census lookups and targets

`lookup/zcta_county.csv` contains:

| Column | Type / units | Definition |
|---|---|---|
| `zcta` | five-digit text | New York part of a Census ZCTA |
| `county_fips` | five-digit text | County receiving the largest apportioned share of its residents |
| `population` | people | 2020 Census population of the ZCTA or its New York part |
| `land_sqmi` | square miles | Land area of the New York part |
| `urban_rural` | category | Area type derived from people per square mile: urban ≥3,000; suburban 500–<3,000; rural 50–<500; remote <50 (also zero land or population) |

`lookup/counties.csv` contains `county_fips` (five-digit text),
`county_name` (text), and `population` (2020 Census people).
The lookup has **1,826 ZCTAs and 62 counties**. The source is the
2020 Census Demographic and Housing Characteristics population field
`P1_001N`, the ZCTA-to-tract relationship file, and Census
cartographic geography. Tract population is apportioned among
overlapping ZCTAs by land-area share. This assumes people are evenly
spread across each tract; the assignment is approximate.

`config/targets.csv` has 40 rows, one for each urgency code 0–9
and area type. Its fields are `urgency_code` (0–9),
`urban_rural` (category), `urgency_group` (red/yellow/green),
`target_s` (response-time limit in seconds),
`goal_on_time_pct` (90), `reference_p90_s` (historical synthetic
red-call P90 in seconds), and `n_reference` (calls behind that P90).
The reference fields come from eligible red calls received
October 16, 2025–April 15, 2026. They do not determine the default
targets.

| Priority | Urban | Suburban | Rural | Remote | Goal |
|---|---:|---:|---:|---:|---:|
| 1 Most urgent (red) | 480 s | 600 s | 840 s | 840 s | 90% |
| 2 Urgent (yellow) | 900 s | 900 s | 900 s | 900 s | 90% |
| 3 Less urgent (green) | 1,800 s | 1,800 s | 1,800 s | 1,800 s | 90% |

These targets are **illustrative placeholders**, not certified EMS
standards. The red tiers adapt NFPA 1720 volunteer fire-service
demand zones, but its response clock and area definitions differ.
Remote reuses rural because NFPA 1720 provides no fixed remote time.
`config/build_targets.py` can rebuild the current table; its
`--flat` and `--from-history` alternatives are not the dashboard
defaults. Using history to set a P90 target and then judge that same
history against it would be circular.

## How the synthetic calls are made

`params.json` is the authoritative list of numeric generator
parameters. The main assumptions are:

- Daily calls per ZCTA are drawn from a Poisson rate based on Census
  population, **0.09 calls per person per year**, monthly and
  day-of-week factors. July is the highest-volume month. The
  hour-of-day profile has an overnight trough and afternoon peak.
- Urgency codes 0–9 follow the probabilities in `params.json`.
  Dispatch, turnout, and drive components use lognormal durations
  rounded to seconds. Drive times vary around an internal synthetic
  travel estimate, with occasional slow outliers; that estimate is
  **not** a field in the incident file or an external routing result.
- County-day effects make calls within a county and day similar.
  Winter increases modeled travel delay; summer increases modeled
  dispatch delay. Higher-than-expected daily load increases the
  chance of a held call. These effects create seasonality and
  extra-binomial variation; they are invented, not fitted to a center.
- About 6% of generated calls are cancelled. About 1% have
  `valid_time = N`. A normal held probability of about 2% rises
  with congestion; held calls get an additional dispatch delay.
- Each ZCTA has a deterministic random stream. Scenario-specific
  extra calls use a separate stream so unaffected records match
  Baseline. The generator preserves local calendar dates across
  daylight-saving transitions.

The baseline file has persistent long-trip service gaps in rural and
remote places, not a planted change. Its synthetic red response times
are faster than some published EMS benchmarks; the generator was
tuned for a useful range of late-call shares, **not** to reproduce
any real agency. Neither its volume nor its timings should be used
as real-world estimates.

## Scenario settings and expected dashboard results

The dashboard initially selects red calls and
**July 18–October 15, 2026**. Goal and control are separate: Below
goal may occur without a recent signal, and the baseline screen can
refuse a control verdict. The following measurements are for the
current fixed-seed files and a 60-day pre-period baseline.

| Dataset | What changes in the incident generator | How to inspect it | Expected red-call result |
|---|---|---|---|
| **Baseline** | No planted shift. Seasonality, shared county-day effects, and persistent geographic differences remain. | State view, default dates | Statewide **Meets goal** (91.8% of 150,495 valid calls) but has **Insufficient baseline** for its daily control chart. Across 62 counties: 35 Ongoing gap, 1 Recent change, 10 Meets goal/no signal, 16 Needs more data, 0 Act now. Erie is a chance false alarm, as is ZIP 11212. |
| **Station closure** | From September 1, 2026, generated drive times in ZCTA **11368** (Corona, Queens) increase by a factor of 1.6. That ZIP's earlier calls and every other ZIP match Baseline. | `station_closure`, ZIP 11368, September 1–October 15 | **Act now:** 72.2% on time of 407 valid red calls (95% CI 67.7–76.4%); Below goal and Out of control in September and October. The same Baseline selection is 91.4%, Inconclusive, In control. |
| **Summer surge** | In **Monroe County (36055)**, July 1–August 31 volume rises about 30%, held calls become common, and ordinary dispatch time is multiplied by 1.6. Other call contents match Baseline, though generated IDs may differ. | `summer_surge`, Monroe County, July 1–August 31 | **Act now:** 80.2% on time of 5,285 valid red calls (95% CI 79.1–81.2%), Below goal with 10 weekly deterioration signals. The same Baseline selection Meets goal (94.2%) and is In control. |

**Do not interpret the default window as the summer-surge test.**
For Monroe in the default July 18–October 15 range, the goal
judgment is Below (85.8% of 6,405 valid red calls), but the
pre-period baseline overlaps the beginning of the surge and fails
the stability screen: control is **Insufficient baseline**, queue
**Needs more data / Inconclusive**. For September 1–October 15,
Monroe Meets goal (94.7% of 2,532), yet the baseline lies inside
the surge and is still unsuitable. The July–August window in the
table gives the intended clean pre-surge comparison.

The station-closure replay starts August 25 by default: ZIP 11368
gets one unconfirmed high period (watch) on September 3, turns Out
of control September 4, and becomes Act now September 8. The
summer-surge replay starts June 25 by default: Monroe turns Out
of control July 2 and Act now July 5. The selected start and
baseline stay fixed as replay advances. An applied From date
overrides the default replay start.

False alarms and low power are visible, not concealed. On three
non-overlapping 90-day county windows in the no-change Baseline
file, **2/186 red** and **3/186 yellow** county-windows were Out
of control (about 1.1% and 1.6%). A simulated +2%-per-week
drive-time drift was not detected. Statewide daily baselines are
often unstable; many ZIPs have too few calls to support a control
verdict. [sensitivity.py](sensitivity.py) measures these cases.
The scenarios are test stories, not causal proof or estimates of
real-system detection rates.

## Messy sample and cleaning

`incidents_messy_sample.csv.xz` is a separate test input built
from 13,309 Suffolk County Baseline calls plus 18 repeated-ID
rows. Injected problems are recorded in `params.json`:

| Problem | Injected rows | Loader behavior |
|---|---:|---|
| Repeated incident ID | 18 (12 exact repeats, 6 different content) | Drop repeat; keep first |
| Unknown ZCTA | 5 | Drop |
| Unknown urgency code | 5 | Drop |
| Missing or unreadable received time | 8 | Drop |
| Missing assigned time | 8 | Keep for volume; exclude from timing |
| Out-of-order timestamps | 10 | Keep for volume; exclude from timing |
| `valid_time = N` with bad times | 8 | Keep for volume; exclude from timing |

The first four groups account for **36 dropped rows**; the other
problems remain as untimed records. Naturally cancelled and
invalid-time calls are present too. `validate.py --messy` checks
each injected count and the untouched rows; the app reports
cleaning counts through `GET /api/health`.

## Rebuild and verify

From the repository root, install the data dependencies if needed:

```bash
python3 -m venv .venv
.venv/bin/pip install -r data/requirements.txt
.venv/bin/python data/validate.py
.venv/bin/python data/validate.py --messy
```

`data/validate.py` checks headers, IDs, time order, lookups,
targets, coverage, file sizes, scenario effects, and unchanged
records outside each story. `--messy` checks the injected cleaning
cases. `--reproduce` rebuilds all four files in a temporary
directory and compares them with the checked-in data; it is slower
because xz compression dominates generation. To rebuild them
deliberately, run `.venv/bin/python data/generate.py`, then
`.venv/bin/python config/build_targets.py`.
`PYTHONPATH=. .venv/bin/python data/sensitivity.py` recomputes
false-alarm and sensitivity measurements.

Rebuilding the Census lookups is separate and needs a Census API
key supplied through your environment or a gitignored `.env`;
see `data/build_lookups.py`. The three generated incident files
do not need a key.

## Using a real extract

Real-data compatibility has **not** been tested. Before replacing
the synthetic files, map local CAD fields to this schema; confirm
whether `t_received` is the original 911 receipt or EMS CAD
creation; check timestamp order and missingness; verify ZCTA,
urgency, area type, targets, and goal with the center; and assess
whether the baseline and binomial assumptions fit the observed
process. The same codebook format can then document the real
extract without presenting synthetic numbers as actual outcomes.
