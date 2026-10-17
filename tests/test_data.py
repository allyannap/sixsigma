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
    assert a["minutes"] == pytest.approx(24.6)
    assert a["ln_min"] == pytest.approx(3.2027, abs=1e-4)


def test_late_flag_uses_the_urgency_target(three):
    a = three.loc["T-001"]                # red in urban ZIP 10001: red target 480 s (flat placeholder), took 1476 s
    assert a["urgency_group"] == "red" and a["target_s"] == 480 and a["late"]
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
                         "cancelled": "N", "valid_time": "Y", "held": "N"})
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
        # a configuration gap (no urban row for code 0) is an error; a bad value in the data is not (see the messy tests)
        gap = data.lookups()["targets"].query("not (urgency_code == 0 and urban_rural == 'urban')")
        data.derive(pd.read_csv(FIX / "three_calls.csv", dtype=str), targets=gap)


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
    assert len(df) == 1818312 and df.attrs["quality"]["dropped_total"] == 0
    t = time.time()
    sel = data.select(df, "county", "36081", "red", "2026-09-16", "2026-10-15")
    base, info = data.baseline(df, "county", "36081", "red", "2026-09-16", 60)
    assert time.time() - t < 2 and len(sel) > 0 and info["enough"]


# ---------------------------------------------------------------- H-10: area types and targets

def test_targets_are_looked_up_by_code_and_area_type():
    # Find one real remote ZCTA and one urban ZCTA in the lookup; same red call in each.
    # Red targets are tiered by area type (NFPA 1720-based placeholders, H-13); yellow and green are flat.
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
    tiers = {"urban": 480, "suburban": 600, "rural": 840, "remote": 840}
    assert all(t[(code, area)] == s for code in (0, 1, 2) for area, s in tiers.items())


def test_targets_table_tiers_red_and_keeps_yellow_green_flat():
    t = data.lookups()["targets"]
    assert len(t) == 40
    assert set(t.loc[t["urgency_group"] == "yellow", "target_s"]) == {900}
    assert set(t.loc[t["urgency_group"] == "green", "target_s"]) == {1800}
    assert set(t["goal_on_time_pct"]) == {90}


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


# ---------------------------------------------------------------- decisions brief: invalid records and baseline isolation

def test_invalid_records_never_enter_completed_statistics():
    """Cancelled, valid_time = N, missing t_onscene and out-of-order rows are counted as calls but never timed."""
    base = {"zcta": "10001", "urgency_code": 0, "t_received": "2026-08-01T10:00:00-04:00",
            "t_assigned": "2026-08-01T10:01:00-04:00", "t_enroute": "2026-08-01T10:02:00-04:00",
            "t_onscene": "2026-08-01T10:09:00-04:00", "cancelled": "N", "valid_time": "Y", "held": "N"}
    rows = [
        {**base, "incident_id": "OK"},
        {**base, "incident_id": "CANCELLED", "cancelled": "Y", "t_onscene": None},
        {**base, "incident_id": "INVALID", "valid_time": "N"},
        {**base, "incident_id": "NO_ONSCENE", "t_onscene": None},
        {**base, "incident_id": "ENROUTE_BEFORE_ASSIGNED", "t_enroute": "2026-08-01T10:00:30-04:00"},
        {**base, "incident_id": "ONSCENE_BEFORE_ENROUTE", "t_onscene": "2026-08-01T10:01:30-04:00"},
    ]
    df = data.derive(pd.DataFrame(rows)).set_index("incident_id")
    assert df["timed"].to_dict() == {"OK": True, "CANCELLED": False, "INVALID": False, "NO_ONSCENE": False,
                                     "ENROUTE_BEFORE_ASSIGNED": False, "ONSCENE_BEFORE_ENROUTE": False}
    assert int(df["late"].sum()) == 1                    # only the valid 9-minute call (540 s > 480 s)
    assert df["minutes"].notna().sum() == 1


def test_stage_times_add_up_to_the_total_for_every_timed_call():
    df = data.load("baseline")
    t = df[df["timed"]]
    assert ((t["dispatch_s"] + t["turnout_s"] + t["drive_s"]) == t["total_s"]).all()


