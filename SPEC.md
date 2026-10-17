# OnScene — product and statistical specification

OnScene is a read-only quality-monitoring dashboard for a New York State EMS
dispatch center. It helps a quality supervisor find places that miss a response
goal, show a recent deterioration from their own history, or both. **All incident
records in this demonstration are synthetic.** The dashboard does not dispatch
ambulances or connect to a live computer-aided dispatch (CAD) system.

Team Powerpuff Girls built OnScene for the Cornell Six Sigma Hackathon's
Health Systems: Emergency Response prompt. This document describes the current
product and the rules behind its numbers, not a history of design decisions.
For setup, the API contract, and the data codebook, see
[app/README.md](app/README.md), [docs/api.md](docs/api.md), and
[data/README.md](data/README.md).

## 1. Audience and decision

The primary user is a dispatch center quality supervisor reviewing New York
State, a county, or a ZIP Code Tabulation Area (ZCTA). OnScene answers two
different questions:

| Question | Evidence | Dashboard judgment |
|---|---|---|
| Are completed calls meeting the service goal? | On-time share and its 95% Wilson interval | Meets goal, Below goal, or Inconclusive |
| Has the late-call process worsened relative to this place's history? | Late-share p chart against a fixed pre-period baseline | Out of control, In control, or Insufficient baseline |

Neither judgment implies a cause. In control does **not** mean that the service
goal is met; Below goal does **not** by itself imply a recent change. The
supervisor can use the results to choose where to review records, not to rank
individual dispatchers, crews, or patients.

## 2. Data, filters, and targets

### Incident data and provenance

The dashboard ships three reproducible, fixed-seed, synthetic datasets spanning
October 16, 2025 through October 15, 2026:

| Dataset | Demonstration |
|---|---|
| Baseline | Seasonal variation and persistent geographic differences, with no planted process change |
| Station closure | Longer drive times in ZCTA 11368 beginning September 1, 2026 |
| Summer surge | Higher volume and dispatch delay in Monroe County during July–August 2026 |

Each included incident has an ID, ZCTA, urgency code, received/assigned/en-route/on-scene
timestamps, and cancelled, valid-time, and held flags. The loader requires the ID,
ZCTA, urgency, received/assigned/en-route timestamps, and cancelled and valid-time
flags. A completed call needs an on-scene timestamp and all four times in order
to enter timing statistics; held is optional and supports descriptive summaries. Real
2020 Census lookup and map data provide geographic context; they do not make
the incident data real. The complete column definitions, generation method,
and collection caveats are in [data/README.md](data/README.md).

### Selection

- The initial view uses the Baseline dataset, priority **1 Most urgent** (red),
  and the dataset's last 90 days: July 18–October 15, 2026. Analysis loads
  immediately; the user need not select dates first.
- From and To are inclusive calendar dates. The page offers one priority at a
  time: 1 Most urgent (codes 0–2), 2 Urgent (3–5), or 3 Less urgent (6–9).
  The API also accepts a comma-separated urgency list and warns when groups
  are mixed. There is no time-of-day filter.
- The map drills from state to county to ZCTA. Search and selection change the
  place described by the metrics and insights. The API accepts state, county
  FIPS, or ZCTA scopes. The earliest selectable From date with a full default
  60-day baseline is December 15, 2025.
- The normal baseline is the 60 days **before** From; it can extend to 120
  days if it contains fewer than 30 valid calls. It never overlaps the selected
  period. API clients can set `baseline_days`; the dashboard uses 60.

### Response target versus service goal

The **target** is a time limit for an individual call. The **goal** is the
share of valid completed calls that should arrive within their own target:
90% for every configured urgency and area type. A call exactly at its target
is on time.

| Priority | Urban | Suburban | Rural | Remote |
|---|---:|---:|---:|---:|
| 1 Most urgent | 8 min | 10 min | 14 min | 14 min |
| 2 Urgent | 15 min | 15 min | 15 min | 15 min |
| 3 Less urgent | 30 min | 30 min | 30 min | 30 min |

These values come from [config/targets.csv](config/targets.csv). They are
**illustrative placeholders**, not certified EMS standards. The priority-1
times are adapted from NFPA 1720 volunteer fire-service demand zones, whose
clock is different from OnScene's. Remote reuses the rural time because that
reference has no fixed remote time. The center must approve its own targets,
goal, area types, and local field mapping before using real records.

## 3. Dashboard behavior

