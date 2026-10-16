# Plan: EMS Response Monitor (Powerpuff Girls)

User: the 911 / EMS center's quality supervisor. Question: which NY county or ZIP needs attention, is it a
real change, which step (911 center, crew, drive) costs the minutes, and which fix helps most.
Deadline: Sat Oct 17, 1 PM ET. Formulas and known answers: SPEC.md section 4. Statistics before any page.

## Tasks, in order
1. **H-01 SPEC** (`SPEC.md`). Left: the prompt number from Devpost. 5 min.
2. **H-09a targets** (`config/targets.csv`). 10 rows, codes 0-2 red 480 s, 3-5 yellow 900 s, 6-9 green
   1800 s, goal 90%. Test: 10 rows, codes 0-9. Degenerate: an unknown code makes the loader fail loudly. 10 min.
3. **H-02 data** (`data/`). `build_lookups.py` (2020 Census; key from `.env`), `params.json`, `generate.py`
   (fixed seed, lognormal steps), 3 `.csv.gz` files, `validate.py`, `README.md` codebook.
   Test: every schema check PASS; planted stories visible in raw numbers (closure ZIP % late up from Sep 1;
   surge county volume up about 30% in Jul-Aug, `held` rate up). Degenerate: validate rejects a file with
   out-of-order times. 1.5 h.
4. **H-03 statistics** (`app/qc.py`, `tests/`), one function each, test first:
   - a. `derive(df)`: `dispatch_s = t_assigned - t_received`, `turnout_s = t_enroute - t_assigned`,
     `drive_s = t_onscene - t_enroute`, `total_s = t_onscene - t_received`, `late = total_s > target_s`.
   - b. `p_chart`: p-bar = 20/100 = 0.20; sigma = sqrt(0.2*0.8/20) = 0.08944; UCL = 0.2 + 3*0.08944 = 0.4683;
     LCL = max(0, -0.0683) = 0; only day 5 (0.50) signals. Degenerate: p-bar = 0 gives no flags plus a message.
   - c. `imr`: x = 1.0, 1.2, 0.9, 1.1, 1.3; MR-bar = 0.9/4 = 0.225; sigma = 0.225/1.128 = 0.19947;
     limits 1.1 +/- 0.5984 = 0.5016 to 1.6984; MR UCL = 3.267*0.225 = 0.7351; Nelson tests 1-8.
     Degenerate: constant x gives sigma = 0 and a message, never inf.
   - d. `cpk_upper`: (2.0794 - 1.1)/(3*0.19947) = 1.6368; se = sqrt(1/45 + 1.6368^2/8) = 0.5976;
     upper = 1.6368 + 1.645*0.5976 = 2.6197. Bar z(0.90)/3 = 0.4272. Degenerate: sigma = 0 gives None.
   - e. `p95_boot`: P95 of 1..20 = 19 + 0.05*1 = 19.05; 2,000 resamples, seed fixed. Degenerate: constant gives [c, c].
   - f. `anom`: grand mean 44/12 = 3.6667; sigma-p = sqrt(6/9) = 0.8165; h = z(1 - 0.05/6) = 2.3940;
     half-width = 2.394*0.8165*sqrt(8/48) = 0.7980; A low, B inside, C high; F(2, 9) = 26.0. Degenerate: k = 1 gives a message.
   - g. `status`: Act now / Recent change / Ongoing gap / On track / Not enough calls (< 30 calls).
   - h. `fault_tree`: medians dispatch 60, turnout 70, eta 300, vs-Google -40; call 65, 75, 450, -30 gives excesses
     5, 5, 150, 10, so "long trip". `held = Y` always gives "no ambulance free".
   - i. `whatif`: 4 calls of 400, 500, 520, 300 s at target 480 s are 2 late; crew 20% faster with turnout 100 s
     each gives 380, 480, 500, 280, so 1 late and 1 avoided (480 is not late: the rule is >).
   About 4 h; a, b, c, d, g first. Then **stats-reviewer** gives PASS/FAIL per statistic.
5. **H-08 first half** (`.gitignore`): point `origin` at github.com/allyannap/sixsigma and push. 10 min.
6. **H-04 API** (`app/`): `demos/fastapi` copied; `/summary /pchart /imr /anom /google /delays /whatif`,
   `POST /calls`. Test: `/pchart` on a 5-day fixture returns the H-03 numbers. Under 2 s per request. 2 h.
7. **H-06 deploy** (`.github/workflows/`, `app/manifest.json`): as soon as H-04 runs. 1 h.
8. **H-09b map shapes** (`geo/`): mapshaper-simplified counties (62) and ZCTAs. 1 h, in parallel with 4-6.
9. **H-05 page and demo** (`app/frontend/`, `demo/`): the mockup's 5 sections; walk each dataset. 3 h.
10. **H-07 README**, then **H-08** fresh-clone test and the Devpost entry. 1 h.

## Decisions (Oct 16)
- Schema is the source of truth; the mockup sets look and wording; ANOM is core; no shift filter.
- Geography: New York State, 62 counties, then ZIP areas (Census ZCTAs) assigned to the county holding most residents.
- Data: about 400k calls per file, gzipped; synthetic, fixed seed; volume about 2% of a realistic rate, stated in the README.
- Census: 2020 counts through a free API key kept in the gitignored `.env` (`CENSUS_API_KEY`).
- Lookups in `data/lookup/`; new task H-09 owns `config/` and `geo/`.
- Baseline: the 60 days before the range (120 if under 30 calls); headline measure `total_s`; late = `total_s > target_s`.
- Stack: FastAPI + React; every statistic in `app/qc.py`.
- Station closure effect +60% (not +25%): at +25% the tool's rules miss it (Oct 16, after checking the real data).

## Risks
1. **Too much for 18 hours.** Cut line at 6 AM: cards 1-6 and ANOM must work; Google (7), fault tree (8)
   and what-if (9) ship only if their tests pass.
2. **Slow requests on 400k rows.** Load each file once at start-up, filter with pandas, cache the baseline.
3. **False "changed recently" flags on busy places.** On the clean baseline file, Monroe's I chart (908 calls in
   Jul-Aug) fires test 1 eleven times and has a run of 9. Nelson tests assume a few dozen points. Decide in H-03,
   before coding the status rule: e.g. status uses the p chart only, and the I chart stays as card 6's per-call view.
4. **Deploy breaks late.** Deploy the bare API by midnight; keep the bundle small (gzipped data, simplified shapes).
