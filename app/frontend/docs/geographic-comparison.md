# Geographic comparison: investigation and implementation

The existing app is FastAPI (`app/main.py`) with a React/Vite frontend (`src/main.jsx` → `App.jsx`). `app/data.py` caches the three gzipped CSVs, derives elapsed times in UTC, joins the Census geography and target configuration, and filters dates, geography and urgency. The repository uses hand-drawn SVG charts and `d3-geo` for maps, not a box-plot library. The existing visual system uses IBM Plex Sans/Mono, pale gray-green panels, navy headings, 12px card corners and shared status badges.

## Data inspected (all synthetic)

One row is one EMS incident, not one crew or patient outcome. Files span October 16, 2025 through October 15, 2026. Columns:

| Field | Type / units | Meaning |
|---|---|---|
| incident_id | text | Unique incident within its file |
| zcta | five-character text | Census ZIP area; county joined through lookup |
| urgency_code | integer 0–9 | 0–2 red, 3–5 yellow, 6–9 green |
| t_received | offset ISO datetime, seconds | Provisional clock start: 911 receipt versus CAD creation unconfirmed |
| t_assigned | offset ISO datetime, seconds | First unit assignment |
| t_enroute | offset ISO datetime, seconds | Unit starts driving |
| t_onscene | nullable offset ISO datetime, seconds | Arrival; empty for cancelled calls |
| disposition | text enum | TRANSPORTED, TREATED, REFUSED, CANCELLED |
| valid_time | Y/N | Whether timestamps can be trusted |
| eta_google_s | integer seconds | Generated travel estimate; unused in this view |
| held | Y/N | Waiting for a free unit; unused in this view |

The displayed response is **receipt to arrival**, not assignment to arrival, consistent with existing calculations. Only noncancelled, valid-time calls with ordered timestamps and positive elapsed time enter time statistics. Cancelled/missing-arrival calls are excluded, not assigned zero or treated as completed. No censored-duration estimator is used; these results describe valid completed calls. Exclusions can bias comparisons if completion differs by area. No patient outcome is recorded; a slow call cannot be identified as fatal from these files.

| File | Rows | Valid completed | Cancelled / missing arrival | Invalid-time flag | Red / yellow / green calls |
|---|---:|---:|---:|---:|---|
| baseline | 399,426 | 371,941 | 23,777 | 3,945 | 136,014 / 159,876 / 103,536 |
| station_closure | 399,426 | 371,941 | 23,777 | 3,945 | 136,014 / 159,876 / 103,536 |
| summer_surge | 400,270 | 372,687 | 23,851 | 3,974 | 136,287 / 160,218 / 103,765 |

Invalid-time and cancelled counts overlap. All other source columns have zero missing values. Each file has calls in 1,769 ZIPs and all 62 counties; the lookup includes 1,826 ZIPs. The smallest observed ZIP has one call; some lookup ZIPs have zero. Observed ZIP × urgency groups have min/median/max counts 1 / 23 / 917, and the smallest nonempty valid group has one call. Full counts, including zeros, are in [geographic-counts.csv](geographic-counts.csv), derived from existing files without changing them.

Across urgency groups, baseline completed waits in minutes have min 1.13, median 6.42, P90 12.28, P95 15.10, P99 22.40, max 102.78; skewness 2.38. Station closure P90 is 12.30; surge P90 12.33, P95 15.15, P99 22.43; both maxima 102.78. These pooled figures describe the files only; the chart requires one urgency group. Long waits are retained. They are strongly right-skewed, so a typical-wait-only comparison hides the operational tail.

## Before and after

Before: `AnomSection.jsx` requested `/api/anom`; the backend filtered one urgency, excluded areas below 30 calls, then computed ANOM on log minutes. The chart displayed geometric means, intervals and chance bands on a log axis, limited to 20 areas. There was no service-target reference or late percentage. It was **not a box plot**.

After: the same section uses `/api/summary`, shared with the map and existing alerts. Each place includes a plain-function `qc.response_profile`: observed median, P90, max, percent strictly above each call's target, n and low-sample warning. Quantiles use linear interpolation, matching existing percentile calculations. Missing/nonfinite/nonpositive times or targets are excluded as pairs. Rendering computes no new statistics. No dependencies added.