### Overview and investigation

The state → county → ZCTA map offers two views: **Status**, based on the
judgments below, and **Late %**, a descriptive late-share heat map. Status
colors mean:

| Map tier | Meaning |
|---|---|
| Critical | Below goal **and** a confirmed recent deterioration |
| Watch | Ongoing gap, recent process change, or confirmed Below goal without enough baseline for a change judgment |
| Stable | Meets goal, unless a recent change takes precedence |
| Near goal | At least 30 valid calls and an inconclusive goal judgment, without a recent-change signal |
| Too few calls | Remaining places with fewer than 30 valid calls; no confident goal judgment |

The **Investigate** panel separates areas needing review from areas not
flagged. It shows the goal and control badges independently, a queue label,
sample size, interval, response-time tail, and other supporting evidence.
Within a queue, excess late-call volume determines order. A **watch** chip
means one high period did not satisfy the confirmation rule; it changes no
queue label or map tier. The overview also compares observed Below-goal
labels with the number expected by chance under the configured goal.

**Key Metrics** shows the selected place's on-time result, median, P95,
volume, and an optional AI investigation briefing. The briefing summarizes
existing aggregate evidence; it cannot create statistical judgments, assign
causes, or issue dispatch instructions. It requires a configured Ollama Cloud
provider, reports provider errors, and waits while replay is playing. AI text
may be wrong; verify it against the displayed numbers.

### Insights, replay, and help

The **Area comparison** tab compares area on-time rates and opens an Area
details panel for the fuller response profile. **Response trends** shows a
late-share p chart, or a descriptive observed trend when a ZCTA lacks enough
baseline history. Response details provide period evidence, call records,
descriptive stage times, and method notes. County signals describe the
county aggregate; they are not evidence of a signal in any one ZIP area.

For a sparse ZCTA, the observed-trend view shows late-call counts and rates
for valid completed calls, with pointwise 95% Wilson intervals by period.
It shows **no control limits, flagged periods, or process-change claim**.
The selected-range late count and denominator remain available as evidence.

**Simulation / Replay** reads the selected synthetic dataset as a simulated
daily feed. It starts at an applied From date, or at the dataset's scenario
start if none was applied. It keeps that start and its statistical baseline
fixed while advancing the end date one simulated day every three seconds.
It does not accept or modify calls. **How it works** opens a four-page
introductory guide; **Documentation**, beside it in the top bar, opens a searchable reference
with a table of contents. Closing either leaves the current dashboard
selection in place.

## 4. Statistical rules

All statistical calculations are implemented in [app/qc.py](app/qc.py) and
covered by [tests/test_qc.py](tests/test_qc.py); the interface displays their
results. OnScene defines `t_received` as EMS CAD incident creation and calculates
response time as `t_onscene − t_received`. A call is eligible for
timing only when it is not cancelled, has an on-scene timestamp, has
`valid_time = Y`, and has timestamps in order. A late call exceeds its
urgency/area target; a very late call exceeds twice that target. Cancelled,
invalid, missing, and out-of-order calls contribute to volume, not timing
statistics. Duplicate IDs, unreadable received times, and unknown ZCTAs or
urgency codes are dropped during loading and counted by reason in
`GET /api/health`.

### Service-goal judgment

For `n` valid completed calls, the on-time rate is `k / n`. Compare its
95% Wilson score interval with goal `g = 0.90`:

| Result | Rule |
|---|---|
| Meets goal | Interval lower bound ≥ `g` |
| Below goal | Interval upper bound < `g` |
| Inconclusive | Interval includes `g`, or `n < 30` |

Display the rate, interval, goal, and `n` when available. For the chance
reference, each eligible place is hypothetically at exactly the goal:
`X ~ Binomial(n, g)`. Find the largest on-time count whose Wilson upper
bound is below `g`; sum `P(X ≤ that count)` across places. This is an
expected count of chance Below labels, not a multiple-testing correction.

### Process-control judgment

The p chart tracks the fraction of **late** calls in each selected-period
subgroup. Build its center from the same place and priority in the fixed
pre-period baseline. Use the shortest of day, week, or calendar month whose
average expected baseline late count is at least five. If even a month cannot
meet that threshold, do not make a control claim.

