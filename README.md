# OnScene

OnScene is a read-only EMS response-quality dashboard for a New York State
dispatch center's quality supervisor. It shows **where calls miss their
response-time target** and separates a persistent service gap from a recent
statistical change. Team Powerpuff Girls built it for the Cornell Six Sigma
Hackathon's Health Systems: Emergency Response prompt.

> **Demonstration only:** all incidents are synthetic. Census geography is
> real, but no patient, ambulance, dispatcher, or live CAD record is used.
> Replay is a simulation, not a live feed.

## What you can do

1. Choose a synthetic dataset and one urgency priority. The initial view
   uses `baseline`, **1 Most urgent** (red), and July 18–October 15, 2026.
   From and To dates are inclusive; results load without entering dates.
2. Scan the state map, then select a county or ZIP Code Tabulation Area
   (ZCTA). Switch between **Status** categories and descriptive **Late %**.
3. Open **Investigate** to review areas by queue label and excess late-call
   volume. The **Goal** and **Control** badges answer different questions.
4. Use **Area comparison** for geographic differences and **Response
   trends** for the selected place's late-share chart, period evidence,
   call records, and descriptive stage times. A ZIP without enough baseline
   history gets an observed trend—not control limits or a change verdict.
5. Try **Simulation / Replay** to move through synthetic days with a fixed
   statistical baseline. **How it works** is a short onboarding guide;
   **Documentation**, beside it, is a searchable in-dashboard reference.

The Key Metrics panel may show an AI-written investigation briefing when
Ollama Cloud is configured. It summarizes existing aggregate results; it
does not calculate the statistics or establish a cause. Provider errors are
shown, and the rest of the dashboard works without AI.

## The two judgments

The **target** is the maximum response time for one call. A completed,
valid call is late only when its received-to-on-scene time exceeds that
call's configured target. The **goal** is **90% of valid completed calls on
time**. Targets vary by priority and area type:

| Priority | Urban | Suburban | Rural | Remote |
|---|---:|---:|---:|---:|
| 1 Most urgent | 8 min | 10 min | 14 min | 14 min |
| 2 Urgent | 15 min | 15 min | 15 min | 15 min |
| 3 Less urgent | 30 min | 30 min | 30 min | 30 min |

These are illustrative placeholders in [config/targets.csv](config/targets.csv),
**not certified EMS standards**. The first row adapts NFPA 1720 volunteer
fire-service demand-zone times; its clock and area definitions differ from
OnScene's. Remote reuses the rural time.

| Judgment | Method | Possible result |
|---|---|---|
| **Goal:** is the on-time share clearly above or below 90%? | 95% Wilson interval; fewer than 30 valid calls cannot get a confident verdict | Meets goal / Below goal / Inconclusive |
| **Control:** has the late share risen above this place's earlier pattern? | p chart against a fixed, screened pre-period baseline | In control / Out of control / Insufficient baseline |

**In control does not mean Meets goal.** The queue combines both judgments:
**Act now** is Below goal plus a confirmed recent signal; **Ongoing gap** is
Below goal without a confirmed change; **Recent process change** is a
signal without a confirmed service gap. Other combinations read **Meets
goal; no change signal** or **Needs more data / Inconclusive**. A **watch**
chip marks one unconfirmed high period and does not change the queue.
The [statistical specification](SPEC.md) gives the exact eligibility,
interval, baseline-screen, signal, ranking, and low-volume rules.

## Try the three datasets

The three fixed-seed files cover October 16, 2025–October 15, 2026 and
contain about 1.82 million invented calls each. The steps below use
**priority 1 (red)** and the dashboard's 60-day pre-period baseline.
Select the dataset, set the stated dates where needed, and pick the place
on the map or through search.

