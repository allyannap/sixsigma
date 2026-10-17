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


def test_cpk_bound_equal_to_bar_is_not_too_slow():
    # capability(): upper exactly equal to the bar must not be called too slow. Use a stub value through the rule.
    assert qc.is_too_slow(0.4272, 0.4272) is False
    assert qc.is_too_slow(0.4271, 0.4272) is True
    assert qc.is_too_slow(None, 0.4272) is False



# ---------------------------------------------------------------- 4. P95

def test_p95_known_answer():
    r = qc.p95_boot(list(range(1, 21)))
    assert r["p95"] == approx(19.05)
    assert r["p90"] == approx(18.1)                          # 1 + 0.9 x 19
    assert r["median"] == approx(10.5)
    assert r["spread"] == approx(8.55)
    lo, hi = r["ci"]
    assert 1 <= lo <= r["p95"] <= hi <= 20
    mlo, mhi = r["median_ci"]
    assert 1 <= mlo <= 10.5 <= mhi <= 20


def test_p95_is_reproducible_with_fixed_seed():
    x = list(np.random.default_rng(1).lognormal(2, 0.4, 300))
    assert qc.p95_boot(x)["ci"] == qc.p95_boot(x)["ci"]


def test_p95_constant_and_single_value_give_point_interval():
    assert qc.p95_boot([7.0] * 50)["ci"] == [7.0, 7.0]
    r = qc.p95_boot([4.0])
    assert r["ci"] == [4.0, 4.0] and r["p95"] == 4.0 and r["spread"] == 0.0 and r["median_ci"] == [4.0, 4.0]


def test_p95_empty():
    r = qc.p95_boot([])
    assert r["p95"] is None and r["ci"] == [None, None] and r["median_ci"] == [None, None] and r["messages"]


def test_p95_ignores_missing_values():
    r = qc.p95_boot([1, 2, 3, None, float("nan")])
    assert r["p95"] == approx(2.9)


def test_p95_large_n_uses_order_statistic_interval():
    x = np.random.default_rng(2).lognormal(2, 0.4, 20000)
    r = qc.p95_boot(x)
    true = float(np.percentile(x, 95))
    assert r["ci"][0] <= true <= r["ci"][1]
    assert r["ci"][1] - r["ci"][0] < 0.5                      # tight at n = 20,000
    assert r["median_ci"][0] <= float(np.median(x)) <= r["median_ci"][1]
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


# ---------------------------------------------------------------- 6. A. specification: on-time rate and Wilson interval

# Wilson by hand, z = 1.959964, z^2 = 3.841459.
# 85 / 100: centre (0.85 + 0.019207) / 1.038415 = 0.837053; half 1.959964 sqrt(0.001275 + 0.000096) / 1.038415 = 0.069888.
def test_wilson_known_answer():
    lo, hi = qc.wilson_ci(85, 100)
    assert lo == approx(0.76716) and hi == approx(0.90694)


def test_wilson_stays_inside_zero_one_and_is_not_a_point_at_the_ends():
    lo, hi = qc.wilson_ci(20, 20)
    assert lo == approx(0.83887) and hi == 1.0
    lo0, hi0 = qc.wilson_ci(0, 20)
    assert lo0 == 0.0 and 0 < hi0 < 0.2
    assert qc.wilson_ci(0, 0) == [None, None]
    with pytest.raises(ValueError):
        qc.wilson_ci(5, 3)


# 300 calls, goal 90%. 285 on time: [0.91915, 0.96947] (lower >= 0.90: meets).
# 255 on time: [0.80518, 0.88597] (upper < 0.90: below). 270 on time: [0.86083, 0.92905] (includes 0.90).
@pytest.mark.parametrize("k,status,lo,hi", [
    (285, "meets", 0.91915, 0.96947),
    (255, "below", 0.80518, 0.88597),
    (270, "inconclusive", 0.86083, 0.92905),
])
def test_on_time_hand_worked_classification(k, status, lo, hi):
    r = qc.on_time(300, k, 90)
    assert r["status"] == status
    assert r["ci"][0] == approx(lo) and r["ci"][1] == approx(hi)
    assert r["on_time_rate"] == approx(k / 300) and r["late_rate"] == approx(1 - k / 300)
    assert r["n_late"] == 300 - k and r["goal"] == 0.9
    no_bad_numbers(r)


def test_spec_interval_boundaries():
    assert qc.spec_from_interval(0.9, 0.95, 0.9) == "meets"          # lower bound exactly the goal meets
    assert qc.spec_from_interval(0.85, 0.9, 0.9) == "inconclusive"   # upper bound exactly the goal is not below
    assert qc.spec_from_interval(0.85, 0.8999, 0.9) == "below"
    assert qc.spec_from_interval(None, None, 0.9) == "inconclusive"


def test_inconclusive_is_never_success_small_samples_and_bad_inputs():
    small = qc.on_time(20, 0, 90)                  # 0 of 20 on time would be "below" by the interval alone
    assert small["status"] == "inconclusive" and "insufficient data" in small["reason"]
    assert small["on_time_rate"] == 0.0 and small["ci"][1] < 0.2   # the numbers are still shown
    perfect = qc.on_time(29, 29, 90)               # 29 of 29 on time is still not "meets"
    assert perfect["status"] == "inconclusive"
    empty = qc.on_time(0, 0, 90)
    assert empty["status"] == "inconclusive" and empty["on_time_rate"] is None and empty["ci"] == [None, None]
    bad_goal = qc.on_time(300, 290, 100)
    assert bad_goal["status"] == "inconclusive" and bad_goal["messages"]
    for r in (small, perfect, empty, bad_goal):
        assert r["status"] != "meets"
        no_bad_numbers(r)


