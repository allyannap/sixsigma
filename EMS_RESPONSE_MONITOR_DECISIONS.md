# EMS Response Monitor — Approved Decisions & Agent Implementation Brief

**Project:** Powerpuff Girls · Cornell Six Sigma Hackathon 2026  
**Source document:** `README.md` (design as of October 16, 2026)  
**Purpose:** Update the project specification and implementation to reflect the decisions below. Treat these as product requirements, not as claims that features already work.

## 1. Product goal and scope

Build a **read-only quality-control monitoring dashboard** for a **New York State EMS dispatch-center quality supervisor**. The tool analyzes ambulance response-time performance, identifies geographic areas needing investigation, detects both persistent service gaps and recent process changes, and helps locate the recorded response stage associated with unusual delay.

- **Geography: New York State**, with drill-down **state → county → ZIP Code Tabulation Area (`zcta`)**. Do **not** narrow to NYC.
- **User:** quality supervisor, **not** the dispatcher assigning an ambulance.
- **Input to the monitoring dashboard:** preloaded **synthetic incident data from the backend**. No user-entered incidents, manual logging forms, or ambulance-assignment controls.
- **Live demo:** play back backend synthetic incidents as a **simulated stream**; label this **Simulation / Replay**, not live FDNY/CAD data. Update the monitor as replayed events arrive.
- **Core management decision:** Which areas need review? Are they below the service specification, experiencing a new statistical change, or both? What recorded interval deserves investigation?
- **No what-if improvement simulator or intervention ranking in this version.** These are deferred until the team has capacity.

## 2. Approved decisions by issue

| Issue | Approved decision | Required change |
|---|---|---|
| **1 — Geography** | Keep **New York State**. | Retain statewide map, county and ZCTA drill-down, and statewide synthetic datasets including Monroe County. |
| **2 — Zone flags** | Flag areas needing resolution; **separate specification conformance from statistical control**. | Display **Below target / Meets target / Inconclusive** separately from **In control / Out of control / Insufficient baseline**. Do not equate absence of an alert with meeting the target. |
| **3 — Cpk** | **On-time proportion is the primary performance metric.** | Use actual on-time percentage and confidence interval for the service-goal decision. Cpk may be secondary, clearly assumption-dependent, and must not drive the main status flag. |
| **4 — Delay investigation** | Retain the user-facing title **“What Held Up the Call.”** | Show measured response-stage delays and possible explanations, **not proven causes**. |
| **5 — Geographic comparison** | Add/use **urgency filters**. **Time-of-day filtering/adjustment is not required** for the 24-hour MVP. | Compare within urgency group; present any remaining geographic comparison as **urgency-stratified, descriptive**, not adjusted for time of day. Do not claim equivalent operating conditions or causal fairness conclusions. |
| **6 — What-if** | **Remove from MVP**; consider later. | Remove its dashboard card, `/whatif` API, simulation logic, and claims about which fix is best. Remove “best fix” expectations from test-dataset documentation. |
| **7 — Google ETA** | Report **“unusual travel-time difference.”** | Optional, only when an appropriate Google ETA exists. Synthetic data must allow ambulances to be both faster **and slower** than Google, with realistic variation. No simple pass/fail claim. |
| **8 — Real-time logging** | **No user logging feature.** Data sits in the backend. | Remove manual incident input/UI and any requirement for user-facing `POST /calls`. Offer simulated backend event replay and read-only monitoring instead. |
| **9 — Sparse areas** | Show **sample counts and confidence intervals**. | Allow a longer date window or aggregation to county/state when ZCTA sample sizes are sparse. Label unreliable estimates **Inconclusive / Insufficient data**, not “good.” |
| **10 — SPC design** | Follow the previously recommended approach. | Clearly document a stable historical baseline; prioritize a validated p-chart; stratify by urgency; check seasonality, subgroup size, and dependence; avoid implementing many Nelson tests without validation. |
| **11 — Synthetic data** | Follow the previously recommended validation approach. | Keep three known-scenario synthetic datasets; test expected patterns **and** false alarms; use fixed seeds, a codebook, and data-validation scripts. If feasible, add a separate real-data compatibility check, never present synthetic data as real. |