| Dataset | Place and dates to inspect | Expected behavior |
|---|---|---|
| **Baseline** — no planted process change | Initial state view, July 18–October 15, 2026 | Counties include persistent **Ongoing gaps**; the state Meets goal but has **Insufficient baseline** for its daily control chart. One county (Erie) and one ZIP (11212) show chance false alarms. A clean synthetic file does **not** guarantee zero statistical signals. |
| **Station closure** — longer drive times in Corona, Queens from September 1 | Choose `station_closure`, ZIP **11368**, September 1–October 15, 2026 | **Act now:** 72.2% on time among 407 valid red calls, Below goal and Out of control. Both September and October exceed the upper control limit. In the Baseline file over those same dates, the ZIP is Inconclusive and In control. |
| **Summer surge** — more calls and dispatch delay in Monroe County during July–August | Choose `summer_surge`, **Monroe County (36055)**, July 1–August 31, 2026 | **Act now:** 80.2% on time among 5,285 valid red calls, Below goal with 10 weekly deterioration signals. The Baseline file over the same dates Meets goal and is In control. |

**Date choice matters.** In `summer_surge`, Monroe is **Needs more data /
Inconclusive** for a control judgment in the default July 18–October 15
window: its preceding baseline includes the surge and fails the stability
screen. From September 1–October 15 it Meets goal, but the earlier surge
still makes its pre-period baseline unsuitable. This is a safeguard, not a
missing scenario. For the clearest demonstration, use the July–August dates
in the table.

For replay, choose `station_closure` and ZIP 11368, then **Start replay**.
Without an applied From date it begins August 25. A watch period appears
September 3; the control judgment turns Out of control September 4 and
the queue turns Act now September 8. In `summer_surge`, replay begins
June 25; Monroe turns Out of control July 2 and Act now July 5. If you
apply a From date first, replay starts there instead. The baseline stays
fixed as the simulated end date advances.

The full codebook, generation assumptions, observed results, and cleaning
test sample are in [data/README.md](data/README.md). Synthetic signals are
not claims about real EMS operations.

## Run locally

From the repository root, with Python 3 and Node.js/npm installed:

```bash
python3 -m venv .venv
.venv/bin/pip install -r app/requirements.txt
(cd app/frontend && npm ci && npm run build)
bash app/testme.sh
```

Open the local address printed by `testme.sh`. The first start loads and
derives three large compressed files, so allow a little time for data to
appear. The API is available at `/docs`.

Run checks from the repository root:

```bash
.venv/bin/python -m pytest tests -q
(cd app/frontend && npm test)
.venv/bin/python data/validate.py
```

The read-only FastAPI routes, parameters, and examples are in
[docs/api.md](docs/api.md); backend setup is in [app/README.md](app/README.md).
The core inputs are incident ID, ZCTA, urgency, four timestamps,
`cancelled`, `valid_time`, and `held`. The page filters by dataset,
inclusive From/To dates, one urgency, and state/county/ZCTA. API clients
can additionally choose `baseline_days` or multiple urgency groups;
the API warns when groups are mixed. There is no time-of-day filter,
incident-entry endpoint, or ambulance-assignment function.

## Data and interpretation limits

- The meaning of `t_received` (original 911 receipt or EMS CAD creation)
  has not been confirmed. Validate it before comparing with a real standard.
- Calls share county-day and seasonal effects. The p-chart stability screen
  catches some extra variation but does not seasonally adjust the data or
  guarantee detection of slow drift.
- Sparse ZIPs may be Inconclusive or lack a usable baseline. Observed-trend
  intervals describe the data but do not establish a process change.
- Stage medians, AI prose, and geographic comparisons are descriptive. The
  tool makes no causal, fairness, patient-outcome, or intervention claim.
- The baseline synthetic file has no planted change, yet 2/186 red and
  3/186 yellow county-windows were Out of control across three
  non-overlapping 90-day windows. The sensitivity and false-alarm checks
  are documented in [data/README.md](data/README.md).

The data and methods are for demonstration, not operational dispatch.
Project decisions and task history live in [docs/plan.md](docs/plan.md)
and [CONTRACT.yaml](CONTRACT.yaml).
