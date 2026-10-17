"""Tests for app/qc.py. Every known answer comes from SPEC.md section 4; tolerance 5e-4 unless noted.

Run from the repo root:  .venv/bin/python -m pytest tests/test_qc.py -v
"""
import math

import numpy as np
import pytest

from app import qc

TOL = 5e-4


def approx(v):
    return pytest.approx(v, abs=TOL)


def no_bad_numbers(obj):
    """Walk a result and fail on any inf or NaN (the rule: None plus a message instead)."""
    if isinstance(obj, dict):
        for v in obj.values():
            no_bad_numbers(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            no_bad_numbers(v)
    elif isinstance(obj, (float, np.floating)):
        assert math.isfinite(obj), "inf or NaN in output"


IMR_X = [1.0, 1.2, 0.9, 1.1, 1.3]


# ---------------------------------------------------------------- 1. p chart

def test_p_chart_known_answer():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 10], 100, 20)
    assert r["p_bar"] == approx(0.20)
    assert [p["signal"] for p in r["points"]] == [False, False, False, False, True]
    assert r["points"][4]["p"] == approx(0.5)
    assert r["points"][0]["ucl"] == approx(0.4683)
    assert r["points"][0]["lcl"] == 0.0           # 0.2 - 3 x 0.08944 is negative: floored at 0
    assert r["run_signal"] is False
    no_bad_numbers(r)


def test_p_chart_ucl_is_capped_at_one():
    r = qc.p_chart([4], [4], 10, 9)               # p-bar 0.9, n = 4: 0.9 + 3 x 0.15 > 1
    assert r["points"][0]["ucl"] == 1.0


def test_p_chart_run_of_nine_above_center():
    above = qc.p_chart([100] * 9, [30] * 9, 1000, 200)       # p = 0.3 > p-bar 0.2, 9 times
    assert above["run_signal"] is True
    eight = qc.p_chart([100] * 8 + [10], [30] * 8 + [2], 1000, 200)
    assert eight["run_signal"] is False
    broken = qc.p_chart([100] * 9, [30] * 4 + [20] + [30] * 4, 1000, 200)   # 20/100 = CL, not above
    assert broken["run_signal"] is False


@pytest.mark.parametrize("base_late", [0, 100])
def test_p_chart_pbar_zero_or_one_has_no_marks(base_late):
    r = qc.p_chart([20, 20], [0, 20], 100, base_late)
    assert not any(p["signal"] for p in r["points"])
    assert r["run_signal"] is False
    assert r["messages"]
    no_bad_numbers(r)


def test_p_chart_empty_baseline_gives_message():
    r = qc.p_chart([20], [3], 0, 0)
    assert r["p_bar"] is None and r["points"] == [] and r["messages"]


# ---------------------------------------------------------------- 1b. subgroup rule

def test_subgroup_unit_known_answers():
    assert qc.subgroup_unit(14, 0.08) == "week"     # 1.12 a day < 5, 7.84 a week >= 5
    assert qc.subgroup_unit(70, 0.08) == "day"      # 5.6 a day
    assert qc.subgroup_unit(2, 0.07) is None        # low volume
    assert qc.subgroup_unit(5, 0.0) is None
    assert qc.subgroup_unit(0, 0.5) is None
    assert qc.subgroup_unit(None, 0.5) is None


def test_subgroup_unit_month_and_boundary():
    assert qc.subgroup_unit(1, 0.2) == "month"      # 0.2 a day, 1.4 a week, 6.09 a month
    assert qc.subgroup_unit(5, 1.0) == "day"        # exactly 5 counts


# ---------------------------------------------------------------- 2. I-MR and the 8 Nelson tests

def test_imr_known_answer():
    r = qc.imr(IMR_X, IMR_X)
    assert r["mr_bar"] == approx(0.225)
    assert r["sigma"] == approx(0.19947)
    assert r["cl"] == approx(1.1)
    assert r["ucl"] == approx(1.6984)
    assert r["lcl"] == approx(0.5016)
    assert r["mr_ucl"] == approx(0.7351)
    assert [p["mr"] for p in r["points"]] == [None, approx(0.2), approx(0.3), approx(0.2), approx(0.2)]
    assert all(p["tests"] == [] for p in r["points"])
    assert [t["id"] for t in r["tests"]] == [1, 2, 3, 4, 5, 6, 7, 8]
    assert not any(t["fired"] for t in r["tests"])
    no_bad_numbers(r)


