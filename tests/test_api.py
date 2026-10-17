"""Tests for app/main.py through FastAPI's TestClient. Statistics routes pass in both states:
503 while app/qc.py is missing (H-03), real checks once it exists."""
import importlib.util

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)
QC_READY = importlib.util.find_spec("app.qc") is not None
SINCE = "from=2026-09-16&to=2026-10-15"


def test_health_lists_three_datasets_with_row_counts():
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["datasets"] == ["baseline", "station_closure", "summer_surge"]
    assert body["rows"]["baseline"] == 399426
    assert body["rows"]["station_closure"] == 399426
    assert body["rows"]["summer_surge"] == 400270


def test_meta_has_62_counties_and_10_targets():
    body = client.get("/api/meta").json()
    assert len(body["counties"]) == 62 and len(body["targets"]) == 10
    assert body["date_min"] == "2025-10-16" and body["date_max"] == "2026-10-15"
    assert {"county_fips", "county_name"} <= set(body["counties"][0])


@pytest.mark.parametrize("query", ["dataset=nope", "level=city", "level=county&id=99999", "level=county",
                                   "urgency=blue", "from=2026-13-01", "from=2026-10-15&to=2026-10-01"])
def test_bad_parameters_give_400(query):
    for route in ("/api/summary", "/api/pchart"):
        r = client.get(f"{route}?{query}")
        assert r.status_code == 400, (route, query, r.text)
        assert "detail" in r.json()


def test_post_call_appends_a_row_and_validates():
    row = {"incident_id": "LIVE-1", "zcta": "10001", "urgency_code": 0,
           "t_received": "2026-10-16T08:00:00-04:00", "t_assigned": "2026-10-16T08:01:00-04:00",
           "t_enroute": "2026-10-16T08:02:00-04:00", "t_onscene": "2026-10-16T08:08:00-04:00",
           "disposition": "TRANSPORTED", "valid_time": "Y", "eta_google_s": 300, "held": "N"}
    first = client.post("/api/calls", json=row).json()
    assert first["ok"] and first["incident_id"] == "LIVE-1"
    second = client.post("/api/calls", json={**row, "incident_id": "LIVE-2"}).json()
    assert second["rows"] == first["rows"] + 1
    assert client.get("/api/health").json()["rows"]["live"] == second["rows"]
    # a bad ZIP and a bad urgency code are refused
    assert client.post("/api/calls", json={**row, "zcta": "99999"}).status_code == 400
    assert client.post("/api/calls", json={**row, "urgency_code": 42}).status_code == 400
    assert client.post("/api/calls", json={"incident_id": "x"}).status_code == 422


STATS_ROUTES = ["/api/summary", "/api/anom", "/api/pchart", "/api/imr", "/api/delays",
                "/api/whatif?fix=closer&pct=20"]


@pytest.mark.skipif(QC_READY, reason="app/qc.py exists: the 503 path is not reachable")
@pytest.mark.parametrize("route", STATS_ROUTES)
def test_stats_routes_answer_503_while_qc_is_missing(route):
    sep = "&" if "?" in route else "?"
    r = client.get(f"{route}{sep}dataset=station_closure&level=county&id=36081&{SINCE}")
    assert r.status_code == 503
    assert r.json() == {"detail": "statistics module not ready (H-03)"}


@pytest.mark.skipif(not QC_READY, reason="app/qc.py not written yet (H-03): stats routes return 503")
@pytest.mark.parametrize("route", STATS_ROUTES)
def test_stats_routes_return_selection_and_messages(route):
    sep = "&" if "?" in route else "?"
    r = client.get(f"{route}{sep}dataset=station_closure&level=county&id=36081&{SINCE}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["selection"]["name"] == "Queens" and body["selection"]["baseline_from"] == "2026-07-18"
    assert isinstance(body["messages"], list)


@pytest.mark.skipif(not QC_READY, reason="app/qc.py not written yet (H-03)")
def test_summary_has_a_row_per_county_and_flags_the_closure_zip():
    body = client.get(f"/api/summary?dataset=station_closure&{SINCE}").json()
    assert len(body["places"]) == 62 and len(body["urgent_by_county"]) == 62
    z = client.get(f"/api/summary?dataset=station_closure&level=county&id=36081&{SINCE}").json()
    assert z["totals"]["timed"] > 0


@pytest.mark.skipif(not QC_READY, reason="app/qc.py not written yet (H-03)")
def test_empty_selection_is_200_not_500():
    r = client.get("/api/summary?level=zcta&id=06390&from=2026-09-16&to=2026-09-16")
    assert r.status_code == 200 and r.json()["totals"]["calls"] >= 0


def test_google_route_needs_no_qc():
    r = client.get(f"/api/google?dataset=station_closure&level=zcta&id=11368&{SINCE}")
    assert r.status_code == 200
    body = r.json()
    assert body["available"] and body["now"]["eta_med_s"] > 0
    assert len(body["hist"]["now"]) == len(body["hist"]["edges_s"]) - 1


def test_unknown_fix_and_pct_give_400():
    assert client.get("/api/whatif?fix=magic").status_code in (400, 503)
    if QC_READY:
        assert client.get("/api/whatif?fix=magic").status_code == 400
        assert client.get("/api/whatif?fix=closer&pct=500").status_code == 400