**Decisions not explicitly supplied:** Issues 12 (overall 24-hour scope) and 13 (exact response-time start definition). Keep the current documented response-time definition *provisionally* and flag its mapping/validation as an open dependency. Do not silently redefine timestamps or expand the feature scope.

## 3. Exact performance and control logic

### 3.1 Definition of a late call

For a valid completed incident:

- `total_wait_seconds = t_onscene - t_received`, with timestamp semantics validated against the source/schema.
- `late = total_wait_seconds > target_seconds(urgency_code)`.
- The targets in `config/targets.csv` (red 8 min, yellow 15 min, green 30 min; 90% on-time goal) are **configurable placeholders**, not certified statewide standards.
- Calculate `n_valid`, `n_on_time`, `on_time_rate = n_on_time / n_valid`, `late_rate = 1 - on_time_rate`, median, P90/P95, and P95 uncertainty.
- Canceled, invalid, missing, or nonchronological records must not silently enter completed-response statistics.

### 3.2 Two independent judgments (do not conflate)

**A. Specification performance — “Are calls meeting the service goal?”**

Use the on-time fraction and a documented **95% binomial confidence interval** (e.g., Wilson; use one consistent approach). Against the configured on-time goal `g`:

- **Meets target:** confidence-interval **lower bound ≥ `g`**.
- **Below target:** confidence-interval **upper bound < `g`**.
- **Inconclusive:** interval crosses/includes `g`, sample too small for the requested precision, or required data are invalid.

Show the **observed on-time rate, goal, valid sample count, and confidence interval** even when the status is inconclusive. “Not proven below target” **must not** be labeled “Meets target.” The response-time threshold per call is the specification; the confidence interval judges the **proportion** meeting it.

**B. Statistical control — “Has the process changed relative to its own history?”**

- Monitor **late-response proportion** using a p-chart with a fixed historical baseline for the selected geography and urgency group.
- Baseline: initially the **preceding 60 days**, optionally extend to **120 days** for low-volume areas; validate adequacy and stability before using its limits.
- For subgroup `i` of size `n_i`: `CL = p_baseline`; `UCL_i = min(1, p_baseline + 3 * sqrt(p_baseline*(1-p_baseline)/n_i))`; `LCL_i = max(0, p_baseline - 3 * sqrt(...))`.
- Label **Out of control** if a documented, validated SPC rule fires; **In control** if sufficient baseline/current data exist and no configured rule fires; otherwise **Insufficient baseline / Inconclusive**.
- Use daily subgroups when adequate, otherwise weekly; check for case-mix changes, seasonality, overdispersion/dependence, and low sample sizes. Do **not** imply that statistical control means good service.
- I-MR on log times and additional Nelson rules are **secondary**; implement only if correctly validated and time permits.

**C. Zone action flags — derived from A and B**

| Specification result | Control result | Dashboard queue label |
|---|---|---|
| Below target | Out of control | **Act now — performance gap + recent signal** |
| Below target | In control | **Ongoing gap** |
| Meets target or Inconclusive | Out of control | **Recent process change — investigate** |
| Meets target | In control | **Meets goal; statistically stable** |
| Any state with inadequate evidence for a firm interpretation | Insufficient baseline, or indeterminate specification with no other confirmed signal | **Needs more data / Inconclusive** |

Retain the **two original independent badges** alongside any combined queue label. Do not use “On track” alone for a zone whose specification result is inconclusive. Record the precise trigger, relevant dates, and evidence for each alert. A high-priority individual delay can be shown separately from an SPC signal.

## 4. Required dashboard behavior

