# SPEC: Six Sigma Hackathon team project

What your tool IS. Your agent reads this before every task. Where the code and this file
disagree, the code is the bug: change this file first, then the code.

Most of this page is already decided by the event and the [rubric](docs/criteria.md).
**Only the `FILL IN` lines change, and you do not have to write them by hand:** describe your app and ask your agent to update them. They depend on the prompt your team picks at kickoff
(prompts are secret until then, see [`docs/prompts.md`](docs/prompts.md)) and on your team.
The examples after each `FILL IN` show the shape of an answer. They are not hints about the prompts.

The team's design sources: the data schema ("EMS Response Monitor: Data Schema", Oct 16, 2026) is the
source of truth for files, columns, filters and statistical rules; the mockup ("EMS Statistical Analysis
Card") sets the look and the plain-language wording. Where they differ, the schema wins, except that the
mockup's ANOM section is in the core (team decision, Oct 16).

## 1. Team and prompt
- **Team name:** Powerpuff Girls
- **Track:** on-campus (24 hours). See [`docs/schedule.md`](docs/schedule.md).
- **Prompt we chose:** Health Systems: Emergency Response (the [Devpost](https://six-sigma-hackathon.devpost.com/) challenge page lists no prompt number).
  > Ambulance dispatch to on-scene times are varying wildly across city zones, but the 911 center only looks at monthly averages, missing fatal outliers, not where or why these failures occur. Design a statistical tool to help manage dispatchers, response time logging in real-time, generate analyzes, and flag zones that are in need of resolution.
- **Our public repo:** https://github.com/allyannap/sixsigma

## 2. User and use case (rubric: scope 5, user and use case 5)
- **User:** the 911 / EMS dispatch center's quality supervisor (not dispatchers mid-call, not the public).
- **Decision the tool helps them make, and when:** at the start of each day, for New York State, a county or one ZIP code area: which places need attention, whether a delay is a real recent change or a long-running gap, which step of the response the extra minutes come from (911 center, crew, or the drive), and which fix to fund (post an ambulance closer, add an ambulance, speed up the 911 center or the crew).
- **Why this matches the prompt:** it replaces the monthly average with per-place control charts, tail percentiles and every individual call, so the outliers the average hides are flagged by place ("where") and traced to a step ("why").

## 3. Inputs (rubric: minimal inputs 5)
Only what this user can actually measure or already knows. Fewer is better; every input a user
cannot measure costs points.

| Input | Type and units | Where the user gets it |
|---|---|---|
| `incidents.csv`, one row per 911 EMS call. Required: `incident_id`, `zcta`, `urgency_code`, `t_received`, `t_assigned`, `t_enroute`, `t_onscene` (empty if cancelled), `disposition`, `valid_time` | text IDs; 5-digit ZIP area; integer 0-9; ISO 8601 datetimes with the New York offset; Y/N | the 911 center's computer-aided dispatch (CAD) export; columns follow NYC's public EMS Incident Dispatch Data |
| Optional columns: `eta_google_s` (Google drive estimate with traffic at assignment), `held` (call waited because no ambulance was free) | integer seconds; Y/N | `held` is in CAD today; `eta_google_s` needs a Google Routes API call at assignment time. Without them, cards 7 and parts of 8 are hidden |
| `config/targets.csv`: per urgency code, `urgency_group` (red/yellow/green), `target_s`, `goal_on_time_pct` | seconds; percent | set once by the center (placeholders: red 480 s, yellow 900 s, green 1800 s, all 90%) |
| Filters on every request: `from`, `to`, `urgency`, `level` (state/county/zcta), `id`, `baseline_days` | dates; red/yellow/green; FIPS or ZCTA; days (default 60 before `from`) | picked on screen |

Lookups the tool ships with (the user supplies nothing): `data/lookup/zcta_county.csv`, `data/lookup/counties.csv`
(2020 Census) and the map shapes in `geo/`.

## 4. The statistics, and why (rubric: valid QC analysis 25)
Say the method in words before any code exists. Load the `stats-first-steering` skill first.
- **Method:** the headline measure is `total_s = t_onscene - t_received` (the patient's whole wait); a call is **late** when `total_s > target_s` for its urgency code. Calls that are cancelled, have no `t_onscene`, or `valid_time = N` count in volume only. Per place (state, county, or ZCTA), within one urgency group, with limits from the **baseline** (the 60 days before the selected range, stretched to 120 if under 30 calls):
  1. **p chart** of the fraction late, subgroups by day (by week if the place averaged under 10 calls a day in the baseline): CL = p-bar from the baseline, limits p-bar +/- 3 sqrt(p-bar (1 - p-bar) / n_i), LCL floored at 0; signal = a point above its UCL; plus a run test (9 points in a row above CL).
  2. **I-MR chart on ln(minutes)** of every call, in time order: CL = baseline mean of ln(minutes), sigma = MR-bar / 1.128, I limits CL +/- 3 sigma, MR UCL = 3.267 MR-bar. The 8 Nelson tests are run; tests 1 (beyond 3 sigma), 2 (9 in a row on one side) and 5 (2 of 3 beyond 2 sigma, same side) raise alerts.
  3. **One-sided Cpk on ln(minutes)** against ln(target_s / 60): Cpk = (ln USL - mean) / (3 sigma), sigma = MR-bar / 1.128. Upper 95% bound (Bissell's approximation): Cpk + 1.645 sqrt(1/(9n) + Cpk^2 / (2(n - 1))). Bar = z(goal) / 3 (0.4272 for a 90% goal).
  4. **P95 of total wait** (linear interpolation) with a bootstrap 95% interval: 2,000 resamples, 2.5th and 97.5th percentiles, fixed seed.
  5. **ANOM** (analysis of means) on ln(minutes) across the places at the current level: decision limits grand mean +/- h sigma-p sqrt((N - n_i) / (N n_i)), pooled within-place sigma-p, h = z(1 - 0.05 / (2k)) (Bonferroni; 2.7344 for k = 8). One-way ANOVA F shown alongside.
  6. **Fault tree** (series OR) for each late call: "no ambulance free" if `held = Y`; otherwise the basic event with the largest excess over the place's baseline median among 911 center (`dispatch_s`), crew (`turnout_s`), long trip (`eta_google_s`) and drive slower than Google (`drive_s - eta_google_s`).
  7. **What-if replay**: recompute % late, P95 and late calls avoided on the selected calls with one step changed (drive shortened by pct, held waits removed, `dispatch_s` or `turnout_s` shortened by pct), everything else held fixed.
- **Status per place:** Act now = too slow overall AND changed recently; Recent change = changed only; Ongoing gap = too slow only; On track = neither; Not enough calls = under 30 calls in the selection. "Too slow overall" = the Cpk upper bound is below z(goal)/3. "Changed recently" = a p-chart point above the UCL, or I-chart test 1, 2 or 5 fires, in the selected range.
- **Why it fits the use case:** the failures the prompt cares about live in the right tail, so the tool charts the fraction late and every single call instead of the mean, uses limits from the place's own recent history, and splits each late call into the step that caused it.
- **Assumptions and how the tool checks them:** (1) late/not late is binomial within a stable place-day (p chart); days with n p-bar < 5 are labeled low volume. (2) Response times are right-skewed, so I-MR and Cpk run on ln(minutes), which is closer to normal; the demo shows a histogram of ln(minutes). (3) Calls are independent in time order (I chart); the MR chart shows autocorrelation if present. (4) The baseline is itself in control; the tool warns if a baseline point is outside its own limits. (5) Rows with missing or out-of-order times are excluded from time statistics and counted.
- **Known-answer check** (each is a test in `tests/`; all arithmetic shown in `docs/plan.md`):
  - p chart: 5 days, n = 20 each, late = 2, 3, 1, 4, 10, all baseline. p-bar = 0.20, sigma = sqrt(0.2 * 0.8 / 20) = 0.08944, UCL = 0.4683, LCL = 0. Only day 5 (p = 0.50) signals.
  - I-MR: ln-minutes 1.0, 1.2, 0.9, 1.1, 1.3. MR = 0.2, 0.3, 0.2, 0.2, MR-bar = 0.225, sigma = 0.19947, CL = 1.1, UCL = 1.6984, LCL = 0.5016, MR UCL = 0.7351. No signals.
  - Cpk on the same data with target 8 min: ln 8 = 2.0794, Cpk = 0.9794 / 0.5984 = 1.6368, upper bound = 1.6368 + 1.645 * 0.5976 = 2.6197.
  - ANOM: groups A = 1, 2, 3, 2; B = 2, 3, 4, 3; C = 5, 6, 7, 6. Grand mean 3.6667, sigma-p = sqrt(6 / 9) = 0.8165, h = z(1 - 0.05/6) = 2.3940, limits 2.8687 to 4.4647: A (2.0) faster, B (3.0) inside, C (6.0) slower. ANOVA F(2, 9) = 26.0.
  - P95 of 1, 2, ..., 20 = 19.05.
  - Degenerate: constant data (MR-bar = 0, sigma = 0) returns Cpk = None with "no variation: Cpk undefined", never inf; p-bar = 0 returns no flags and "no late calls in baseline"; n = 1 returns I chart point with no MR and "too few calls"; bootstrap of constant data returns [c, c].

Fixed for every team:
- The statistic lives in **one plain, tested function** (`app/qc.py` or `app/qc.R`). The API, app or
  package only calls it and displays the result. No statistics inside UI code.
- Every statistic has a test against a known answer and a degenerate case (constant data, n = 1, missing values).
- You can explain every number the tool prints. If you cannot, it is not done.

## 5. Delivery (rubric: working tool 25)
- **Stack:** dashboard: FastAPI (Python) back end serving `GET /summary`, `/pchart`, `/imr`, `/anom`, `/google`, `/delays`, `/whatif` and `POST /calls`, with a React front end. Every statistic is in `app/qc.py`.
- **Starting demo:** `demos/fastapi/`, plus `demos/reactfront/` as `app/frontend/`.

Fixed for every team:
- Start from **one** demo in `demos/`, copied to `app/`. Keep its four-script contract
  (`testme`, `manifestme`, `deployme`, `README.md`); `testme` starts the tool with one command.
- Deployed on the course **Posit Connect** server with a public URL (publisher key handed out at the
  event). Deploy early: copy one workflow from
  [`.claude/skills/connect-publish/workflows/`](.claude/skills/connect-publish/workflows/).
- A small tool that runs beats a large tool that does not.

## 6. Outputs
- **What the user sees:** one page read top to bottom, as in the mockup: (1) a map of New York's counties, drilling down to ZIP areas, filled in the selected urgency's color (darker = more late), with a flag or outline per status, gray for "Not enough calls (<30 calls)"; a summary card (places needing attention, % late, median wait, median dispatch-to-scene, P95). (2) ANOM: which places are consistently slower than the rest. (3) For the selected place: the p chart and the I-MR chart with test results, read as "a real change, or a few bad days?". (4) Where the extra minutes come from: step medians, ambulance vs Google, and the fault-tree count of what held up each late call. (5) Which fix helps most: the what-if replay. How to read it: "a flag means this place is slower than its own recent history explains; the cards below say which step to look at first."

## 7. Test datasets and codebook (rubric: demo 10, datasets 5, codebook 5)
2-3 small CSVs in `data/`, invented but shaped like real field data, each showing one behavior.
`data/README.md` is the codebook: every file, every column with units, and what it would take to
collect this data for real.
- **Datasets:** three synthetic 12-month files (Oct 16, 2025 to Oct 15, 2026) covering every New York ZCTA, about 400,000 calls each, gzipped (`data/incidents_<name>.csv.gz`), built by a fixed-seed generator from a parameters file, with volume = 2020 population x base rate x month factor (summer peak) x day-of-week factor: `incidents_baseline.csv.gz` (yearly pattern only; rural ZIPs are an Ongoing gap from long trips), `incidents_station_closure.csv.gz` (from Sep 1, 2026 Google estimates in ZIP 11368, the most populous urban ZCTA, rise 60%; +25% was too small for the tool's rules to flag: Act now in early September, long trip, "post an ambulance closer" helps most), `incidents_summer_surge.csv.gz` (Jul 1 to Aug 31, 2026 one county's volume +30%, `held = Y` common, `dispatch_s` grows: flagged in July and August only, "add an ambulance" helps most).

## 8. Documentation and reproducibility (rubric: docs 10, public repo 5)
- `README.md` says what the tool does, for whom, every input and parameter, how to run it in one
  command, and walks through the demo on each test dataset.
- Public GitHub repo; a fresh clone runs `testme` and the tests pass with no extra steps.
- Submit on Devpost: the repo link plus a demo.

## 9. Out of scope
What we will NOT build, so nobody (human or agent) builds it by accident.
- Default: logins, databases, real customer data, a second statistic before the first one is tested.
- Route optimization; correlation with traffic, accidents or population density as a model; ranking individual ambulances or dispatchers (no `unit_id` or dispatcher IDs, by design); time-of-day (shift) filters; patient outcomes (we flag extreme waits, never claim deaths); a live CAD connection (`POST /calls` and replay mode stand in for real-time logging).
