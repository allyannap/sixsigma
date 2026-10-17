"""Tests for app/data.py: derived fields, timed flag, baseline window, selection.
Small hand-made fixtures in tests/fixtures/ (answers worked out by hand in the comments)."""
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from app import data

FIX = Path(__file__).parent / "fixtures"


def load_fixture(name):
    return data.derive(pd.read_csv(FIX / name, dtype={"incident_id": str, "zcta": str}))


@pytest.fixture(scope="module")
def three():
    return load_fixture("three_calls.csv").set_index("incident_id")


def test_step_durations_known_answer(three):
    # T-001: received 22:14:05, assigned 22:15:15, enroute 22:16:49, onscene 22:38:41
    a = three.loc["T-001"]
    assert a["dispatch_s"] == 70          # 22:15:15 - 22:14:05 = 1 min 10 s
    assert a["turnout_s"] == 94           # 22:16:49 - 22:15:15 = 1 min 34 s
    assert a["drive_s"] == 1312           # 22:38:41 - 22:16:49 = 21 min 52 s
    assert a["total_s"] == 1476           # 24 min 36 s
    assert a["dispatch_to_scene_s"] == 1406
    assert a["vs_google_s"] == 312        # 1312 - 1000
    assert a["minutes"] == pytest.approx(24.6)
    assert a["ln_min"] == pytest.approx(3.2027, abs=1e-4)


def test_late_flag_uses_the_urgency_target(three):
    a = three.loc["T-001"]                # red in urban ZIP 10001: urban red target 430 s, took 1476 s
    assert a["urgency_group"] == "red" and a["target_s"] == 430 and a["late"]
    b = three.loc["T-002"]                # green, target 1800 s, took 600 s
    assert b["urgency_group"] == "green" and b["target_s"] == 1800 and not b["late"]
    assert b["held"]


def test_date_is_new_york_calendar_date(three):
    assert three.loc["T-001", "date"] == pd.Timestamp("2026-10-10")  # 22:14 NY = 02:14 UTC next day


def test_cancelled_call_counts_in_volume_but_not_timed(three):
    c = three.loc["T-003"]
    assert not c["timed"] and not c["late"] and pd.isna(c["total_s"]) and pd.isna(c["ln_min"])
    sel = data.select(three.reset_index(), "state", None, "red,yellow,green", "2026-10-10", "2026-10-10")
    assert len(sel) == 3 and int(sel["timed"].sum()) == 2 and int(sel["late"].sum()) == 1


def test_daylight_saving_uses_real_elapsed_seconds():
    # 01:59 EST -> 03:00 EDT on 2026-03-08 is ONE real minute (the clock skips 2 AM).
    d = load_fixture("dst_call.csv").iloc[0]
    assert d["dispatch_s"] == 60
    assert d["turnout_s"] == 60
    assert d["drive_s"] == 540
    assert d["total_s"] == 660            # naive clock subtraction would give 4260
    assert d["date"] == pd.Timestamp("2026-03-08")


def test_baseline_window_dates():
    assert data.baseline_window("2026-09-16", 60) == (date(2026, 7, 18), date(2026, 9, 15))
    assert data.baseline_window("2026-09-16", 120) == (date(2026, 5, 19), date(2026, 9, 15))


def make_calls(per_day_by_date):
    """Red calls in ZIP 10001 (county 36061): {date: number of timed calls that day}."""
    rows, k = [], 0
    for d, n in per_day_by_date.items():
        for i in range(n):
            k += 1
            h = 6 + i % 12
            rows.append({"incident_id": f"X-{k:05d}", "zcta": "10001", "urgency_code": 0,
                         "t_received": f"{d}T{h:02d}:00:00-04:00", "t_assigned": f"{d}T{h:02d}:01:00-04:00",
                         "t_enroute": f"{d}T{h:02d}:02:00-04:00", "t_onscene": f"{d}T{h:02d}:07:00-04:00",
                         "disposition": "TRANSPORTED", "valid_time": "Y", "eta_google_s": 200, "held": "N"})
    return data.derive(pd.DataFrame(rows))


def test_baseline_keeps_60_days_when_enough_calls():
    df = make_calls({"2026-08-01": 20, "2026-08-02": 20})       # 40 calls inside 60 days
    rows, info = data.baseline(df, "zcta", "10001", "red", "2026-09-16", 60)
    assert (info["from"], info["to"], info["days"]) == (date(2026, 7, 18), date(2026, 9, 15), 60)
    assert info["enough"] and not info["stretched"] and len(rows) == 40


def test_baseline_stretches_to_120_days_under_30_calls():
    # 10 calls in the 60-day window, 25 more only inside the 120-day window.
    df = make_calls({"2026-08-01": 10, "2026-06-01": 25})
    rows, info = data.baseline(df, "zcta", "10001", "red", "2026-09-16", 60)
    assert info["days"] == 120 and info["stretched"] and info["from"] == date(2026, 5, 19)
    assert info["timed"] == 35 and info["enough"]


def test_baseline_not_enough_after_stretch():
    df = make_calls({"2026-08-01": 10})
    rows, info = data.baseline(df, "zcta", "10001", "red", "2026-09-16", 60)
    assert info["days"] == 120 and not info["enough"] and info["timed"] == 10


def test_empty_selection_returns_zero_rows_not_an_error():
    df = make_calls({"2026-08-01": 5})
    assert len(data.select(df, "zcta", "10001", "red", "2026-01-01", "2026-01-31")) == 0
    assert len(data.select(df, "zcta", "10001", "green", "2026-08-01", "2026-08-01")) == 0
    assert len(data.select(df, "county", "36055", "red", "2026-08-01", "2026-08-01")) == 0