Screen baseline subgroups once using the smaller exact binomial tail against
the initial baseline late share; remove subgroups with tail probability below
`0.00135`, then recalculate the center `p̄`. The baseline is unstable
if an extreme subgroup remains, more than 10% were removed, eight consecutive
subgroups lie on one side of the center, or a Pearson overdispersion test has
`p < 0.01`. With fewer than four baseline subgroups, report the screen as
**not checked**, not stable by proof.

For selected subgroup size `nᵢ`, set:

```text
center = p̄
UCLᵢ = min(1, p̄ + 3√(p̄(1 − p̄) / nᵢ))
LCLᵢ = max(0, p̄ − 3√(p̄(1 − p̄) / nᵢ))
```

A deterioration signal requires both a late share above UCL and an exact
upper-binomial-tail probability below `0.00135`. **Out of control**
requires at least two such signals, or one with probability below
`0.00135 / m`, where `m` is the number of selected subgroups. One
weaker signal is **In control + watch**. Lower-limit points can indicate
improvement but do not count as deterioration. If the baseline has fewer than
30 valid calls even after extension, no viable subgroup size, `p̄ = 0`
or `1`, or an unstable screen—or if no selected subgroup exists—report
**Insufficient baseline** rather than In control.

### Queue, supporting measures, and interpretation

| Goal judgment | Control judgment | Queue label |
|---|---|---|
| Below | Out of control | Act now: performance gap + recent signal |
| Below | In control | Ongoing gap |
| Meets or Inconclusive | Out of control | Recent process change: investigate |
| Meets | In control | Meets goal; no change signal |
| Any other combination | Any other combination | Needs more data / Inconclusive |

For sorting within a queue,
`excess_late = late_calls − (1 − goal) × valid_calls`. A large area
with a modest gap may rank ahead of a small area with a high rate. The
investigation panel can also include a confirmed Below-goal place whose
control baseline is insufficient.

Median, P90, and P95 response times use linear interpolation. Median and
P95 receive exact, distribution-free 95% order-statistic intervals when
enough observations exist; unavailable bounds display as n/a. Stage
summaries show median received → assigned, assigned → en route, and
en route → on scene times, plus held percentage, for period and baseline.
They are descriptive, not delay attribution. Secondary I-chart,
capability (overall/Ppk-like Cpk), and ANOM analyses are available through
the API or investigation evidence; none changes the goal, control, queue,
or map judgment.

## 5. Limits and responsible use

- The product clock starts at EMS CAD incident creation. Before using a real
  extract, confirm that its mapped `t_received` field has that meaning and
  validate the timestamps. A center using 911 answer time needs targets
  defined for that different clock; do not compare unlike clocks.
- Calls within a subgroup are modeled as independent Bernoulli trials with
  a common late probability. Shared county-day effects, seasonality, and
  overdispersion can violate that assumption. The screen catches some
  instability but does not seasonally adjust the chart or detect all drift.
- Low-volume ZCTAs may be Inconclusive or lack an evaluable baseline.
  Pointwise descriptive intervals do not replace a process-control baseline.
- Targets are illustrative; urgency stratification does not adjust for
  traffic, call mix, geography, staffing, or resources. A stage comparison
  or statistical signal is not a causal explanation, fairness finding,
  patient-outcome measure, or instruction to change dispatch operations.
- On the no-change synthetic dataset, county p-chart false signals were
  measured in 2/186 red and 3/186 yellow non-overlapping 90-day windows.
  A simulated +2% weekly drift was not detected. These checks describe
  this test generator, not real-world false-alarm rates or sensitivity.

OnScene has no login, database, real patient records, live CAD connection,
incident-entry form, ambulance assignment, route optimization, or
intervention optimizer. It is a demonstration tool, not an operational
emergency-response system.

## 6. Verification and references

The tests include known-answer and degenerate cases. For example, 85
on-time calls out of 100 have a 95% Wilson interval of approximately
`[0.76716, 0.90694]`; zero calls and fewer than 30 valid calls never
receive a confident service-goal judgment. All-zero or all-late baselines
and inadequate history never produce a false In-control result.

Run `.venv/bin/python -m pytest tests/test_qc.py -q` for statistical
checks and `.venv/bin/python -m pytest tests -q` for the backend suite.
`python data/validate.py` checks the datasets; the exact environment and
frontend build steps are in [app/README.md](app/README.md). The API fields
and examples are documented in [docs/api.md](docs/api.md). Task and design
history belongs in [CONTRACT.yaml](CONTRACT.yaml) and
[docs/plan.md](docs/plan.md), not in this product specification.
