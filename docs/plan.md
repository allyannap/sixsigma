# Plan: EMS Response Monitor (Powerpuff Girls)

User: the 911 / EMS center's quality supervisor. Question: which NY county or ZIP needs attention, is it a
real change, which step (911 center, crew, drive) costs the minutes, and which fix helps most.
Deadline: Sat Oct 17, 1 PM ET. Formulas and known answers: SPEC.md section 4. Statistics before any page.
Roles and file ownership: docs/roles.md. Function signatures and endpoint JSON: docs/api.md.

## Tasks, in order
1. **H-01 SPEC** (`SPEC.md`). Left: the prompt number from Devpost. 5 min.
2. **H-09a targets** (`config/targets.csv`). 10 rows, codes 0-2 red 480 s, 3-5 yellow 900 s, 6-9 green
   1800 s, goal 90%. Test: 10 rows, codes 0-9. Degenerate: an unknown code makes the loader fail loudly. 10 min.
3. **H-02 data** (`data/`). `build_lookups.py` (2020 Census; key from `.env`), `params.json`, `generate.py`
   (fixed seed, lognormal steps), 3 `.csv.gz` files, `validate.py`, `README.md` codebook.
   Test: every schema check PASS; planted stories visible in raw numbers (closure ZIP % late up from Sep 1;
   surge county volume up about 30% in Jul-Aug, `held` rate up). Degenerate: validate rejects a file with
   out-of-order times. 1.5 h.
4. **H-03 statistics** (`app/qc.py`, `tests/test_qc.py`), one function each, test first. Rules, formulas and every
   known answer are in SPEC.md section 4 (revised Oct 16 after the stats review; arithmetic shown there):
   - p chart (display only) with the n x p-bar >= 5 subgroup rule; I-MR (display only) with all 8 Nelson tests.
   - Cpk on ln(minutes), MR sigma, Bissell bound x 1.64 correction: known answer 1.6368, bound 2.8803.
   - P95 + spread (bootstrap, order-statistic CI above n = 5,000); ANOM with t-based h = 2.9333.
   - changed_recently: Z_loc / Z_p > 3 (known answer Z_loc 4.369, Z_p 2.683); status truth table.
   - fault tree on standardized excess (known answer names the 911 center); what-if incl. add_ambulance.
   - Degenerate cases: the full list in SPEC section 4. About 4 h. Then **stats-reviewer** gives PASS/FAIL per statistic.
   - Then Data wires the new keys (very_late, spread, P95 of dispatch-to-scene) into `/api/summary` (docs/api.md).
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
- Data: about 400k calls per file, gzipped; synthetic, fixed seed; volume 0.0198 calls per person per year, about one-eighth of a typical real rate (~0.15), stated in the README.
- Census: 2020 counts through a free API key kept in the gitignored `.env` (`CENSUS_API_KEY`).
- Lookups in `data/lookup/`; new task H-09 owns `config/` and `geo/`.
- Baseline: the 60 days before the range (120 if under 30 calls); headline measure `total_s`; late = `total_s > target_s`.
- Stack: FastAPI + React; every statistic in `app/qc.py`.
- Stats review (Oct 16): Z-test "changed recently", standardized fault tree, course Cpk with corrected bound;
  add very-late count, spread (P95 - median), P95 of dispatch-to-scene; honest wording on dispatchers and real time.
- Station closure effect +60% (not +25%): at +25% the tool's rules miss it (Oct 16, after checking the real data).

## Risks
1. **Too much for 18 hours.** Cut line at 6 AM: cards 1-6 and ANOM must work; Google (7), fault tree (8)
   and what-if (9) ship only if their tests pass.
2. **Slow requests on 400k rows.** Load each file once at start-up, filter with pandas, cache the baseline.
3. **Rules that cry wolf.** Fixed before H-03 (stats review, Oct 16): status now uses Z_loc / Z_p against the
   baseline (clean file: 0 of 39 counties flagged), not the Nelson tests (64% flagged). Re-measure on all 3 files after H-03.
4. **Deploy breaks late.** Deploy the bare API by midnight; keep the bundle small (gzipped data, simplified shapes).
