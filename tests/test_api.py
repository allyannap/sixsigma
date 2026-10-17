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
    assert body["rows"] == {"baseline": 1818312, "station_closure": 1818312, "summer_surge": 1822235}
    for name in body["datasets"]:                      # nothing dropped on loading; untimed calls are counted by reason
        q = body["quality"][name]
        assert q["dropped_total"] == 0 and q["rows_kept"] == body["rows"][name]
        assert {"duplicate_id", "missing_t_received", "unknown_zcta", "unknown_urgency_code", "cancelled",
                "invalid_time_flag", "missing_time", "out_of_order", "timed"} <= set(q)


def test_meta_has_62_counties_40_targets_and_the_90_day_default():
    body = get("/api/meta")
    assert len(body["counties"]) == 62 and len(body["targets"]) == 40
    assert body["date_min"] == "2025-10-16" and body["date_max"] == "2026-10-15"
    # the first start date with the default 60-day baseline before it (Oct 16 + 60 days)
    assert body["earliest_from"] == "2025-12-15"
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
    assert body["control"] == "out_of_control" and body["signals"] and body["watch"] is False
    assert body["dispersion"] is not None and "ratio" in body["dispersion"]
    for pt in body["points"]:                          # exact binomial tail; a signal needs it under 0.00135
        assert 0 <= pt["p_value"] <= 1
        assert pt["signal"] == (pt["p"] > pt["ucl"] and pt["p_value"] < qc.ALPHA_POINT)
    assert all(sg["p_value"] < qc.ALPHA_POINT for sg in body["signals"])


def test_pchart_returns_the_baseline_screen():
    body = get(f"/api/pchart?dataset=baseline&{LAST_90}&level=county&id=36055")
    b = body["baseline"]
    assert {"from", "to", "days", "valid", "stretched", "enough", "p_bar", "checked", "stable", "reasons",
            "removed", "removed_starts", "dispersion"} <= set(b)
    assert b["checked"] and isinstance(b["stable"], bool) and isinstance(b["reasons"], list)
    assert b["removed"] == len(b["removed_starts"]) and {"ratio", "p_value", "overdispersed"} <= set(b["dispersion"])
    # the chart is drawn from the screened baseline: its centre line is the screened p-bar, on fewer calls if any were dropped
    assert body["p_bar"] == pytest.approx(b["p_bar"], abs=1e-4) and body["base_n"] <= b["valid"]
    if b["removed"] == 0:
        assert body["base_n"] == b["valid"]


def test_an_unstable_baseline_makes_the_place_insufficient_not_in_control():
    """Suffolk's clean baseline has too many unusual periods (measured Oct 17): the rule refuses to set limits."""
    places = get("/api/summary?dataset=baseline&from=2026-07-18&to=2026-10-15")["places"]
    unstable = [p for p in places if p["baseline"]["checked"] and not p["baseline"]["stable"]]
    assert unstable, "expected at least one county with an unstable baseline on the clean file"
    for p in unstable:
        assert p["control"] == "insufficient_baseline" and p["queue"] == "needs_data"
        assert p["baseline"]["reasons"] and "baseline is not stable" in p["control_reason"]


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
    assert all(isinstance(e["cancelled"], bool) and "disposition" not in e for e in body["events"])
    nxt = get("/api/replay?dataset=station_closure&day=2026-09-03&limit=5")
    assert nxt["events"][0]["incident_id"] != body["events"][0]["incident_id"]