Rows use a common linear axis and rank descending by P90, late percent or median. The selected-area card initially shows the highest-ranked area; changing the selection resets pagination. A circle shows half of calls, a cap shows the slowest-1-in-10 boundary, and a dashed target line anchors comparison. The full maximum is in the selected-area card so P90 cannot be mistaken for the worst call. Five areas appear per page without an inner scrollbar; Previous / Next reaches every area on a fixed common scale. Sparse rows have dashed ranges and explicit warnings, and zero-call rows sort last. Native buttons select one area for a place card containing its complete statistics. The card sits beside the ranking on desktop and below it on mobile. Native disclosures retain detailed explanations without repeating them in every row.

Statuses reuse Section 1's Wilson-based Meets / Below / Inconclusive judgments, with blue/orange/gray ranges and text badges. Under 30 calls is always Inconclusive. A new P90 flag was deliberately avoided because it could contradict the existing alert rules. The selected card’s uncertainty disclosure shows the on-time confidence interval; P90 is an observed quantile, not a confidence bound. Recent-change alerts remain in Sections 2–3.

The configured targets are placeholder 8/15/30 minutes, goal 90% on time, from `config/targets.csv`. If targets differ within the selection, the single reference line is omitted and clearly explained; each call's configured target still determines lateness. Multiple urgency groups prompt the user to select one. Existing loading/error/retry states are reused. Replay changes the shared summary filters; removing the extra ANOM request reduces update work. `/api/anom` remains available and is loaded only when the selected card’s “Compare with other areas” disclosure opens. It preserves the original overall mean, counts slower/faster, selected area’s geometric mean, interval, comparison limits and verdict; calculation details retain h, k, N and ANOVA F.

Violin plots retain statistical abstraction. Means obscure slow calls. The existing map complements the ranked chart but cannot provide equally precise time comparisons. No additional distribution plot or incident-detail system was introduced for this focused change.

## Verification and run

From repository root:

```sh
.venv/bin/python -m pytest tests -q
npm test --prefix app/frontend
npm run build --prefix app/frontend
bash app/testme.sh
```

Open http://localhost:8000 and Section 4. Select a single urgency; change it, dates or geography to update the chart. Start replay to grow the selection against the existing fixed baseline. Select a row by touch or Enter/Space to inspect its tail and uncertainty in the adjacent card. Use Previous / Next to reach additional areas. Tests cover hand-worked quantiles, empty/single/tied/missing values, exact-target ties, mixed targets, sort order, status agreement, all urgency targets, replay windows and rendering states.

Open dependencies remain authoritative targets and the meaning of `t_received`. This remains a read-only synthetic replay, not real-time CAD intake. Comparisons do not establish causes, blame, or fairness.

## Files changed

- `app/qc.py`: pure response-profile aggregation.
- `app/main.py`: adds the profile to existing summary place cards.
- `app/frontend/src/components/AnomSection.jsx`: ranked ranges and expandable explanations.
- `app/frontend/src/App.jsx`: shares summary data and removes the extra ANOM fetch.
- `app/frontend/src/styles.css`: responsive rows and chart presentation.
- `app/frontend/src/fixtures/summary_state.json`, `summary_county.json`: profile fields from the existing synthetic-file API for the established fixture subsets.
- `tests/test_qc.py`, `tests/test_api.py`: aggregation edge cases and integration checks.
- `app/frontend/src/response.test.js`, `render.test.js`: ranking, data labels and render-state tests.
- `SPEC.md`, `README.md`, `docs/api.md`, `docs/plan.md`: describes the revised view and API fields.
- `CONTRACT.yaml`: H-11 follow-up tracking; awaits human diff review/check-in.
- `app/frontend/docs/geographic-comparison.md`, `geographic-counts.csv`: investigation and complete per-ZIP counts (18 columns: all calls and valid completed calls for each dataset × urgency combination).

Verified: Python suite `133 passed, 1 warning` (existing httpx deprecation); frontend `29 passed`; production build successful; independent R type-7 quantiles returned median 10.5, P90 18.1 and 40% late for the known answer. A running local API returned ZIP 11368, closure September 1–October 15: n=68, median 6.725 min, P90 10.5767 min, max 15.65 min, 26.4706% over the 8-min target, Below target / Act now. The built page was served successfully. Browser execution tools were unavailable, so visual, keyboard and touch interaction checks remain manual; automated checks verify rendering and accessible/native controls. No screenshot is claimed.

Final data validation: `.venv/bin/python data/validate.py --reproduce` printed `55 PASS, 0 FAIL`; all three regenerated contents matched the originals. `check.sh` printed `PASS check.sh`; `git diff --check` reported no whitespace errors. H-11 remains in progress solely for the required human diff review and authorized check-in; no commit was made.