def test_imr_uses_baseline_for_limits_and_flags_a_planted_spike():
    base = [1.0, 1.2] * 15
    x = [1.1] * 10 + [3.0] + [1.1] * 4                      # one call far above the baseline limits
    r = qc.imr(x, base)
    assert r["cl"] == approx(1.1) and r["sigma"] == approx(0.1773)
    assert 1 in r["points"][10]["tests"]
    assert r["tests"][0]["fired"] is True


def test_imr_constant_baseline_has_no_sigma():
    r = qc.imr([1.0, 2.0], [1.0] * 10)
    assert r["sigma"] is None and r["ucl"] is None and r["messages"]
    assert all(p["tests"] == [] for p in r["points"])
    no_bad_numbers(r)


def test_imr_short_baseline_and_empty_selection():
    r = qc.imr([1.0, 2.0], [1.0])
    assert r["cl"] is None and r["messages"]
    r2 = qc.imr([], IMR_X)
    assert r2["points"] == [] and r2["cl"] == approx(1.1)


# Each vector is in sigma units around a center line at 0 (z-scores). A test fires at the call that completes the pattern.
def fired(z, test_id):
    return np.flatnonzero(qc.nelson_tests(np.array(z, dtype=float))[test_id]).tolist()


def test_nelson_1_beyond_three_sigma():
    assert fired([0, 3.1, 0, -3.1, 2.9], 1) == [1, 3]


def test_nelson_2_nine_on_one_side():
    assert fired([0.2] * 9, 2) == [8]
    assert fired([0.2] * 8 + [-0.2], 2) == []
    assert fired([-0.2] * 10, 2) == [8, 9]


def test_nelson_3_six_trending():
    assert fired([0, 1, 2, 3, 4, 5], 3) == [5]
    assert fired([0, 1, 2, 3, 4, 3], 3) == []
    assert fired([5, 4, 3, 2, 1, 0], 3) == [5]


def test_nelson_4_fourteen_alternating():
    z = [(-1) ** i for i in range(14)]
    assert fired(z, 4) == [13]
    assert fired(z[:13], 4) == []


def test_nelson_5_two_of_three_beyond_two_sigma():
    assert fired([0, 2.5, 0, 2.5], 5) == [3]
    assert fired([2.5, -2.5, 0], 5) == []              # one on each side is not 2 on the same side
    assert fired([2.5, 0, 0, 0, 2.5], 5) == []


def test_nelson_6_four_of_five_beyond_one_sigma():
    assert fired([1.5, 1.5, 0, 1.5, 1.5], 6) == [4]
    assert fired([1.5, 1.5, 0, 1.5, -1.5], 6) == []


def test_nelson_7_fifteen_within_one_sigma():
    assert fired([0.5, -0.5] * 7 + [0.5], 7) == [14]
    assert fired([0.5, -0.5] * 7 + [1.5], 7) == []


def test_nelson_8_eight_beyond_one_sigma_both_sides():
    assert fired([1.5, -1.5] * 4, 8) == [7]
    assert fired([1.5, -1.5] * 3 + [1.5, 0.5], 8) == []


def test_nelson_short_series_does_not_crash():
    out = qc.nelson_tests(np.array([0.0]))
    assert set(out) == set(range(1, 9)) and not any(v.any() for v in out.values())


# ---------------------------------------------------------------- 3. Cpk

def test_capability_known_answer():
    usl = math.log(8)                                        # target 8 minutes
    r = qc.capability(IMR_X, usl, 90)
    assert r["cpk"] == approx(1.6368)
    assert r["upper"] == approx(2.8803)
    assert r["bar"] == approx(0.4272)
    assert r["n"] == 5
    assert r["too_slow"] is False
    no_bad_numbers(r)


def test_capability_uses_supplied_sigma():
    usl = math.log(8)
    r = qc.capability(IMR_X, usl, 90, sigma=0.19947)
    assert r["cpk"] == approx(1.6368)


def test_capability_too_slow_when_upper_bound_below_bar():
    x = [3.0, 3.2, 2.9, 3.1, 3.3] * 20                       # mean ln 3.1 is above ln 8 = 2.08: Cpk negative
    r = qc.capability(x, math.log(8), 90)
    assert r["cpk"] < 0 and r["too_slow"] is True


def test_capability_constant_data_is_undefined():
    r = qc.capability([1.0] * 10, math.log(8), 90)
    assert r["cpk"] is None and r["upper"] is None and r["too_slow"] is False
    assert "no variation: Cpk undefined" in r["messages"]
    no_bad_numbers(r)


