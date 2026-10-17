# EMS Response Monitor: API (app/)

Read-only FastAPI back end for the quality supervisor's dashboard. It reads the three **synthetic** 12-month
call files in `data/`, joins `config/targets.csv` and the Census lookups, and serves the JSON shapes fixed in
[`docs/api.md`](../docs/api.md). Every statistic comes from `app/qc.py`; this folder only loads, filters and forwards.
There is no route that accepts or edits incidents.

| File | Job |
|---|---|
| `qc.py` | every statistic: on-time rate + Wilson interval, p chart + control status, queue label, percentiles, stage excess, travel comparison, secondary I-MR / Cpk / ANOM |
| `data.py` | load the files once, derive per-call fields, `select`, `baseline` (60 → 120 days, 30-call minimum, always before `from`), `children`, `subgroups`, `day_events` (replay) |
| `main.py` | the `GET` routes under `/api/*`, `/geo/*`, and the built page at `/` |
| `testme.sh` | run locally on port 8000 |
| `manifestme.sh`, `deployme.sh` | Posit Connect (bundle root is the repo root; `deployme.sh` reads `CONNECT_SERVER` and `CONNECT_API_KEY` from your environment) |

## Run

```bash
python3 -m venv .venv && .venv/bin/pip install -r app/requirements.txt
(cd app/frontend && npm ci && npm run build)   # the page; skip it to use the API alone
bash app/testme.sh                             # http://localhost:8000 (page), http://localhost:8000/docs (API)
.venv/bin/python -m pytest tests -q
```

The first start reads and derives the three files (about 5 s each, in a background thread); after that a
state-level summary takes about 1.3 s and a county about 0.6 s. If `app/qc.py` is missing, the statistics routes
answer HTTP 503.

## Parameters (every GET except health and meta)

| Parameter | Values | Default |
|---|---|---|
| `dataset` | `baseline`, `station_closure`, `summer_surge` | `baseline` |
| `from`, `to` | `YYYY-MM-DD`, inclusive | the dataset's last 90 days (2026-07-18 to 2026-10-15) |
| `urgency` | comma list of `red,yellow,green` | `red` (pick one group for SPC and ANOM) |
| `level`, `id` | `state`; `county` + 5-digit FIPS; `zcta` + 5-digit ZIP area | `state` |
| `baseline_days` | days before `from` used for p-chart limits; stretched to 120 if under 30 valid calls | 60 |

There is no time-of-day filter or adjustment. Bad values give HTTP 400 `{"detail": ...}`; an empty selection gives 200.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, source label, dataset names, row counts |
| `GET /api/meta` | date range, default window, 62 counties, the 40 target rows |
| `GET /api/summary` | totals for the place, its own card, one card per child place (spec, control, queue, n, on-time rate + CI, P95 + CI, signals, top stage), queue counts |
| `GET /api/pchart` | p-chart points with varying limits, control status and the evidence, baseline window, dispersion check |
| `GET /api/delays` | "What Held Up the Call": stage medians (baseline) vs late-call averages, excess per stage, counts, held, longest call |
| `GET /api/google` | unusual travel-time difference (actual en-route-to-scene minus estimate), provenance, histogram |
| `GET /api/replay?day=YYYY-MM-DD` | the calls the synthetic file holds for one day, newest first (simulated replay) |
| `GET /api/imr` | secondary I chart on ln(minutes); only test 1 marked; assumption checks |
| `GET /api/anom` | secondary, descriptive ANOM within one urgency group |
| `GET /geo/ny_counties.geojson`, `/geo/ny_zcta.geojson` | map shapes |

## Examples

```bash
curl localhost:8000/api/health
curl "localhost:8000/api/summary?dataset=station_closure&level=zcta&id=11368&from=2026-09-01&to=2026-10-15"
curl "localhost:8000/api/pchart?dataset=summer_surge&level=county&id=36055&from=2026-07-01&to=2026-08-31"
curl "localhost:8000/api/delays?dataset=summer_surge&level=county&id=36055&from=2026-07-01&to=2026-08-31"
curl "localhost:8000/api/replay?dataset=station_closure&day=2026-09-02&limit=5"
```