def test_select_by_level():
    df = make_calls({"2026-08-01": 5})
    assert len(data.select(df, "state", None, "red", "2026-08-01", "2026-08-01")) == 5
    assert len(data.select(df, "county", "36061", "red", "2026-08-01", "2026-08-01")) == 5
    assert len(data.select(df, "zcta", "10001", "red", "2026-08-01", "2026-08-01")) == 5


def test_bad_inputs_raise_clear_errors():
    df = make_calls({"2026-08-01": 1})
    with pytest.raises(ValueError, match="unknown level"):
        data.select(df, "city", "x", "red", "2026-08-01", "2026-08-01")
    with pytest.raises(ValueError, match="unknown county"):
        data.select(df, "county", "99999", "red", "2026-08-01", "2026-08-01")
    with pytest.raises(ValueError, match="unknown urgency"):
        data.select(df, "state", None, "blue", "2026-08-01", "2026-08-01")
    with pytest.raises(ValueError, match="before"):
        data.select(df, "state", None, "red", "2026-08-02", "2026-08-01")
    with pytest.raises(ValueError, match="targets.csv"):
        raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
        raw["urgency_code"] = "42"
        data.derive(raw)


def test_out_of_order_times_are_not_timed():
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
    raw.loc[0, "t_assigned"] = "2026-10-10T22:10:00-04:00"   # assigned before received
    assert not data.derive(raw).set_index("incident_id").loc["T-001", "timed"]


def test_children():
    assert len(data.children("state")) == 62
    kids = data.children("county", "36061")
    assert "10001" in [k["id"] for k in kids]
    assert data.children("zcta", "10001") == [{"id": "10001", "name": "10001"}]


def test_subgroups_by_day_and_iso_week():
    # 2026-08-03 is a Monday. 2 calls Mon, 3 calls Wed, 4 calls next Monday.
    df = make_calls({"2026-08-03": 2, "2026-08-05": 3, "2026-08-10": 4})
    d = data.subgroups(df, "day")
    assert d["start"] == ["2026-08-03", "2026-08-05", "2026-08-10"] and d["n"] == [2, 3, 4]
    w = data.subgroups(df, "week")
    assert w["start"] == ["2026-08-03", "2026-08-10"] and w["n"] == [5, 4]
    assert data.subgroups(df.iloc[:0], "day") == {"start": [], "n": [], "late": []}


def test_real_file_row_count_and_speed():
    import time
    df = data.load("station_closure")
    assert len(df) == 399426
    t = time.time()
    sel = data.select(df, "county", "36081", "red", "2026-09-16", "2026-10-15")
    base, info = data.baseline(df, "county", "36081", "red", "2026-09-16", 60)
    assert time.time() - t < 2 and len(sel) > 0 and info["enough"]


# ---------------------------------------------------------------- H-10: area types and targets

def test_remote_zcta_call_gets_the_remote_red_target():
    # Find one real remote ZCTA and one urban ZCTA in the lookup; same red call in each.
    lk = data.lookups()["zcta_county"]
    remote = lk.loc[lk["urban_rural"] == "remote", "zcta"].iloc[0]
    urban = lk.loc[lk["urban_rural"] == "urban", "zcta"].iloc[0]
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str).iloc[[0, 0]].copy()
    raw["incident_id"] = ["R-1", "U-1"]
    raw["zcta"] = [remote, urban]
    got = data.derive(raw).set_index("incident_id")
    t = data.lookups()["targets"].set_index(["urgency_code", "urban_rural"])["target_s"]
    assert got.loc["R-1", "target_s"] == t[(0, "remote")]
    assert got.loc["U-1", "target_s"] == t[(0, "urban")]
    assert t[(0, "remote")] > t[(0, "rural")] > t[(0, "suburban")] > t[(0, "urban")]


def test_area_type_boundaries():
    sys_path_fix = Path(__file__).resolve().parent.parent / "data"
    import importlib.util
    spec = importlib.util.spec_from_file_location("build_lookups", sys_path_fix / "build_lookups.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert mod.urban_rural(3000) == "urban" and mod.urban_rural(2999.9) == "suburban"
    assert mod.urban_rural(500) == "suburban" and mod.urban_rural(499.9) == "rural"
    assert mod.urban_rural(50) == "rural" and mod.urban_rural(49.9) == "remote"
    assert mod.urban_rural(0) == "remote"


def test_ln_ratio_known_answer_and_untimed_is_nan():
    # T-001: total 1476 s against a target of 840 s: ln(1476 / 840) = 0.5637 (above 0 = late)
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
    t = pd.DataFrame({"urgency_code": range(10), "urban_rural": "urban",
                      "urgency_group": ["red"] * 3 + ["yellow"] * 3 + ["green"] * 4,
                      "target_s": 840, "goal_on_time_pct": 90})
    area = {"10001": "urban", "10002": "urban"}
    got = data.derive(raw, targets=t, zcta_to_county={"10001": "36061", "10002": "36061"},
                      zcta_to_area=area).set_index("incident_id")
    assert got.loc["T-001", "ln_ratio"] == pytest.approx(0.5637, abs=5e-4)
    assert got.loc["T-001", "late"]
    assert pd.isna(got.loc["T-003", "ln_ratio"])          # cancelled: not timed


def test_weighted_goal_is_the_mean_goal_of_timed_calls():
    df = load_fixture("three_calls.csv")
    assert data.weighted_goal(df[df["timed"]]) == 90.0
    assert data.weighted_goal(df.iloc[:0]) is None