def test_baseline_is_not_contaminated_by_the_monitoring_period():
    # 40 on-time calls before the period; 40 very late calls inside it. The baseline must see only the first 40.
    early = make_calls({"2026-08-01": 20, "2026-08-02": 20})
    late_rows = make_calls({"2026-09-20": 20, "2026-09-21": 20}).copy()
    late_rows["total_s"] = 5000.0
    late_rows["late"] = True
    df = pd.concat([early, late_rows]).sort_values("t_received", kind="stable").reset_index(drop=True)
    rows, info = data.baseline(df, "zcta", "10001", "red", "2026-09-16", 60)
    assert info["to"] < date(2026, 9, 16) and len(rows) == 40 and int(rows["late"].sum()) == 0


# ---------------------------------------------------------------- H-13: robust loading of messy input

MESSY = Path(__file__).resolve().parent.parent / "data" / "incidents_messy_sample.csv.xz"


@pytest.fixture(scope="module")
def messy():
    import json
    log = json.load(open(MESSY.parent / "params.json"))["messy_sample"]
    return data.read_raw(MESSY), log


def test_messy_sample_loads_without_error_and_drops_exactly_the_logged_rows(messy):
    """data/params.json "messy_sample" is the injection log: every dropped row is one the log says was injected."""
    import warnings
    raw, log = messy
    with warnings.catch_warnings():
        warnings.simplefilter("error")                      # not even a RuntimeWarning from a log of a bad time
        df = data.derive(raw)
    q = df.attrs["quality"]
    assert q["rows_in"] == len(raw) == 13327 and q["rows_kept"] == len(df)
    assert q["duplicate_id"] == log["n_exact_duplicate_rows"] + log["n_duplicate_id_different_content"] == 18
    assert q["missing_t_received"] == log["n_missing_t_received"] == 8
    assert q["unknown_zcta"] == log["n_unknown_zcta"] == 5
    assert q["unknown_urgency_code"] == log["n_unknown_urgency_code"] == 5
    assert q["dropped_total"] == 36 and len(df) == 13327 - 36
    assert df["incident_id"].is_unique


def test_messy_sample_untimed_rows_are_kept_for_volume_but_never_timed(messy):
    raw, log = messy
    df = data.derive(raw)
    q = df.attrs["quality"]
    assert q["missing_time"] == log["n_missing_t_assigned"] == 8       # t_assigned empty
    assert q["out_of_order"] == log["n_out_of_order"] == 10          # swapped or arriving before the call (measured Oct 17, H-19 file:
                                                                     # none of them also has an ordinary valid_time = N, so all 10 are counted)
    assert q["invalid_time_flag"] >= log["n_valid_time_N_with_bad_times"]   # plus the file's ordinary valid_time = N
    assert q["timed"] + q["cancelled"] + q["invalid_time_flag"] + q["missing_time"] + q["out_of_order"] == len(df)
    assert int(df["timed"].sum()) == q["timed"]
    assert df.loc[df["timed"], "total_s"].between(1, 4 * 3600).all()   # the 8-30 hour "arrivals" are valid_time N
    assert df.loc[~df["timed"] & ~df["cancelled"], "minutes"].isna().all()


def test_messy_sample_keeps_the_first_row_of_a_duplicate_id(messy):
    raw, _ = messy
    dup_ids = raw.loc[raw["incident_id"].duplicated(keep=False), "incident_id"].unique()
    first = raw.drop_duplicates("incident_id", keep="first").set_index("incident_id")
    got = data.derive(raw).set_index("incident_id")
    for i in dup_ids[:5]:
        if i in got.index:                                   # (a first row can itself be dropped for another reason)
            assert got.loc[i, "zcta"] == str(first.loc[i, "zcta"]).zfill(5)


