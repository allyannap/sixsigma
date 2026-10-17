# EMS Response Monitor: API (app/)

FastAPI back end for the quality supervisor's dashboard. It reads the three synthetic 12-month
call files in `data/`, joins `config/targets.csv` and the Census lookups, and serves the JSON
shapes fixed in [`docs/api.md`](../docs/api.md). Every statistic comes from `app/qc.py`; this
folder only loads, filters and forwards.

| File | Job |
|---|---|
| `data.py` | load the files once, derive per-call fields, `select`, `baseline` (60 -> 120 days, 30-call minimum), `children`, `subgroups` |
| `main.py` | the FastAPI routes under `/api/*`, `/geo/*`, and the built page at `/` |
| `testme.sh` | run locally on port 8000 |
| `manifestme.sh`, `deployme.sh` | Posit Connect (bundle root is the repo root; `deployme.sh` reads `CONNECT_SERVER` and `CONNECT_API_KEY` from your environment) |

## Run

```bash
pip install -r app/requirements.txt
bash app/testme.sh            # http://localhost:8000/docs
.venv/bin/python -m pytest tests/test_data.py tests/test_api.py -q
```

The first start reads and derives the three files (about 5 s each, in a background thread); after that a
request is milliseconds. If `app/qc.py` is missing, the statistics routes answer HTTP 503
`{"detail": "statistics module not ready (H-03)"}`; `/api/health`, `/api/meta`, `/api/google` and `POST /api/calls` still work.

## Parameters (every GET except health and meta)

| Parameter | Values | Default |
|---|---|---|
| `dataset` | `baseline`, `station_closure`, `summer_surge`, `live` (after POSTs) | `baseline` |
| `from`, `to` | `YYYY-MM-DD`, inclusive | the dataset's last 30 days (2026-09-16 to 2026-10-15) |
| `urgency` | comma list of `red,yellow,green` | `red` |
| `level`, `id` | `state`; `county` + 5-digit FIPS; `zcta` + 5-digit ZIP area | `state` |
| `baseline_days` | days before `from` used for limits; stretched to 120 if under 30 timed calls | 60 |

A timed call is not cancelled, has `t_onscene`, `valid_time = Y` and times in order; untimed calls count in `calls` only.
Bad `dataset`, `level`, `id`, `urgency` or dates give HTTP 400 `{"detail": ...}`. An empty selection gives 200 with zero counts.

## Endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/health` | status, dataset names, row counts |
| `GET /api/meta` | dataset names, date range, 62 counties, the 10 urgency targets |
| `GET /api/summary` | totals, one row per child place with status, `needs_attention` (places Act now, Recent change or Ongoing gap), calls per county for the map |
| `GET /api/anom` | ANOM across the child places (minutes are the geometric mean, `exp` of the ln-minute mean) |
| `GET /api/pchart` | p chart points (by day, or by ISO week for low volume) |
| `GET /api/imr` | I-MR points and Nelson tests (limits in minutes) |
| `GET /api/delays` | step medians now vs baseline, fault-tree cause counts, worst call |
| `GET /api/google` | Google estimate vs actual drive; histogram of `drive_s - eta_google_s` in 30 s bins (end bins hold the tails) |
| `GET /api/whatif?fix=closer&pct=20` | late calls now vs with one fix (`closer`, `add_ambulance`, `center_faster`, `crew_faster`), pct 0-100 |
| `POST /api/calls` | add one call (an `incidents.csv` row as JSON) to the in-memory `live` dataset |
| `GET /geo/ny_counties.geojson`, `/geo/ny_zcta.geojson` | map shapes |

When several urgency groups are selected, Cpk uses the first group's target and the reply says so in `messages`.

## Examples

```bash
curl localhost:8000/api/health
curl "localhost:8000/api/summary?dataset=station_closure"
curl "localhost:8000/api/pchart?dataset=station_closure&level=zcta&id=11368&from=2026-09-01&to=2026-09-30"
curl "localhost:8000/api/whatif?dataset=summer_surge&level=county&id=36055&from=2026-07-01&to=2026-08-31&fix=add_ambulance&pct=20"
curl -X POST localhost:8000/api/calls -H "Content-Type: application/json" -d '{"incident_id":"LIVE-1","zcta":"10001","urgency_code":0,"t_received":"2026-10-16T08:00:00-04:00","t_assigned":"2026-10-16T08:01:00-04:00","t_enroute":"2026-10-16T08:02:00-04:00","t_onscene":"2026-10-16T08:08:00-04:00","disposition":"TRANSPORTED","valid_time":"Y"}'
```
