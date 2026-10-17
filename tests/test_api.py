"""Tests for app/main.py through FastAPI's TestClient, on the three synthetic files.

Grouped by the minimum acceptance tests of EMS_RESPONSE_MONITOR_DECISIONS.md section 6 (AT-1 ... AT-10).
The statistics themselves have hand-worked known answers in tests/test_qc.py; these tests check the
routes return those same numbers, the read-only contract, and the planted-scenario behaviour.
"""
import math

import pytest
from fastapi.testclient import TestClient

from app import data, qc
from app.main import app

client = TestClient(app)
LAST_90 = "from=2026-07-18&to=2026-10-15"
CLOSURE = "dataset=station_closure&from=2026-09-01&to=2026-10-15"
SURGE = "dataset=summer_surge&from=2026-07-01&to=2026-08-31"


def get(route):
    r = client.get(route)
    assert r.status_code == 200, (route, r.text)
    return r.json()


def test_health_lists_three_datasets_with_row_counts_and_the_synthetic_source():
    body = get("/api/health")
    assert body["status"] == "ok" and "Synthetic" in body["source"]
    assert body["datasets"] == ["baseline", "station_closure", "summer_surge"]
    assert body["rows"] == {"baseline": 399426, "station_closure": 399426, "summer_surge": 400270}


def test_meta_has_62_counties_40_targets_and_the_90_day_default():
    body = get("/api/meta")
    assert len(body["counties"]) == 62 and len(body["targets"]) == 40
    assert body["date_min"] == "2025-10-16" and body["date_max"] == "2026-10-15"
    assert (body["default_from"], body["default_to"]) == ("2026-07-18", "2026-10-15")


@pytest.mark.parametrize("query", ["dataset=nope", "level=city", "level=county&id=99999", "level=county",
                                   "urgency=blue", "from=2026-13-01", "from=2026-10-15&to=2026-10-01"])
def test_bad_parameters_give_400(query):
    for route in ("/api/summary", "/api/pchart", "/api/replay"):
        r = client.get(f"{route}?{query}")
        assert r.status_code == 400, (route, query, r.text)
        assert "detail" in r.json()


# ---------------------------------------------------------------- AT-1 navigation and filters

def test_at1_state_county_zcta_navigation_and_filters():
    state = get(f"/api/summary?{LAST_90}")
    assert state["selection"]["level"] == "state" and len(state["places"]) == 62
    county = get(f"/api/summary?{LAST_90}&level=county&id=36081")
    assert county["selection"]["name"] == "Queens" and "11368" in {p["id"] for p in county["places"]}
    zcta = get(f"/api/summary?{LAST_90}&level=zcta&id=11368")
    assert [p["id"] for p in zcta["places"]] == ["11368"]
    red = get(f"/api/summary?{LAST_90}&urgency=red")["totals"]["valid"]
    yellow = get(f"/api/summary?{LAST_90}&urgency=yellow")["totals"]["valid"]
    both = get(f"/api/summary?{LAST_90}&urgency=red,yellow")["totals"]["valid"]
    assert both == red + yellow
    short = get("/api/summary?from=2026-10-01&to=2026-10-15")["totals"]["valid"]
    assert 0 < short < red


# ---------------------------------------------------------------- AT-2 every geographic output has n, rate, CI, P95, both states

def test_at2_every_place_shows_n_rate_ci_p95_and_both_states():
    body = get(f"/api/summary?{LAST_90}&level=county&id=36081")
    for p in [body["place"], *body["places"]]:
        for key in ("valid", "on_time", "on_time_pct", "on_time_ci", "goal_pct", "p95_min", "spec", "control", "queue"):
            assert key in p, key
        assert p["spec"] in qc.SPEC_STATUSES and p["control"] in qc.CONTROL_STATUSES and p["queue"] in qc.QUEUE
        if p["valid"]:
            lo, hi = p["on_time_ci"]
            assert lo <= p["on_time_pct"] <= hi
    t = body["totals"]
    assert t["on_time"] + t["late"] == t["valid"] and t["median_ci"][0] <= t["median_min"] <= t["median_ci"][1]


# ---------------------------------------------------------------- AT-3 classification, inconclusive never a success