@pytest.mark.parametrize("x", [[], [1.0]])
def test_capability_too_few_calls(x):
    r = qc.capability(x, math.log(8), 90)
    assert r["cpk"] is None and "too few calls" in " ".join(r["messages"])


def test_capability_bad_goal():
    r = qc.capability(IMR_X, math.log(8), 100)
    assert r["cpk"] is None and r["messages"]


# ---------------------------------------------------------------- 4. P95

def test_p95_known_answer():
    r = qc.p95_boot(list(range(1, 21)))
    assert r["p95"] == approx(19.05)
    assert r["median"] == approx(10.5)
    assert r["spread"] == approx(8.55)
    lo, hi = r["ci"]
    assert 1 <= lo <= r["p95"] <= hi <= 20


def test_p95_is_reproducible_with_fixed_seed():
    x = list(np.random.default_rng(1).lognormal(2, 0.4, 300))
    assert qc.p95_boot(x)["ci"] == qc.p95_boot(x)["ci"]


def test_p95_constant_and_single_value_give_point_interval():
    assert qc.p95_boot([7.0] * 50)["ci"] == [7.0, 7.0]
    r = qc.p95_boot([4.0])
    assert r["ci"] == [4.0, 4.0] and r["p95"] == 4.0 and r["spread"] == 0.0


def test_p95_empty():
    r = qc.p95_boot([])
    assert r["p95"] is None and r["ci"] == [None, None] and r["messages"]


def test_p95_ignores_missing_values():
    r = qc.p95_boot([1, 2, 3, None, float("nan")])
    assert r["p95"] == approx(2.9)


def test_p95_large_n_uses_order_statistic_interval():
    x = np.random.default_rng(2).lognormal(2, 0.4, 20000)
    r = qc.p95_boot(x)
    true = float(np.percentile(x, 95))
    assert r["ci"][0] <= true <= r["ci"][1]
    assert r["ci"][1] - r["ci"][0] < 0.5                      # tight at n = 20,000
    assert any("order statistics" in m for m in r["messages"])


# ---------------------------------------------------------------- 5. ANOM

ANOM_GROUPS = {"A": [1, 2, 3, 2], "B": [2, 3, 4, 3], "C": [5, 6, 7, 6]}


def test_anom_known_answer():
    r = qc.anom(ANOM_GROUPS)
    assert r["grand_mean"] == approx(3.6667)
    assert r["sigma_p"] == approx(0.8165)
    assert r["h"] == approx(2.9333)
    assert (r["k"], r["N"], r["df1"], r["df2"]) == (3, 12, 2, 9)
    assert r["F"] == pytest.approx(26.0, abs=1e-6)
    g = r["groups"]
    assert g["A"]["lower"] == approx(2.6889) and g["A"]["upper"] == approx(4.6444)
    assert (g["A"]["verdict"], g["B"]["verdict"], g["C"]["verdict"]) == ("faster", "inside", "slower")
    assert g["A"]["mean"] == approx(2.0) and g["C"]["mean"] == approx(6.0)
    assert g["A"]["n"] == 4 and len(g["A"]["ci"]) == 2
    no_bad_numbers(r)


def test_anom_single_group_returns_message():
    r = qc.anom({"A": [1, 2, 3]})
    assert r["h"] is None and r["groups"] == {} and r["messages"]


def test_anom_identical_groups_have_no_variation():
    r = qc.anom({"A": [1.0, 1.0], "B": [1.0, 1.0]})
    assert r["F"] is None and r["messages"]
    no_bad_numbers(r)


def test_anom_empty_groups_are_dropped():
    r = qc.anom({**ANOM_GROUPS, "D": []})
    assert r["k"] == 3


# ---------------------------------------------------------------- 6. changed recently

BASE_X = [1.0, 1.2] * 15
SEL_X = [1.2, 1.4] * 15


def test_changed_recently_known_answer_location():
    r = qc.changed_recently(SEL_X, BASE_X, 3, 30, 3, 30)
    assert r["z_loc"] == approx(4.369)
    assert r["changed"] is True and r["reasons"]


def test_changed_recently_known_answer_proportion_alone_is_not_enough():
    r = qc.changed_recently(BASE_X, BASE_X, 12, 30, 3, 30)      # same ln-minutes: no shift in location
    assert r["z_p"] == approx(2.683)
    assert r["z_loc"] == approx(0.0)
    assert r["changed"] is False


def test_changed_recently_proportion_alone_can_flag():
    r = qc.changed_recently(BASE_X, BASE_X, 20, 30, 3, 30)
    assert r["z_p"] > 3 and r["changed"] is True