1. **State → county → ZCTA map:** color by a clearly defined selected metric or queue status. Show sample count, observed on-time rate, P95, and both specification/control badges. Provide back-navigation.
2. **Summary card:** counts by decision status; median/P95 and bootstrap confidence intervals, with numerator/denominator for on-time rate.
3. **Date and urgency filters:** red/yellow/green, date period, state/county/ZCTA. **No time-of-day filter or adjustment in MVP.** Do not claim time-of-day adjustment.
4. **Geographic comparison (ANOM if retained):** show observed comparisons **within urgency groups**, sample sizes, and limitations. ANOM is secondary to clear direct service-performance metrics; no claim of causal geographic unfairness.
5. **p-chart:** late-call proportions through time with baseline CL and subgroup-varying limits, documented rule signals, and historical baseline explanation.
6. **Optional I-MR:** individual response-time changes on a log scale, only after appropriate statistical tests/assumption checks.
7. **Ambulance vs Google:** only when the optional `eta_google_s` is available and comparable to actual **en-route-to-on-scene** duration. Show `actual_enroute_seconds - eta_google_s`, its distribution, and the label **“Unusual travel-time difference.”** A positive difference is an investigation clue, not automatic failure. If provenance/comparability is unknown, show “Comparison unavailable / interpret cautiously.”
8. **“What Held Up the Call”** (keep exact title): break down `received → assigned`, `assigned → enroute`, `enroute → onscene`; compare with appropriate historical stage medians. Identify which stage has the largest **excess recorded time**. Show `held` only where explicitly present. Phrase explanations as **potential contributors requiring review**, not confirmed root causes. Make total-duration arithmetic consistent; avoid treating a simplistic fault-tree OR gate as causal proof.
9. **Read-only simulated monitoring:** backend supplies a synthetic incident stream and current statuses. Dashboard updates as the stream advances; no incident-entry forms, editable dispatch records, ambulance ranking, or unit-assignment recommendation. Explicitly label the source **Synthetic — simulated replay**.
10. **Investigation output:** list flagged state/county/ZCTA areas with the corresponding target-performance evidence, SPC signal (if any), sample size, timing-stage findings, and suggested **topics to investigate**, not an automatically selected intervention.

**Removed:** “Which fix helps most” card, intervention recommendations/rankings, what-if calculations, `/whatif`, public/manual `POST /calls`, user logging forms.

## 5. Synthetic data requirements

Preserve the three planned files and statewide geography:

| File | Known scenario | Required validation |
|---|---|---|
| `data/incidents_baseline.csv.gz` | Normal seasonal pattern and persistent rural long-trip gaps | Validate plausible rates and stable baseline behavior; count/measure false alerts rather than asserting zero by fiat. |
| `data/incidents_station_closure.csv.gz` | From Sep 1, 2026, simulated travel/ETA increase in ZCTA 11368 (Corona, Queens) | The generated **observed response times** must reflect the intended disturbance if we expect SPC to detect it; do not change only Google ETA. Flag only if actual calculated evidence crosses defined criteria. |
| `data/incidents_summer_surge.csv.gz` | Jul–Aug 2026 Monroe County volume +30% and increased held/assignment pressure | Validate higher arrivals, held counts, stage delays, and expected quality signals; don't claim a specific intervention is best. |

Additional generator/test requirements:

- Use **fixed seeds**; retain documented dates, assumptions, population scaling, schema and geography mappings.
- Generate realistic variation in actual en-route time relative to Google ETA: both negative and positive differences, including slow outliers. Do **not** force every ambulance to beat Google.
- Include missing/invalid timestamps, cancellation, sparse-ZCTA cases, no-change periods, and sudden-shift periods as controlled test fixtures (these can be smaller than the three main files).
- Include automated checks for time ordering, valid urgency mapping, ZCTA-to-county lookup, sufficient baseline history, and consistency of derived intervals.
- Validate **sensitivity to the planted changes** and **false-alarm behavior on no-change data**. Tests should be statistical and deterministic as appropriate; don't require every normal run to have zero false alarms.
- Deliver `data/README.md` as a codebook defining each column, units, source or synthetic origin, allowed values, generation assumptions, and rebuild command.
- If a real public EMS extract is available, use it as a **separately labeled compatibility/sanity test**; do not imply the three synthetic datasets are historical data.

## 6. Implementation and documentation instructions for the coding agent