def test_at3_route_classification_matches_qc_on_the_same_calls():
    body = get(f"/api/summary?{CLOSURE}&level=county&id=36081")
    place = next(p for p in body["places"] if p["id"] == "11368")
    df = data.load("station_closure")
    sel = data.select(df, "zcta", "11368", "red", "2026-09-01", "2026-10-15")
    timed = sel[sel["timed"]]
    n, late = len(timed), int(timed["late"].sum())
    want = qc.on_time(n, n - late, 90)
    assert (place["valid"], place["on_time"]) == (n, n - late)
    assert place["spec"] == want["status"] == "below"
    assert place["on_time_ci"] == [round(100 * v, 1) for v in want["ci"]]


def test_at3_inconclusive_is_never_labelled_a_success():
    body = get(f"/api/summary?{LAST_90}&level=county&id=36081")
    for p in body["places"]:
        if p["spec"] == "inconclusive":
            assert p["queue"] != "meets_stable"
        if p["valid"] < qc.MIN_CALLS:
            assert p["spec"] == "inconclusive" and "insufficient data" in p["spec_reason"]


# ---------------------------------------------------------------- AT-4 p-chart limits and baseline isolation

def test_at4_pchart_limits_follow_subgroup_size_and_baseline_precedes_the_period():
    body = get(f"/api/pchart?{SURGE}&level=county&id=36055")
    sel = body["selection"]
    assert sel["baseline_to"] < sel["from"]
    p_bar = body["p_bar"]
    for pt in body["points"]:
        want = min(1.0, p_bar + 3 * math.sqrt(p_bar * (1 - p_bar) / pt["n"]))
        assert pt["ucl"] == pytest.approx(want, abs=1e-3)
    ns = [pt["n"] for pt in body["points"]]
    big, small = body["points"][ns.index(max(ns))], body["points"][ns.index(min(ns))]
    assert max(ns) == min(ns) or small["ucl"] > big["ucl"]
    assert body["control"] == "out_of_control" and body["signals"]
    assert body["dispersion"] is not None and "ratio" in body["dispersion"]


def test_at4_low_volume_pchart_is_insufficient_baseline_not_in_control():
    b = get("/api/pchart?level=zcta&id=06390")
    assert b["unit"] is None and b["points"] == [] and b["control"] == "insufficient_baseline"


# ---------------------------------------------------------------- AT-5 read-only replay, no incident entry

def test_at5_replay_is_read_only_and_labelled_synthetic():
    body = get("/api/replay?dataset=station_closure&day=2026-09-02&limit=5")
    assert "Synthetic" in body["source"] and "Synthetic" in body["selection"]["source"]
    assert body["received"] >= body["valid"] >= body["late"] and len(body["events"]) == 5
    times = [e["t_received"] for e in body["events"]]
    assert times == sorted(times, reverse=True) and all(t.startswith("2026-09-02") for t in times)
    nxt = get("/api/replay?dataset=station_closure&day=2026-09-03&limit=5")
    assert nxt["events"][0]["incident_id"] != body["events"][0]["incident_id"]


def test_at5_replay_with_a_fixed_start_turns_the_closure_zip_red_as_september_arrives():
    """The page's replay keeps `from` (and so the baseline) fixed at Aug 25 and moves `to` one day per tick."""
    def at(day):
        return get(f"/api/summary?dataset=station_closure&from=2026-08-25&to={day}&level=zcta&id=11368")["places"][0]
    before, after = at("2026-09-10"), at("2026-09-20")
    assert before["baseline"]["from"] == after["baseline"]["from"] == "2026-06-26"
    assert before["control"] == "in_control" and before["queue"] == "needs_data"
    assert after["control"] == "out_of_control" and after["queue"] == "act_now"


def test_at5_there_is_no_incident_entry_route():
    for method in ("post", "put", "patch", "delete"):
        for route in ("/api/calls", "/api/replay", "/api/summary"):
            assert getattr(client, method)(route).status_code in (404, 405), (method, route)
    write_routes = [r.path for r in app.routes if hasattr(r, "methods") and r.methods - {"GET", "HEAD"}]
    assert write_routes == []


# ---------------------------------------------------------------- AT-6 / AT-7 removed by team decision