def test_at5_replay_with_a_fixed_start_turns_the_closure_zip_red_as_september_arrives():
    """The page's replay keeps `from` (and so the baseline) fixed at Aug 25 and moves `to` one day per tick.

    Measured Oct 17 with the H-19 data (0.09 calls per person per year): in control through Sep 3 (a watch chip on
    Sep 3), out of control from Sep 4 to the last day, Oct 15, Act now from Sep 8 (the H-17 file: from Sep 3).
    """
    def at(day):
        return get(f"/api/summary?dataset=station_closure&from=2026-08-25&to={day}&level=zcta&id=11368")["places"][0]
    before, after = at("2026-09-10"), at("2026-09-20")
    assert before["baseline"]["from"] == after["baseline"]["from"] == "2026-06-26"
    assert before["control"] == "out_of_control" and before["queue"] == "act_now"
    assert after["control"] == "out_of_control" and after["queue"] == "act_now"
    for day in ("2026-08-25", "2026-09-02", "2026-09-03"):
        assert at(day)["control"] == "in_control", day
    for day in ("2026-09-04", "2026-09-05", "2026-09-18", "2026-09-19", "2026-10-01", "2026-10-15"):
        assert at(day)["control"] == "out_of_control", day


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
    # measured Oct 17 (H-19 data): 407 valid calls, 72.2% on time (95% CI 67.7-76.4), September and October both signal
    assert (place["valid"], place["on_time_pct"]) == (407, 72.2) and len(place["signals"]) == 2
    assert place["watch"] is False and place["excess_late"] > 0


def test_at9_closure_zip_is_not_flagged_on_the_clean_file():
    place = get("/api/summary?dataset=baseline&from=2026-09-01&to=2026-10-15&level=zcta&id=11368")["places"][0]
    assert place["control"] == "in_control" and place["spec"] == "inconclusive" and place["queue"] == "needs_data"


def test_at9_surge_county_is_flagged_in_july_august_only():
    jul = next(p for p in get(f"/api/summary?{SURGE}")["places"] if p["id"] == "36055")
    assert jul["control"] == "out_of_control" and jul["queue"] == "act_now"
    sep = next(p for p in get("/api/summary?dataset=summer_surge&from=2026-09-01&to=2026-10-15")["places"]
               if p["id"] == "36055")
    # measured Oct 17 (H-19 data): not flagged, but the 60-day baseline (Jul 3 to Aug 31) holds the surge and is
    # overdispersed (chi-square / df = 2.10), so there are no limits: "insufficient baseline", not "in control".
    assert sep["control"] == "insufficient_baseline" and sep["queue"] == "needs_data" and sep["spec"] == "meets"
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
    # measured Oct 17 with the H-19 data (0.09 calls per person per year) and the H-13 rules: Erie 1 + Orange 1 + Greene 1
    # = 3 of 186 county-windows (1.6%); fail above 10%. (data/sensitivity.py: 2 of 186 for the red 90-day windows ending
    # Oct 15, 3 of 186 for yellow.)
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


@pytest.mark.parametrize('urgency,target', [('red', 8), ('yellow', 15), ('green', 30)])
def test_response_profile_matches_valid_calls_and_existing_status(urgency, target):
    from app.main import Ctx
    ctx = Ctx('baseline', '2026-07-18', '2026-10-15', urgency, 'county', '36081', 60)
    body = get(f'/api/summary?{LAST_90}&urgency={urgency}&level=county&id=36081')
    for p in body['places']:
        calls = ctx.timed[ctx.timed.zcta == p['id']]
        r = p['response_profile']
        assert r == qc.response_profile(calls.minutes.tolist(), (calls.target_s / 60).tolist())
        assert r['n'] == p['valid']
        if r['n']:
            targets = (calls.target_s / 60).unique()
            assert r['target_min'] == (float(targets[0]) if len(targets) == 1 else None)
            if urgency != 'red':
                assert r['target_min'] == target
            assert r['over_target_pct'] == pytest.approx(100 * p['late'] / p['valid'])
        expected = qc.on_time(p['valid'], p['on_time'], p['goal_pct'] or 90)
        assert p['spec'] == expected['status']


def test_response_profiles_empty_and_replay_window():
    empty = get('/api/summary?from=2027-01-01&to=2027-01-02&level=zcta&id=11368')
    assert empty['places'][0]['response_profile']['n'] == 0
    assert empty['places'][0]['response_profile']['p90_min'] is None
    before = get('/api/summary?dataset=station_closure&from=2026-08-25&to=2026-09-01&level=zcta&id=11368')
    after = get('/api/summary?dataset=station_closure&from=2026-08-25&to=2026-09-20&level=zcta&id=11368')
    assert after['places'][0]['response_profile']['n'] > before['places'][0]['response_profile']['n']
    assert after['selection']['baseline_from'] == before['selection']['baseline_from']