1. **Inspect the current repository** before editing. Preserve implemented, functioning work unless it conflicts with these decisions. Do not claim incomplete components work.
2. Update `README.md`, `SPEC.md`, `docs/plan.md`, the test-data codebook, architecture diagram, and API documentation to reflect this brief. Fix all references to *best intervention*, *what-if*, *live CAD*, *manual input*, and unsupported causal claims.
3. Implement and test, in this order: (a) data validation/timestamp definitions; (b) on-time metrics and binomial confidence intervals; (c) p-chart and specification/control status logic; (d) map/drill-down and filters; (e) delay-stage investigation; (f) read-only backend replay; (g) optional ANOM, I-MR and Google comparison after the core is sound.
4. Update the existing FastAPI/React architecture where appropriate. Expose only the read-only query/stream endpoints needed for the interface. **Do not expose a user-facing manual call-logging workflow**. A backend replay mechanism may generate new events internally.
5. Ensure the three synthetic datasets rebuild and validate; include **known-answer unit tests** and edge-case tests for each core statistical function.
6. Keep the final demo reproducible from a fresh checkout with documented dependencies, commands, expected outputs, and a clear **synthetic-data disclosure**. Preserve the planned one-command verification target if feasible.
7. Update the build-status table accurately after implementation; distinguish **implemented**, **tested**, **planned**, and **deferred**. Do not mark features done without passing tests.

### Minimum acceptance tests

- [ ] State → county → ZCTA navigation and urgency/date filtering work on backend synthetic data.
- [ ] Every geographic output shows `n`, on-time rate, confidence interval, P95, and clear specification/control states.
- [ ] Below-target, meets-target, and inconclusive classifications are correct on hand-worked test cases; **inconclusive is never silently marked successful**.
- [ ] p-chart limits respond correctly to varying subgroup sizes; baseline history is not contaminated by the selected monitoring period.
- [ ] Simulated arrivals update a **read-only** monitoring dashboard; there is **no user incident-entry feature**.
- [ ] “What Held Up the Call” reports correct interval arithmetic and uses noncausal investigation wording.
- [ ] Google comparison is optional, based on comparable intervals, and handles ambulance-faster and ambulance-slower records.
- [ ] No what-if card, intervention-ranking recommendation, or `/whatif` API remains in the MVP.
- [ ] The three datasets reproduce from fixed seeds, have a codebook, and pass validation/expected-signal checks.
- [ ] README setup and tests run from a fresh clone; the tool is demonstrable and clearly marked as synthetic.

## 7. Explicit boundaries and unresolved dependencies

- **Not in scope:** actual ambulance assignment; ranking personnel; route optimization; patient outcomes; what-if intervention optimization; user-entered incident logging; actual live CAD connection; time-of-day filters or adjusted time-of-day analysis.
- **No causal attribution:** report timing-stage deviations and evidence; do not claim dispatcher blame or a proven cause.
- **No unsupported fairness claim:** urgency filters make comparisons more relevant but **do not** control for traffic, shift, seasonal mix, call complexity, or resource availability.
- **Timestamp definition pending verification:** Preserve the existing `t_onscene - t_received` metric until source semantics are confirmed, and explicitly identify whether `t_received` means original 911 call receipt or EMS CAD incident creation. Validate consistent semantics across test data and any real extract.
- **Service targets remain illustrative** until the team documents an authoritative source or customer-configured policy.
- **Google ETA provenance pending:** the CSV lacks ambulance origin coordinates; do not manufacture Google estimates for real incidents. Synthetic estimates must be explicitly identified as generated.
- **High-complexity features:** Cpk/ANOM/I-MR should not undermine the correctness or delivery of the core on-time-rate + SPC monitoring workflow.

**Definition of success:** A New York State EMS quality supervisor can open the synthetic monitoring dashboard, locate areas with poor response-time performance, determine whether they meet the service specification and whether their process is statistically stable, inspect abnormal timing stages, and receive a defensible investigation signal—all without entering dispatch data or using a what-if tool.