def test_at6_at7_stage_and_travel_routes_are_gone():
    """'What Held Up the Call' and the travel-time comparison were removed (team decision, Oct 16)."""
    for route in ("/api/delays", "/api/google"):
        assert client.get(route).status_code == 404
    assert not hasattr(qc, "stage_excess") and not hasattr(qc, "travel_vs_estimate")
    place = get(f"/api/summary?{LAST_90}&level=zcta&id=11368")["places"][0]
    assert "top_stage" not in place


# ---------------------------------------------------------------- AT-8 no what-if

def test_at8_no_whatif_route_remains():
    assert client.get("/api/whatif?fix=closer&pct=20").status_code == 404
    assert not any("whatif" in getattr(r, "path", "") for r in app.routes)
    assert not hasattr(qc, "whatif")


# ---------------------------------------------------------------- AT-9 planted scenarios and false alarms

def test_at9_closure_zip_is_act_now_from_september():
    place = get(f"/api/summary?{CLOSURE}&level=zcta&id=11368")["places"][0]
    assert place["spec"] == "below" and place["control"] == "out_of_control" and place["queue"] == "act_now"
    assert place["signals"][0]["start"] == "2026-09-01"


def test_at9_surge_county_is_flagged_in_july_august_only():
    jul = next(p for p in get(f"/api/summary?{SURGE}")["places"] if p["id"] == "36055")
    assert jul["control"] == "out_of_control" and jul["queue"] == "act_now"
    sep = next(p for p in get("/api/summary?dataset=summer_surge&from=2026-09-01&to=2026-10-15")["places"]
               if p["id"] == "36055")
    assert sep["control"] == "in_control"
    clean = next(p for p in get("/api/summary?dataset=baseline&from=2026-07-01&to=2026-08-31")["places"]
                 if p["id"] == "36055")
    assert clean["control"] == "in_control"


def test_at9_false_alarms_on_the_clean_file_are_counted_and_rare():
    """No planted change in the baseline file: control signals are false alarms. Measured, not assumed to be 0."""
    alarms = 0
    windows = [("2026-07-18", "2026-10-15"), ("2026-04-01", "2026-06-29"), ("2026-01-15", "2026-04-14")]
    for frm, to in windows:
        places = get(f"/api/summary?dataset=baseline&from={frm}&to={to}")["places"]
        alarms += sum(p["control"] == "out_of_control" for p in places)
    # measured Oct 16: 3 + 1 + 1 = 5 of 186 county-windows (2.7%); fail if it ever exceeds 10%
    assert alarms <= 0.10 * 62 * len(windows)


# ---------------------------------------------------------------- AT-10 synthetic disclosure on every response

@pytest.mark.parametrize("route", ["/api/summary", "/api/anom", "/api/pchart", "/api/imr", "/api/replay"])
def test_at10_every_statistics_route_is_labelled_synthetic(route):
    body = get(f"{route}?dataset=station_closure&level=county&id=36081&{LAST_90}")
    assert body["selection"]["source"].startswith("Synthetic") and isinstance(body["messages"], list)
    assert body["selection"]["name"] == "Queens" and body["selection"]["baseline_from"] == "2026-05-19"


# ---------------------------------------------------------------- secondary charts

def test_anom_needs_one_urgency_group_and_says_it_is_descriptive():
    one = get(f"/api/anom?{LAST_90}")
    assert one["k"] >= 2 and any("descriptive" in m for m in one["messages"])
    many = get(f"/api/anom?{LAST_90}&urgency=red,yellow")
    assert many["places"] == [] and any("ONE urgency group" in m for m in many["messages"])


def test_imr_marks_only_test_1_and_reports_assumptions():
    body = get(f"/api/imr?{CLOSURE}&level=zcta&id=11368")
    assert {"beyond_3_sigma"} <= set(body["points"][0]) and "tests" not in body["points"][0]
    assert body["n_beyond"] == sum(p["beyond_3_sigma"] for p in body["points"])
    assert body["assumptions"]["n"] > 0


def test_cpk_is_secondary_and_never_sets_the_queue():
    body = get(f"/api/summary?{LAST_90}")
    for p in body["places"]:
        assert p["queue"] == qc.queue_label(p["spec"], p["control"])


def test_empty_selection_is_200_not_500():
    body = get("/api/summary?level=zcta&id=06390&from=2026-09-16&to=2026-09-16")
    assert body["totals"]["calls"] >= 0 and body["place"]["queue"] == "needs_data"