def test_changed_recently_z_exactly_three_is_not_changed():
    # n = 200 each, 85 and 115 late: p_pool 0.5, Z_p = 0.15 / 0.05 = 3 exactly
    r = qc.changed_recently(BASE_X, BASE_X, 115, 200, 85, 200)
    assert r["z_p"] == pytest.approx(3.0)
    assert r["changed"] is False
    r2 = qc.changed_recently(BASE_X, BASE_X, 116, 200, 85, 200)
    assert r2["changed"] is True


def test_changed_recently_only_upward_shifts_count():
    r = qc.changed_recently(BASE_X, SEL_X, 3, 30, 3, 30)         # selection FASTER than baseline
    assert r["z_loc"] < -3 and r["changed"] is False


def test_changed_recently_needs_30_each():
    r = qc.changed_recently(SEL_X[:29], BASE_X, 12, 29, 3, 30)
    assert r["changed"] is False and r["z_loc"] is None and r["messages"]
    r2 = qc.changed_recently(SEL_X, BASE_X[:29], 3, 30, 3, 29)
    assert r2["changed"] is False and r2["messages"]


def test_changed_recently_constant_baseline_gives_no_z_loc():
    r = qc.changed_recently(SEL_X, [1.0] * 30, 3, 30, 3, 30)
    assert r["z_loc"] is None and r["messages"]
    no_bad_numbers(r)


def test_changed_recently_z_p_needs_five_expected_each_way():
    r = qc.changed_recently(BASE_X, BASE_X, 4, 30, 0, 30)        # p_pool 0.067: n p_pool = 2 < 5
    assert r["z_p"] is None


def test_changed_recently_all_zero_late_does_not_divide_by_zero():
    r = qc.changed_recently(BASE_X, BASE_X, 0, 30, 0, 30)
    assert r["z_p"] is None and r["changed"] is False
    no_bad_numbers(r)


# ---------------------------------------------------------------- 6b. status

@pytest.mark.parametrize("too_slow,changed,expected", [
    (True, True, "act_now"),
    (False, True, "recent_change"),
    (True, False, "ongoing_gap"),
    (False, False, "on_track"),
])
def test_status_truth_table(too_slow, changed, expected):
    assert qc.status(too_slow, changed, 100, 100) == expected


def test_status_boundaries():
    assert qc.status(True, True, 30, 30) == "act_now"            # 30 is enough
    assert qc.status(True, True, 29, 100) == "not_enough"
    assert qc.status(True, True, 100, 29) == "not_enough"
    assert qc.status(False, False, 0, 0) == "not_enough"


def test_status_bound_equal_to_bar_is_not_too_slow():
    # capability(): upper exactly equal to the bar must not be called too slow. Use a stub value through the rule.
    assert qc.is_too_slow(0.4272, 0.4272) is False
    assert qc.is_too_slow(0.4271, 0.4272) is True
    assert qc.is_too_slow(None, 0.4272) is False


# ---------------------------------------------------------------- 7. fault tree

def around(median, sd_ln):
    """Three values whose median is `median` and whose sample sd of ln is exactly `sd_ln`."""
    return [median * math.exp(sd_ln), median, median * math.exp(-sd_ln)]


def baseline_calls():
    d, t, e, r = around(60, 0.5), around(70, 0.35), around(300, 0.45), around(0.88, 0.15)
    return [{"dispatch_s": d[i], "turnout_s": t[i], "eta_google_s": e[i], "drive_s": e[i] * r[i], "held": "N"}
            for i in range(3)]


LATE = {"dispatch_s": 120, "turnout_s": 75, "eta_google_s": 450, "drive_s": 396, "held": "N"}


def test_fault_tree_known_answer_names_the_911_center():
    r = qc.fault_tree([LATE], baseline_calls())
    z = r["z"][0]
    assert z[0] == approx(1.386) and z[1] == approx(0.197) and z[2] == approx(0.901) and z[3] == approx(0.0)
    assert r["per_call"] == ["dispatch"]
    assert r["counts"] == {"held": 0, "dispatch": 1, "turnout": 0, "long_trip": 0, "slow_drive": 0, "typical_late": 0}
    assert r["base"]["dispatch_s"]["median"] == approx(60) and r["base"]["dispatch_s"]["sd_ln"] == approx(0.5)
    no_bad_numbers(r)


def test_fault_tree_held_is_always_no_ambulance_free():
    r = qc.fault_tree([{**LATE, "held": "Y"}], baseline_calls())
    assert r["per_call"] == ["held"] and r["counts"]["held"] == 1