def test_area_mix_counts_valid_calls_by_area_type_and_is_none_when_empty():
    from app.main import Ctx
    ctx = Ctx('baseline', '2026-07-18', '2026-10-15', 'red', 'state', None, 60)
    body = get(f'/api/summary?{LAST_90}&urgency=red')
    for p in body['places']:
        mix, calls = p['area_mix'], ctx.timed[ctx.timed.county_fips == p['id']]
        if not len(calls):
            assert mix is None
            continue
        assert set(mix) == set(data.AREA_TYPES) and sum(mix.values()) == pytest.approx(100, abs=0.3)
        for t in data.AREA_TYPES:
            assert mix[t] == pytest.approx(100 * (calls.urban_rural == t).sum() / len(calls), abs=0.051)
    empty = get('/api/summary?from=2027-01-01&to=2027-01-02&level=zcta&id=11368')
    assert empty['places'][0]['area_mix'] is None


def test_calls_by_urgency_counts_every_group_whatever_the_filter():
    red = get(f'/api/summary?{LAST_90}&urgency=red&level=county&id=36055')
    every = get(f'/api/summary?{LAST_90}&urgency=red,yellow,green&level=county&id=36055')
    for r, e in zip(red['places'], every['places']):
        assert r['calls_by_urgency'] == e['calls_by_urgency']
        assert set(r['calls_by_urgency']) == set(data.GROUPS)
        assert r['calls_by_urgency']['red'] == r['calls']
        assert sum(e['calls_by_urgency'].values()) == e['calls']
# ---------------------------------------------------------------- H-13: new fields on the place card and summary

def test_place_card_counts_cancelled_invalid_and_calls_per_day():
    body = get(f"/api/summary?{LAST_90}&level=county&id=36081")
    for p in [body["place"], *body["places"]]:
        assert p["valid"] + p["cancelled"] + p["invalid"] == p["calls"] and p["invalid"] >= 0
        assert p["cancel_pct"] is None if p["calls"] == 0 else p["cancel_pct"] == pytest.approx(100 * p["cancelled"] / p["calls"], abs=0.06)
        assert p["calls_per_day"] == pytest.approx(p["calls"] / 90, abs=0.006)
        assert isinstance(p["watch"], bool) and (not p["watch"] or p["control"] == "in_control")
        assert p["excess_late"] == (None if not p["valid"] else pytest.approx(
            p["late"] - (1 - p["goal_pct"] / 100) * p["valid"], abs=0.06))
    place = body["place"]
    assert place["base_calls_per_day"] > 0
    assert body["totals"]["cancelled"] == place["cancelled"] and body["totals"]["invalid"] == place["invalid"]


def test_summary_chance_below_matches_qc_on_the_same_places():
    body = get(f"/api/summary?{LAST_90}")
    cb = body["chance_below"]
    want = qc.chance_below([p["valid"] for p in body["places"]], body["totals"]["goal_pct"])
    assert cb["expected"] == pytest.approx(want["expected"], abs=0.006) and cb["n_places"] == want["n_places"]
    assert cb["observed_below"] == sum(p["spec"] == "below" for p in body["places"])
    # measured Oct 17 (H-19 data): ~1.75 of 62 counties expected below by chance alone if every county truly met the goal
    # (39 are Below: the rural gaps are conclusive)
    assert 1.0 < cb["expected"] < 3.0


def test_percentile_bounds_may_be_null_when_there_are_too_few_calls():
    """Exact intervals need calls: the P95 upper bound needs 59, the median interval 6. Null, never a made-up number."""
    one_day = get("/api/summary?dataset=station_closure&level=zcta&id=11368&from=2026-09-01&to=2026-09-07")
    for card in (one_day["place"], one_day["places"][0]):
        assert 6 <= card["valid"] < 59
        assert card["median_ci"][0] is not None and card["median_ci"][1] is not None
        assert card["p95_ci"][1] is None and card["p95_min"] is not None
    assert any("P95" in m for m in one_day["messages"])
    tiny = get("/api/summary?dataset=station_closure&level=zcta&id=11368&from=2026-09-02&to=2026-09-02")["place"]
    assert tiny["valid"] < 6 and tiny["median_ci"] == [None, None] and tiny["p95_ci"][1] is None  # lower bound may exist
    big = get(f"/api/summary?{LAST_90}")["totals"]
    assert None not in big["median_ci"] and None not in big["p95_ci"]