Runtime follow-up: a server started before the API update continued returning the old summary schema, which the new chart incorrectly labelled as no valid calls. Added an explicit restart alert for missing response profiles and a regression test (`30` frontend tests now pass). Rebuilt the page and restarted the verified local uvicorn process; the live default summary now returns 32,877 valid calls and all 62 county profiles. Backend changes require restarting `bash app/testme.sh`.

Compact UI follow-up: replaced the scrolling 62-row list with five compact ranked rows plus a selected-area place card. Shared target and legend appear once; explanatory text and original ANOM analysis are disclosed on demand. All metrics remain accessible and the scale is fixed across pages. Frontend suite printed `31 passed`, production build succeeded, and the running app served the compact bundle. Live ANOM reproduced the original screenshot: 60 eligible areas, 46 slower, 10 faster, overall geometric mean 5.31 min. Browser interaction and visual checks remain manual in this session.

Version 2 alternative (below version 1): a single overall percent-on-time score, fixed 0–100 percentage ruler with an on-time goal tick, and three compact area lines ordered by observed late share. No new statistics or data sources. Red/green/gray marker colors reuse existing confirmed Below / Meets / Inconclusive judgments; observed-rate bands are contextual, never a substitute for uncertainty. Each area opens for n, median, P90, max and Wilson interval. An optional area picker reaches every area. The overall score comes directly from the call-weighted API totals. Version 1 and its full peer analysis remain above. Frontend suite: `34 passed`; production build passed. No browser visual verification is claimed.

Version 2 shared-line refinement: replaced the separate overall/area rulers with one fixed 0–100% comparison ruler. Three lowest-on-time areas appear as selectable markers in vertical label lanes; horizontal positions stay exact even for ties. Area chips also select a marker. An inline area picker adds a fourth comparison without replacing the three original areas or duplicating them. One selected summary shows the observed gap in percentage points, late share, call-time target and sample size. A single optional detail disclosure retains Wilson intervals, median, P90, maximum and overall call-weighted evidence. Missing-sample areas remain listed but are disabled in the picker. Variable goals omit the shared target shading/marker and say goals vary. Version 1 remains intact. Frontend tests: 36 passed; build passed. Browser visual verification remains manual.

Final condensation: version 2 now uses three compact horizontal bars, each directly labeled by area and on-time percent, with a marked goal and zero-based 0–100% scale. The goal is explicit: “90% of calls arrive within 8 min of call receipt” for the current red configuration, changing to 15/30 minutes for yellow/green. A short selected-area line shows the percentage-point gap and n; the big overall score, staggered bubbles and duplicate selector chips were removed. The optional fourth-area selector and one Details disclosure preserve late share, tail, maximum, confidence intervals and overall statistics. Confirmed status colors and symbols remain consistent with alerts. Frontend tests: 37 passed; production build passed.

Post-feedback revision: version 2 no longer contains a chart. Three compact named buttons show the lowest on-time percentages; one selected result shows its on-time percentage, the explicit configured call-receipt-to-arrival deadline/goal, goal gap, sample size and status. The Other area selector replaces the result instead of adding a fourth graphic. Details retain late share, tail percentiles, maximum and uncertainty. Status words supplement color. Frontend: 37 passed; build passed.

All-area dot view launched: the primary geographic distribution now plots every valid area at its exact on-time rate on a fixed 0–100% axis. Nearby dots stack vertically without changing rates or dropping ties. A goal reference, three lowest adequately sampled area chips, keyboard-selectable dots, name search and the existing selected-area evidence card remain available. The existing grouped histogram and bin inspection remain under an optional disclosure. The headline now counts confirmed below-goal judgments rather than mixing observed misses and uncertainty. Frontend suite printed `41 passed`; build passed; live localhost index matches the new build. Browser visual testing remains manual.

User preference: removed the dot view and restored the original grouped histogram directly as the main version 2 chart, without a second histogram disclosure. Preserved bar-to-area drill-down, search, selected-area evidence, target line and existing status rules. Frontend suite: `40 passed`; production build passed.

## Main merge integration (Oct 17)

The team selected version 4B (the on-time histogram and area card) as the sole Section 4, replacing both the older ranked-range view and main’s ANOM view. ANOM remains available through the API. Red targets now follow main’s configured area tiers (urban 8 min, suburban 10 min, rural/remote 14 min); yellow and green remain 15/30 min. Mixed-target selections use each call’s own target. The historical design notes above describe earlier iterations. Fixtures retain main’s control evidence and include geographic profiles refreshed against the merged API.
