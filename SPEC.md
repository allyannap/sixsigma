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
- **Method:** the headline measure is `total_s = t_onscene - t_received` (the patient's whole wait, so delays at the 911 center before an ambulance is assigned count too); the prompt's own measure, `dispatch_to_scene_s = t_onscene - t_assigned`, is reported beside it (P95 of both). A call is **late** when `total_s > target_s` and **very late** when `total_s > 2 x target_s` (the "fatal outlier" count). Untimed calls (cancelled, no `t_onscene`, `valid_time = N`, or times out of order) count in volume only. Per place (state, county or ZCTA), within one urgency group, compared with the **baseline** (the 60 days before the selected range; 120 if under 30 timed calls). All logs are natural logs of minutes; `USL = ln(target_s / 60)` (never mix seconds and minutes).
  1. **p chart** of the fraction late (display: "bad days"). Subgroup = the shortest of day, week or calendar month for which the baseline's expected late calls per subgroup, mean n x p-bar, is at least 5; if none reaches 5 the chart is shown as "low volume, no signals". CL = p-bar from the baseline (total late / total calls); limits p-bar +/- 3 sqrt(p-bar (1 - p-bar) / n_i), LCL floored at 0, UCL capped at 1. Marks: a point above its UCL; a run of 9 above the CL. These marks do not set the status.
  2. **I-MR chart on ln(minutes)** of every call in order received (display: "bad calls"). CL = baseline mean, sigma = MR-bar / 1.128 (d2 for n = 2), I limits CL +/- 3 sigma, MR UCL = 3.267 MR-bar. All 8 Nelson tests are computed and shown; red dots are calls beyond 3 sigma. These marks do not set the status.
  3. **One-sided Cpk on ln(minutes)** of the selected calls: Cpk = (USL - mean) / (3 sigma), sigma = MR-bar / 1.128 (the course's within, short-term sigma). Upper 95% bound, Bissell (1990) with a correction for MR-bar's lower efficiency (variance ratio 1.64 vs s): Cpk + 1.645 sqrt(1/(9n) + 1.64 Cpk^2 / (2(n - 1))). Bar = z(goal) / 3 (0.4272 for a 90% on-time goal). The observed % late is always shown beside Cpk, since the bar equals the goal exactly only if ln(minutes) is normal.
  4. **P95 of total wait and of dispatch-to-scene** (linear interpolation) with a 95% interval: percentile bootstrap, 2,000 resamples, fixed seed, for n up to 5,000; above that, the order-statistic interval (ranks n p +/- 1.96 sqrt(n p (1 - p)), p = 0.95). **Spread** = P95 - median (minutes), so "times vary wildly" is a number per place.
  5. **ANOM** on ln(minutes) across the places at the current level with at least 30 timed calls: decision limits grand mean +/- h sigma-p sqrt((N - n_i) / (N n_i)), pooled within-place sigma-p, h = t(1 - 0.05 / (2k), N - k) (Bonferroni with t; conservative against the exact ANOM value). One-way ANOVA F shown alongside. Means are shown back in minutes as exp(mean ln), the geometric mean.
  6. **Fault tree** (series OR) for each late call: "no ambulance free" if `held = Y`; otherwise the basic event with the largest **standardized** excess, z = (ln(step) - ln(baseline median)) / baseline sd of ln(step), over 911 center (`dispatch_s`), crew (`turnout_s`), long trip (`eta_google_s`) and drive slower than Google (ratio `drive_s / eta_google_s`). Scale-free, so a slow 911 center can be named next to a long drive. The drive is split, not double counted: drive = Google estimate x ratio. Calls where every z <= 0 go to "typical call is already late".
  7. **What-if replay** on the selected calls, one change at a time, everything else held fixed (no queueing effects): `closer` = drive shortened by pct; `add_ambulance` = each held call's `dispatch_s` set to the place's baseline median `dispatch_s` of non-held calls; `center_faster` / `crew_faster` = `dispatch_s` / `turnout_s` shortened by pct. Reports % late, P95 and late calls avoided.
- **Status per place:** Act now = too slow overall AND changed recently; Recent change = changed only; Ongoing gap = too slow only; On track = neither; Not enough calls = under 30 timed calls in the selection or the baseline. "Too slow overall" = the Cpk upper bound is below z(goal)/3. "Changed recently" = an upward shift of the selection against its baseline, with n >= 30 in each: Z_loc = (mean_sel - mean_base) / (sigma_base sqrt(1/n_sel + 1/n_base)) > 3 on ln(minutes), sigma_base = baseline MR-bar / 1.128; or Z_p = (p_sel - p_base) / sqrt(p_pool (1 - p_pool) (1/n_sel + 1/n_base)) > 3 on the fraction late, used only when n_sel p_pool >= 5 and n_sel (1 - p_pool) >= 5. About 0.27% false-alarm chance per place. (The stats review measured the Nelson-test rule flagging 64% of counties on clean data; this rule flags 0 of 39 and detects both planted stories: closure Z_loc 7.4, surge Z_loc 14.5.) "Needs attention" = Act now, Recent change or Ongoing gap.
- **Why it fits the use case:** the failures the prompt cares about live in the right tail, so the tool counts late and very late calls and shows every single call instead of the mean, compares each place with its own recent history, and splits each late call into the step that caused it.
- **Assumptions and how the tool checks them:** (1) late/not late is binomial within a stable subgroup; subgroups are sized so n p-bar >= 5. (2) Response times are right-skewed, so I-MR, Cpk, ANOM and Z_loc use ln(minutes); the remaining skew (+0.2 to +0.4) is why tail tests are display-only and status uses means of many calls. (3) Calls are independent; on the synthetic data MR sigma 0.337 vs s 0.341. (4) The baseline is in control (the p chart and I chart show it). (5) Untimed rows are excluded and counted. (6) The tool manages the **dispatch step** (911 center time), not individual dispatchers: no dispatcher IDs, by design. "Real-time logging" is `POST /api/calls` plus replay of a file in time order, not a live CAD feed.
- **Known-answer check** (each is a test in `tests/test_qc.py`; tolerance 5e-4 unless stated):
  - p chart: 5 days, n = 20 each, late = 2, 3, 1, 4, 10, all baseline. p-bar = 0.20, sigma = sqrt(0.2 x 0.8 / 20) = 0.08944, UCL = 0.4683, LCL = 0. Only day 5 (p = 0.50) is marked. Subgroup rule: 14 calls a day at p-bar 0.08 gives week (1.12 a day < 5, 7.84 a week >= 5); 70 a day gives day; 2 a day at 0.07 gives none (low volume).
  - I-MR: ln-minutes 1.0, 1.2, 0.9, 1.1, 1.3. MR = 0.2, 0.3, 0.2, 0.2, MR-bar = 0.225, sigma = 0.19947, CL = 1.1, UCL = 1.6984, LCL = 0.5016, MR UCL = 0.7351. No marks.
  - Cpk, same data, target 8 min: ln 8 = 2.0794, Cpk = 0.9794 / 0.5984 = 1.6368; se = sqrt(1/45 + 1.64 x 1.6368^2 / 8) = sqrt(0.57143) = 0.7559; upper bound = 1.6368 + 1.645 x 0.7559 = 2.8803.
  - ANOM: groups A = 1, 2, 3, 2; B = 2, 3, 4, 3; C = 5, 6, 7, 6. Grand mean 3.6667, sigma-p = sqrt(6 / 9) = 0.8165, h = t(1 - 0.05/6, 9) = 2.9333, half-width = 2.9333 x 0.8165 x sqrt(8/48) = 0.9778, limits 2.6889 to 4.6444: A (2.0) faster, B (3.0) inside, C (6.0) slower. ANOVA F(2, 9) = 26.0. (Applied to these tiny groups only in the test; the app requires 30 calls per place.)
  - Changed recently: baseline 30 values alternating 1.0, 1.2 (mean 1.1, MR-bar 0.2, sigma 0.17730) and selection 30 values alternating 1.2, 1.4 (mean 1.3): Z_loc = 0.2 / (0.17730 x sqrt(2/30)) = 4.369 > 3, changed. With 3 of 30 late in the baseline and 12 of 30 in the selection: p_pool = 0.25, Z_p = 0.3 / sqrt(0.25 x 0.75 x 2/30) = 2.683, not by itself.
  - Fault tree: baseline medians dispatch 60 s, turnout 70 s, Google estimate 300 s, ratio 0.88; baseline sd of ln 0.5, 0.35, 0.45, 0.15. A late call with dispatch 120, turnout 75, estimate 450, drive 396: z = ln 2 / 0.5 = 1.386 (911 center), ln(75/70) / 0.35 = 0.197, ln 1.5 / 0.45 = 0.901 (long trip), ln((396/450)/0.88) / 0.15 = 0, so the 911 center is named (raw seconds would wrongly say long trip: +150 s vs +60 s). Held = Y is always "no ambulance free".
  - What-if: totals 400, 500, 520, 300 s at target 480, turnout 100 s each, crew 20% faster: 380, 480, 500, 280, so 2 late become 1 (480 is not late), 1 avoided.
  - P95 of 1, 2, ..., 20 = 19.05; spread = 19.05 - 10.5 = 8.55.
  - Status truth table: each of the 5 statuses, plus the boundaries (bound exactly equal to the bar is not too slow; Z exactly 3 is not changed; 29 calls is not enough).
  - Degenerate: constant data (MR-bar = 0) returns Cpk None with "no variation: Cpk undefined", never inf; Cpk with n < 2 returns None, "too few calls"; p-bar = 0 and p-bar = 1 return no marks with a message; k = 1 ANOM returns a message; empty selection or all calls cancelled returns "Not enough calls" with no log or division; bootstrap of n = 1 or constant data returns [c, c]; baseline MR-bar = 0 with a non-constant selection returns Z_loc None with a message.

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