# ---------------------------------------------------------------- H-13: statewide flagged list

def test_flagged_lists_the_closure_zip_statewide_and_almost_nothing_on_the_clean_file():
    body = get(f"/api/flagged?dataset=station_closure&{LAST_90}")
    assert body["scope"] == "statewide" and body["n_flagged"] == len(body["flagged"])
    hit = next(h for h in body["flagged"] if h["id"] == "11368")
    assert hit["queue"] == "act_now" and hit["county"] == "Queens" and hit["county_fips"] == "36081"
    assert {"id", "county", "valid", "on_time_pct", "on_time_ci", "spec", "control", "queue", "signals",
            "excess_late"} <= set(hit)
    assert hit["valid"] >= 30 and hit["excess_late"] > 0 and hit["signals"]
    assert all(h["queue"] in ("act_now", "recent_change") and h["valid"] >= 30 for h in body["flagged"])
    # the same list whatever county is on screen: it does not depend on level and id
    other = get(f"/api/flagged?dataset=station_closure&{LAST_90}&level=county&id=36055")
    assert [h["id"] for h in other["flagged"]] == [h["id"] for h in body["flagged"]]
    clean = get(f"/api/flagged?dataset=baseline&{LAST_90}")
    # measured Oct 17 (H-19 data): 807 ZIPs with 30+ red calls, ONE flagged (11212, Kings, Recent change: a false alarm,
    # 0.12%); the closure file has that ZIP too, plus 11368. So the clean file may flag a few ZIPs by chance, never 11368.
    assert clean["n_checked"] > 300 and len(clean["flagged"]) <= 0.01 * clean["n_checked"]
    assert "11368" not in [h["id"] for h in clean["flagged"]]


def test_flagged_chance_below_is_counted_over_the_zips_checked():
    body = get(f"/api/flagged?{LAST_90}")
    cb = body["chance_below"]
    assert cb["n_places"] == body["n_checked"] and cb["expected"] > 0
    # measured Oct 17 (H-19 data): 807 ZIPs, ~25.6 expected below by chance if every ZIP truly met the goal; 94 are
    # Below (the rural and remote ZIPs, by design), 11.6% of the ZIPs checked
    assert cb["observed_below"] <= 0.15 * cb["n_places"]


def test_flagged_is_read_only_and_fast_enough():
    import time
    t = time.time()
    get(f"/api/flagged?{LAST_90}")
    assert time.time() - t < 3.0                                      # measured about 1 s
    assert client.post("/api/flagged").status_code in (404, 405)


# ---------------------------------------------------------------- H-13: stage medians and the calls behind a signal

def test_stages_gives_plain_medians_for_the_period_beside_the_baseline():
    body = get(f"/api/stages?{CLOSURE}&level=zcta&id=11368")
    now, base = body["now"], body["base"]
    assert set(now) == {"dispatch_s", "turnout_s", "drive_s", "held_pct", "n"} == set(base)
    assert now["n"] == 407 and base["n"] > 100
    assert now["drive_s"] > 1.5 * base["drive_s"]                    # the planted 60% longer drives
    assert abs(now["dispatch_s"] - base["dispatch_s"]) < 30         # dispatch is untouched
    assert "excess" not in str(body).lower() and "cause" not in str(body).lower()
    empty = get("/api/stages?level=zcta&id=06390&from=2026-09-16&to=2026-09-16")
    assert empty["now"]["n"] == 0 and empty["now"]["drive_s"] is None and empty["messages"]


