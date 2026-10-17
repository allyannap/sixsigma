# OnScene showcase script (about 3 minutes)

Team Powerpuff Girls · Cornell Six Sigma Hackathon, Health Systems: Emergency Response.
Live app: https://connect.systems-apps.com/content/1fd1035a-58f5-461d-8e00-9bb162e35770/
Every number below comes from the README's "Try the three datasets" table (priority 1, red calls).

**Before you start:** open the live app, wait for the map colours to load, Investigate sidebar closed,
dataset **baseline**, priority **Most urgent**. Have a second tab open on the README.

---

## 1. The problem and the user (20 s)

> "A 911 center usually looks at a monthly average response time. Averages hide the slow calls and hide *where*
> they happen. OnScene is for the **EMS quality supervisor**: at the start of a review it answers *which counties
> and ZIP areas need review, and why*: are they **below the on-time goal**, showing a **new statistical change**,
> or both?"

Point at: the map colours and the red **Investigate** tab.

## 2. Two separate questions (40 s), on the baseline dataset

> "Each place gets two judgments that we never mix up."

1. **Goal (target check):** "Is the share of calls on time clearly above or below **90%**?" We use a **95% Wilson
   interval**: green **Meets goal** if the whole interval is above 90%, red **Below goal** if it is all below,
   amber **Inconclusive** if it straddles 90%. Point at the **On time** number: statewide **91.8% of 150,495 valid
   calls** is green.
2. **Control (change check):** "Has the late share risen above this place's *own* history?" A **p chart** against
   a fixed, screened 60-day baseline before the period.

> "In control does not mean good service. A county can be stably bad, which is an **Ongoing gap**, a planning
> problem, not a sudden change."

Open the **Investigate** tab: places are ranked by urgency (Act now, Recent change, Ongoing gap). Hover a county
on the map to show its tooltip.

## 3. A planted problem: station closure (45 s)

Dataset **station_closure**, search **11368** (Corona, Queens), dates **Sep 1 to Oct 15, 2026**, Search.

> "We planted a station closure: drives in this ZIP take 60% longer from September 1. OnScene says **Act now**:
> **72.2% on time** of 407 calls, **Below goal** *and* **Out of control**, with September and October both above
> the control limit. On the clean baseline file, the same ZIP and dates read Inconclusive and In control, so the tool
> finds the change we planted and not something that was already there."

## 4. "Real time": replay (35 s)

Clear the dates (or reset), keep **station_closure** and ZIP **11368**, press **Start replay**.

> "We have no live CAD feed, so replay plays the year forward one day at a time, recomputing everything. The
> baseline stays **fixed**, so the change cannot hide inside it. Watch 11368: a **watch** flag on **Sep 3**, **Out
> of control Sep 4**, **Act now Sep 8**: about a week after the closure, a supervisor would have been told."

## 5. Second planted problem: summer surge (20 s)

Dataset **summer_surge**, **Monroe County**, dates **Jul 1 to Aug 31, 2026**.

> "A summer surge: 30% more calls and units held. **Act now**: **80.2% on time** of 5,285 calls, with **10 weekly
> deterioration signals**. The clean file over the same dates Meets goal and is In control."

## 6. Close (15 s)

> "Inputs are one CAD export with standard columns that every center already records, and targets come preset:
> nothing to measure. Every statistic lives in one tested Python file. 227 Python tests check known answers and
> edge cases, plus 129 page tests. The repo is public and runs with one command."

---

## Likely judge questions: one-line answers

| Question | Answer |
|---|---|
| Why a Wilson interval, not just the rate? | Small areas have few calls; the interval says whether a place is *clearly* below 90% or just noisy. Under 30 valid calls we refuse a verdict (Inconclusive) instead of guessing. |
| Why a p chart, and why against its own baseline? | Late calls per period are counts out of n calls (binomial), which is what a p chart is for. Comparing a place with its own recent past separates a *new* change from a long-standing gap. |
| Why not a rolling baseline? | A rolling window drifts into the change it should detect; in testing it hid both planted problems. The baseline stays fixed just before the period. |
| How many false alarms? | Measured on the clean file: 2 of 186 red and 3 of 186 yellow county-windows read Out of control by chance (README, Data and interpretation limits). We require two signals, or one very strong one, and correct for testing many places. |
| Why P95, not the average? | The average hides the slowest calls, which are the ones that can cost lives. P95 = 1 call in 20 waited longer. |
| What does Cpk tell me here? | It is secondary and never sets a label: it assumes lognormal times. The decisions use the on-time interval and the p chart. |
| Where do targets come from? | Illustrative placeholders in `config/targets.csv`, adapted from NFPA 1720 for the most urgent calls; not certified standards and configurable per center. |
| What does the user have to provide? | One CAD export: ZIP area, urgency code, the received / assigned / en-route / on-scene times, cancelled and valid-time flags. Nothing to measure or estimate. |
| When does the clock start? | When the call is created in the EMS CAD (`t_received`) until the first unit is on scene. A center using 911 answer time maps that field and uses targets for the same clock. |
| Is the data real? | No. All incidents are synthetic, built by a fixed-seed generator on real 2020 Census geography, with planted stories so the tool can be checked. |
| Does it blame dispatchers or crews? | No. It reviews the response process by place; there are no dispatcher or unit IDs, and no causal or fairness claim. |