def test_fault_tree_typical_late_when_every_z_is_not_positive():
    easy = {"dispatch_s": 50, "turnout_s": 60, "eta_google_s": 250, "drive_s": 200, "held": "N"}
    r = qc.fault_tree([easy], baseline_calls())
    assert r["per_call"] == ["typical_late"] and r["counts"]["typical_late"] == 1


def test_fault_tree_long_trip_and_slow_drive():
    trip = {"dispatch_s": 60, "turnout_s": 70, "eta_google_s": 900, "drive_s": 792, "held": "N"}   # ratio 0.88
    slow = {"dispatch_s": 60, "turnout_s": 70, "eta_google_s": 300, "drive_s": 600, "held": "N"}   # ratio 2.0
    r = qc.fault_tree([trip, slow], baseline_calls())
    assert r["per_call"] == ["long_trip", "slow_drive"]


def test_fault_tree_without_google_columns_still_names_a_step():
    base = [{k: v for k, v in c.items() if k not in ("eta_google_s", "drive_s")} for c in baseline_calls()]
    late = {"dispatch_s": 120, "turnout_s": 75, "held": "N"}
    r = qc.fault_tree([late], base)
    assert r["per_call"] == ["dispatch"]


def test_fault_tree_empty_inputs():
    r = qc.fault_tree([], baseline_calls())
    assert sum(r["counts"].values()) == 0 and r["per_call"] == []
    r2 = qc.fault_tree([LATE], [])
    assert r2["messages"] and r2["per_call"] == ["typical_late"]
    no_bad_numbers(r2)


def test_fault_tree_baseline_with_no_spread_skips_that_step():
    flat = [{"dispatch_s": 60, "turnout_s": 70, "eta_google_s": 300, "drive_s": 264, "held": "N"}] * 5
    r = qc.fault_tree([LATE], flat)
    assert r["messages"] and r["per_call"] == ["typical_late"]


# ---------------------------------------------------------------- 8. what-if

def wi_calls():
    return [{"total_s": t, "turnout_s": 100, "dispatch_s": 60, "drive_s": t - 160, "held": "N", "target_s": 480}
            for t in (400, 500, 520, 300)]


def test_whatif_known_answer_crew_faster():
    r = qc.whatif(wi_calls(), "crew_faster", 20, 60)
    assert r["now"]["late"] == 2 and r["with_fix"]["late"] == 1 and r["avoided"] == 1
    assert r["now"]["pct_late"] == 50.0 and r["with_fix"]["pct_late"] == 25.0
    assert r["with_fix"]["p95_min"] < r["now"]["p95_min"]
    no_bad_numbers(r)


def test_whatif_closer_and_center_faster():
    c = qc.whatif(wi_calls(), "closer", 50, 60)
    assert c["with_fix"]["late"] == 0                           # drives 340, 360 ... halved
    d = qc.whatif(wi_calls(), "center_faster", 100, 60)         # dispatch 60 s -> 0: 340, 440, 460, 240
    assert d["with_fix"]["late"] == 0 and d["avoided"] == 2


def test_whatif_add_ambulance_only_changes_held_calls():
    calls = wi_calls()
    calls[1].update(held="Y", dispatch_s=200)                   # 500 s call, dispatch cut from 200 to the median 60
    r = qc.whatif(calls, "add_ambulance", 0, 60)
    assert r["now"]["late"] == 2 and r["with_fix"]["late"] == 1   # 500 -> 360; 520 stays late
    none_held = qc.whatif(wi_calls(), "add_ambulance", 0, 60)
    assert none_held["avoided"] == 0


def test_whatif_add_ambulance_never_makes_a_call_slower():
    calls = [{"total_s": 500, "turnout_s": 0, "dispatch_s": 30, "drive_s": 470, "held": "Y", "target_s": 480}]
    r = qc.whatif(calls, "add_ambulance", 0, 60)                # median 60 > this call's 30: left alone
    assert r["with_fix"]["late"] == 1


def test_whatif_unknown_fix_raises():
    with pytest.raises(ValueError):
        qc.whatif(wi_calls(), "magic", 20, 60)


def test_whatif_empty_and_bad_pct():
    r = qc.whatif([], "closer", 20, 60)
    assert r["now"]["late"] == 0 and r["now"]["p95_min"] is None and r["messages"]
    with pytest.raises(ValueError):
        qc.whatif(wi_calls(), "closer", 150, 60)


def test_whatif_add_ambulance_without_median_says_so():
    r = qc.whatif(wi_calls(), "add_ambulance", 0, None)
    assert r["avoided"] == 0 and r["messages"]