def test_signal_calls_are_the_timed_calls_of_the_period_newest_first():
    body = get(f"/api/signal_calls?{CLOSURE}&level=zcta&id=11368&start=2026-09-01&end=2026-09-30&limit=10")
    df = data.load("station_closure")
    sel = data.select(df, "zcta", "11368", "red", "2026-09-01", "2026-09-30")
    timed = sel[sel["timed"]]
    assert body["valid"] == len(timed) and body["late"] == int(timed["late"].sum()) and body["returned"] == 10
    calls = body["calls"]
    assert [c["t_received"] for c in calls] == sorted((c["t_received"] for c in calls), reverse=True)
    assert all("2026-09-01" <= c["t_received"][:10] <= "2026-09-30" and c["zcta"] == "11368" for c in calls)
    assert calls[0]["incident_id"] == timed.iloc[-1]["incident_id"]
    for c in calls:
        assert c["total_s"] == c["dispatch_s"] + c["turnout_s"] + c["drive_s"]
        assert isinstance(c["late"], bool) and isinstance(c["held"], bool)


def test_signal_calls_defaults_and_errors():
    whole = get(f"/api/signal_calls?{CLOSURE}&level=zcta&id=11368&limit=500")
    assert (whole["start"], whole["end"]) == ("2026-09-01", "2026-10-15") and whole["returned"] == whole["valid"] == 407
    assert client.get("/api/signal_calls?start=2026-09-10&end=2026-09-01").status_code == 400
    assert client.get("/api/signal_calls?start=yesterday").status_code == 400
    assert client.get("/api/signal_calls?limit=0").status_code == 422


def test_anom_names_its_reference_and_warns_about_geography():
    body = get(f"/api/anom?{LAST_90}")
    assert body["reference"] == "call-weighted mean of the places"
    assert any("geography" in m for m in body["messages"])


@pytest.mark.parametrize('dataset,level,place,from_,to,unit', [
    ('baseline', 'state', None, '2026-05-31', '2026-10-15', 'day'),
    ('summer_surge', 'county', '36055', '2026-07-03', '2026-08-12', 'week'),
    ('station_closure', 'zcta', '11368', '2026-08-25', '2026-09-20', 'month'),
    ('baseline', 'state', None, '2026-09-06', '2026-09-06', 'day'),
    ('baseline', 'state', None, '2025-12-30', '2026-01-03', 'day'),
])
def test_every_pchart_point_matches_calls_inside_the_inclusive_selection(dataset, level, place, from_, to, unit):
    """Independent calendar grouping: no data.select or data.subgroups in the expected result."""
    from datetime import date, timedelta
    import calendar

    params = {'dataset': dataset, 'level': level, 'from': from_, 'to': to, 'urgency': 'red'}
    if place:
        params['id'] = place
    response = client.get('/api/pchart', params=params)
    assert response.status_code == 200
    body = response.json()
    assert body['unit'] == unit and body['points']
    assert body['baseline']['to'] < from_

    rows = data.load(dataset)
    days = rows.t_received.dt.tz_convert('America/New_York').dt.date
    mask = rows.timed & (rows.urgency_group == 'red') & (days >= date.fromisoformat(from_)) & (days <= date.fromisoformat(to))
    if level != 'state':
        mask &= rows['county_fips' if level == 'county' else 'zcta'] == place
    selected = rows[mask]
    selected_days = days[mask]
    assert sum(p['n'] for p in body['points']) == len(selected)
    assert sum(p['late'] for p in body['points']) == int(selected.late.sum())
    for point in body['points']:
        start = date.fromisoformat(point['start'])
        if unit == 'day':
            end = start
        elif unit == 'week':
            assert start.weekday() == 0
            end = start + timedelta(days=6)
        else:
            assert start.day == 1
            end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
        first = max(start, date.fromisoformat(from_))
        last = min(end, date.fromisoformat(to))
        calls = selected[(selected_days >= first) & (selected_days <= last)]
        assert point['n'] == len(calls) > 0
        assert point['late'] == int((calls.total_s > calls.target_s).sum())
        assert point['p'] == pytest.approx(point['late'] / len(calls))
        baseline_rate = body['base_late'] / body['base_n']
        margin = 3 * math.sqrt(baseline_rate * (1 - baseline_rate) / len(calls))
        assert point['ucl'] == pytest.approx(min(1, baseline_rate + margin))
        assert point['lcl'] == pytest.approx(max(0, baseline_rate - margin))