# ---------------------------------------------------------------- 7. B. control status from the p chart

def dated(points):
    return [{"start": f"2026-08-0{i + 1}", **p} for i, p in enumerate(points)]


def test_p_chart_limits_follow_subgroup_size():
    # p-bar 0.10: sigma_i = sqrt(0.09 / n_i). n = 10: UCL 0.3846; n = 100: 0.19, LCL 0.01; n = 1000: 0.12846, LCL 0.07154.
    pts = qc.p_chart([10, 100, 1000], [1, 10, 100], 1000, 100)["points"]
    assert [p["ucl"] for p in pts] == [approx(0.3846), approx(0.19), approx(0.12846)]
    assert [p["lcl"] for p in pts] == [0.0, approx(0.01), approx(0.07154)]


def test_control_status_known_answer_out_of_control_with_evidence():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 10], 100, 20)               # SPEC known answer: day 5 above its UCL
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day")
    assert c["status"] == "out_of_control"
    assert c["signals"] == [{"start": "2026-08-05", "n": 20, "late": 10, "p": approx(0.5),
                             "ucl": approx(0.4683), "lcl": 0.0}]
    assert "1 day(s) above" in c["reason"]


def test_control_status_in_control_and_improvement_is_not_a_signal():
    r = qc.p_chart([100, 100], [50, 20], 1000, 500)                    # p-bar 0.5, LCL 0.35: 0.20 is below it
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "week")
    assert c["status"] == "in_control" and c["signals"] == []
    assert [i["start"] for i in c["improvements"]] == ["2026-08-02"]


@pytest.mark.parametrize("p_bar,enough,unit,points", [
    (0.2, False, "day", [{"n": 20, "late": 2, "p": 0.1, "ucl": 0.5, "lcl": 0.0, "signal": False}]),   # short baseline
    (0.2, True, None, [{"n": 20, "late": 2, "p": 0.1, "ucl": 0.5, "lcl": 0.0, "signal": False}]),    # low volume
    (0.0, True, "day", [{"n": 20, "late": 2, "p": 0.1, "ucl": 0.0, "lcl": 0.0, "signal": False}]),   # p-bar 0
    (None, True, "day", []),                                                                         # no baseline
    (0.2, True, "day", []),                                                                          # no subgroups
])
def test_control_status_insufficient_baseline(p_bar, enough, unit, points):
    c = qc.control_status(points, p_bar, enough, unit)
    assert c["status"] == "insufficient_baseline" and c["reason"]


def test_dispersion_check_known_answer_and_degenerate():
    # p = 0.1, n = 100 each: every term (10)^2 / (100 x 0.1 x 0.9) = 11.111; chi-square 44.44, df 3, ratio 14.81.
    r = qc.dispersion_check([100] * 4, [0, 20, 0, 20])
    assert r["chi2"] == approx(44.4444) and r["df"] == 3 and r["ratio"] == approx(14.8148)
    assert r["overdispersed"] is True and r["messages"]
    flat = qc.dispersion_check([100] * 4, [10] * 4)
    assert flat["chi2"] == 0.0 and flat["overdispersed"] is False
    assert qc.dispersion_check([100], [10])["ratio"] is None
    assert qc.dispersion_check([100, 100], [0, 0])["ratio"] is None
    no_bad_numbers(r)


# ---------------------------------------------------------------- 8. C. queue label

@pytest.mark.parametrize("spec,control,expected", [
    ("below", "out_of_control", "act_now"),
    ("below", "in_control", "ongoing_gap"),
    ("meets", "out_of_control", "recent_change"),
    ("inconclusive", "out_of_control", "recent_change"),
    ("meets", "in_control", "meets_stable"),
    ("inconclusive", "in_control", "needs_data"),
    ("below", "insufficient_baseline", "needs_data"),
    ("meets", "insufficient_baseline", "needs_data"),
    ("inconclusive", "insufficient_baseline", "needs_data"),
])
def test_queue_label_truth_table(spec, control, expected):
    assert qc.queue_label(spec, control) == expected


def test_queue_label_never_calls_inconclusive_a_success():
    for control in qc.CONTROL_STATUSES:
        assert qc.queue_label("inconclusive", control) != "meets_stable"
    with pytest.raises(ValueError):
        qc.queue_label("on_track", "in_control")


# ---------------------------------------------------------------- 9. I-chart assumption checks

def test_assumption_checks_known_answer_and_degenerate():
    # alternating 1, 2: deviations +-0.5, sum of neighbour products 39 x -0.25 = -9.75, sum of squares 10: lag-1 -0.975
    r = qc.assumption_checks([1, 2] * 20)
    assert r["lag1"] == approx(-0.975) and r["skew"] == approx(0.0) and r["messages"]
    flat = qc.assumption_checks([3.0] * 40)
    assert flat["lag1"] is None and flat["messages"]
    assert qc.assumption_checks([1.0, 2.0])["skew"] is None