def test_bad_values_are_dropped_and_counted_never_raised():
    ok = {"zcta": "10001", "urgency_code": 0, "t_received": "2026-08-01T10:00:00-04:00",
          "t_assigned": "2026-08-01T10:01:00-04:00", "t_enroute": "2026-08-01T10:02:00-04:00",
          "t_onscene": "2026-08-01T10:07:00-04:00", "cancelled": "N", "valid_time": "Y"}
    rows = [{**ok, "incident_id": "GOOD"},
            {**ok, "incident_id": "GOOD", "t_onscene": "2026-08-01T11:00:00-04:00"},      # duplicate id
            {**ok, "incident_id": "NO-TIME", "t_received": None},
            {**ok, "incident_id": "BAD-TIME", "t_received": "last tuesday"},
            {**ok, "incident_id": "NO-ZIP", "zcta": "99999"},
            {**ok, "incident_id": "ZIP-TEXT", "zcta": "abcde"},
            {**ok, "incident_id": "URG-99", "urgency_code": 99},
            {**ok, "incident_id": "URG-TEXT", "urgency_code": "high"},
            {**ok, "incident_id": "URG-NONE", "urgency_code": None},
            {**ok, "incident_id": "BAD-ONSCENE", "t_onscene": "soon"}]                 # kept, but not timed
    df = data.derive(pd.DataFrame(rows))
    q = df.attrs["quality"]
    assert (q["duplicate_id"], q["missing_t_received"], q["unknown_zcta"], q["unknown_urgency_code"]) == (1, 2, 2, 3)
    assert sorted(df["incident_id"]) == ["BAD-ONSCENE", "GOOD"] and q["dropped_total"] == 8
    assert df.set_index("incident_id")["timed"].to_dict() == {"BAD-ONSCENE": False, "GOOD": True}
    assert df.set_index("incident_id").loc["GOOD", "total_s"] == 420            # the FIRST row of the duplicate was kept


def test_all_rows_unusable_gives_an_empty_table_not_an_error():
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
    raw["zcta"] = "99999"
    df = data.derive(raw)
    assert len(df) == 0 and df.attrs["quality"]["unknown_zcta"] == 3 and df.attrs["quality"]["rows_kept"] == 0


def test_the_three_main_files_lose_no_rows_on_loading():
    for name in data.DATASETS:
        q = data.quality(name)
        assert q["dropped_total"] == 0 and q["rows_in"] == q["rows_kept"] == len(data.load(name))
        assert q["cancelled"] > 0 and q["timed"] > 0


def test_child_baselines_can_group_by_zcta_for_the_whole_state():
    df = make_calls({"2026-08-01": 40})
    base = data.child_baselines(df, "state", None, "red", "2026-09-16", 60, key="zcta", ids=["10001", "10002"])
    rows, info = base["10001"]
    assert len(rows) == 40 and info["enough"] and info["days"] == 60
    assert len(base["10002"][0]) == 0 and not base["10002"][1]["enough"] and base["10002"][1]["days"] == 120
    assert "10001" in data.all_zctas() and len(data.all_zctas()) > 1500


# ---------------------------------------------------------------- H-14: minimal input contract

def test_loader_reads_cancelled_flag_and_drops_eta_and_disposition():
    """The incident file has no eta_google_s and no disposition: cancelled is a Y/N column, nothing else is read."""
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
    assert "eta_google_s" not in raw.columns and "disposition" not in raw.columns
    assert raw["cancelled"].tolist() == ["N", "N", "Y"]       # T-003 is the cancelled call
    raw.loc[0, "cancelled"] = "Y"
    raw.loc[0, "t_onscene"] = None
    df = data.derive(raw)
    assert "eta_google_s" not in df.columns and "disposition" not in df.columns
    assert df["cancelled"].tolist().count(True) == 2 and not df.loc[df["cancelled"], "timed"].any()
    assert df.attrs["quality"]["cancelled"] == 2


def test_old_disposition_column_is_not_accepted():
    """A file that still has disposition and no cancelled column is refused with a clear message."""
    raw = pd.read_csv(FIX / "three_calls.csv", dtype=str)
    raw = raw.rename(columns={"cancelled": "disposition"})
    with pytest.raises(ValueError, match="cancelled"):
        data.derive(raw)
