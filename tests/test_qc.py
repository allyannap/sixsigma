"""Tests for app/qc.py. Every known answer comes from SPEC.md section 4; tolerance 5e-4 unless noted.

Run from the repo root:  .venv/bin/python -m pytest tests/test_qc.py -v
"""
import math
from statistics import NormalDist

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

# Hand work, n = 20 per day, baseline 20 late of 100 so p-bar = 0.20:
#   UCL = 0.2 + 3 sqrt(0.2 x 0.8 / 20) = 0.2 + 3 x 0.08944 = 0.4683; LCL = 0.2 - 0.2683 < 0, floored at 0.
#   Day 5 with 12 late: p = 0.60 > UCL. Exact tail P(X >= 12 | 20, 0.2) = sum over k = 12..20 of C(20,k) 0.2^k 0.8^(20-k)
#   = 125970 x 4.096e-9 x 0.16777 (8.66e-5) + 77520 x 8.192e-10 x 0.20972 (1.33e-5) + 1.67e-6 + 1.7e-7 + ... = 1.017e-4,
#   under 0.00135: a signal.
def test_p_chart_known_answer():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 12], 100, 20)
    assert r["p_bar"] == approx(0.20)
    assert [p["signal"] for p in r["points"]] == [False, False, False, False, True]
    assert r["points"][4]["p"] == approx(0.6)
    assert r["points"][4]["p_value"] == pytest.approx(1.0173e-4, abs=1e-7)
    assert r["points"][0]["ucl"] == approx(0.4683)
    assert r["points"][0]["lcl"] == 0.0           # 0.2 - 3 x 0.08944 is negative: floored at 0
    assert r["run_signal"] is False
    no_bad_numbers(r)


def test_p_chart_above_ucl_but_exact_tail_too_large_is_not_a_signal():
    # Day 5 with 10 late: p = 0.50 > UCL 0.4683, but P(X >= 10 | 20, 0.2) = 0.00259 > 0.00135: not a signal.
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 10], 100, 20)
    last = r["points"][4]
    assert last["p"] > last["ucl"]
    assert last["p_value"] == pytest.approx(0.0025948, abs=1e-6)
    assert last["signal"] is False


def test_p_chart_tiny_period_cannot_signal_on_normal_approximation_error():
    # p-bar 0.10, n = 5 (n p-bar = 0.5): UCL = 0.1 + 3 sqrt(0.09 / 5) = 0.5024; 3 late of 5 is p = 0.6 > UCL.
    # Exact: P(X >= 3) = C(5,3) 0.1^3 0.9^2 + C(5,4) 0.1^4 0.9 + 0.1^5 = 0.0081 + 0.00045 + 0.00001 = 0.00856 > 0.00135.
    r = qc.p_chart([5], [3], 100, 10)
    pt = r["points"][0]
    assert pt["p"] > pt["ucl"] and pt["signal"] is False
    assert pt["p_value"] == pytest.approx(0.00856, abs=1e-8)


def test_p_chart_empty_period_has_no_p_value_and_no_signal():
    r = qc.p_chart([0, 20], [0, 2], 100, 20)
    assert r["points"][0]["p_value"] is None and r["points"][0]["signal"] is False


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
    assert "too_slow" not in r                               # the removed status is gone
    no_bad_numbers(r)


def test_capability_uses_supplied_sigma():
    usl = math.log(8)
    r = qc.capability(IMR_X, usl, 90, sigma=0.19947)
    assert r["cpk"] == approx(1.6368)


def test_capability_constant_data_is_undefined():
    r = qc.capability([1.0] * 10, math.log(8), 90)
    assert r["cpk"] is None and r["upper"] is None
    assert "no variation: Cpk undefined" in r["messages"]
    no_bad_numbers(r)


@pytest.mark.parametrize("x", [[], [1.0]])
def test_capability_too_few_calls(x):
    r = qc.capability(x, math.log(8), 90)
    assert r["cpk"] is None and "too few calls" in " ".join(r["messages"])


def test_capability_bad_goal():
    r = qc.capability(IMR_X, math.log(8), 100)
    assert r["cpk"] is None and r["messages"]


# ---------------------------------------------------------------- 4. percentiles with exact intervals

# Hand work, values 1..20 (linear interpolation, k = q (n - 1) = 19 q):
#   median: k = 9.5 -> 10.5;  P90: k = 17.1 -> 1 + 17.1 = 18.1;  P95: k = 18.05 -> 1 + 18.05 = 19.05.
# Median interval, B ~ Binomial(20, 0.5): P(B <= 5) = (1 + 20 + 190 + 1140 + 4845 + 15504) / 2^20 = 21700 / 1048576 = 0.020695,
#   and by symmetry P(B <= 14) = 0.979305. Ranks l = 6, u = 15 cover P(6 <= B <= 14) = 0.958610 >= 0.95
#   (the next narrower pairs (6, 14) and (7, 15) give 0.9216). So the interval is [x_6, x_15] = [6, 15].
# P95 interval: B ~ Binomial(20, 0.95). The widest interval [x_1, x_20] covers 1 - 0.95^20 - 0.05^20 = 0.642 < 0.95,
#   so no upper rank exists: the upper bound is None. Lower bound alone (2.5% tail): with F = number of failures
#   ~ Binomial(20, 0.05), P(B <= 16) = P(F >= 4) = 1 - (0.3585 + 0.3774 + 0.1887 + 0.0596) = 0.0159 <= 0.025 but
#   P(B <= 17) = P(F >= 3) = 0.0755 > 0.025, so the largest lower rank is l = 17 and the bound is x_17 = 17.
def test_percentiles_known_answer():
    r = qc.percentiles(list(range(1, 21)))
    assert r["n"] == 20
    assert r["p95"] == approx(19.05)
    assert r["p90"] == approx(18.1)
    assert r["median"] == approx(10.5)
    assert r["spread"] == approx(8.55)
    assert r["median_ci"] == [6.0, 15.0]
    assert r["p95_ci"] == [17.0, None]
    assert "P95 upper bound not estimable under 59 calls" in r["messages"]
    assert not any("median" in m for m in r["messages"])
    no_bad_numbers(r)


def _binom_cdf(k, n, q):
    """P(B <= k) for B ~ Binomial(n, q), summed term by term (independent of scipy)."""
    return sum(math.comb(n, i) * q ** i * (1 - q) ** (n - i) for i in range(0, k + 1))


def test_percentile_interval_coverage_matches_the_binomial_formula():
    # n = 60, P95: the returned ranks (values 1..60 so value = rank) must cover with probability >= 0.95.
    r = qc.percentiles(list(range(1, 61)))
    lo, hi = r["p95_ci"]
    assert lo is not None and hi is not None
    coverage = _binom_cdf(int(hi) - 1, 60, 0.95) - _binom_cdf(int(lo) - 1, 60, 0.95)   # P(l <= B < u)
    assert coverage >= 0.95
    assert not r["messages"]


def test_percentile_interval_exists_from_59_calls_for_p95_and_6_for_the_median():
    # Widest interval [x_1, x_n] covers 1 - q^n - (1 - q)^n: P95 at n = 58 is 1 - 0.0510 = 0.949 (no), at 59 0.9515 (yes).
    assert qc.percentiles(list(range(1, 59)))["p95_ci"][1] is None
    assert None not in qc.percentiles(list(range(1, 60)))["p95_ci"]
    # Median: n = 5 gives 1 - 2 x 0.5^5 = 0.9375 (no); n = 6 gives 1 - 2 x 0.5^6 = 0.96875 (yes), interval [x_1, x_6].
    assert qc.percentiles(list(range(1, 6)))["median_ci"] == [None, None]
    assert qc.percentiles(list(range(1, 7)))["median_ci"] == [1.0, 6.0]


def test_percentile_ci_simulated_coverage_of_the_true_p95():
    rng = np.random.default_rng(12345)                       # fixed seed
    true_p95 = math.exp(2.0 + 0.4 * NormalDist().inv_cdf(0.95))
    true_median = math.exp(2.0)
    hit95 = hit50 = 0
    reps = 400
    for _ in range(reps):
        r = qc.percentiles(rng.lognormal(2.0, 0.4, 60))
        lo, hi = r["p95_ci"]
        hit95 += lo is not None and hi is not None and lo <= true_p95 <= hi
        hit50 += r["median_ci"][0] <= true_median <= r["median_ci"][1]
    assert hit95 / reps >= 0.92
    assert hit50 / reps >= 0.92


def test_percentiles_constant_and_single_value():
    r = qc.percentiles([7.0] * 50)
    assert r["median_ci"] == [7.0, 7.0] and r["p95_ci"][0] == 7.0 and r["spread"] == 0.0
    one = qc.percentiles([4.0])
    assert one["p95"] == 4.0 and one["median"] == 4.0
    assert one["median_ci"] == [None, None] and one["p95_ci"] == [None, None]
    assert "median interval not estimable under 6 calls" in one["messages"]
    assert "P95 interval not estimable under 59 calls" in one["messages"]


def test_percentiles_empty():
    r = qc.percentiles([])
    assert r["p95"] is None and r["p95_ci"] == [None, None] and r["median_ci"] == [None, None] and r["messages"]
    assert r["n"] == 0


def test_percentiles_ignore_missing_values():
    r = qc.percentiles([1, 2, 3, None, float("nan")])
    assert r["n"] == 3 and r["p95"] == approx(2.9)           # 1 + 0.95 x 2 = 2.9 on the three real values


def test_percentiles_large_n_interval_is_tight_and_covers():
    x = np.random.default_rng(2).lognormal(2, 0.4, 20000)
    r = qc.percentiles(x)
    true = float(np.percentile(x, 95))
    assert r["p95_ci"][0] <= true <= r["p95_ci"][1]
    assert r["p95_ci"][1] - r["p95_ci"][0] < 0.5
    assert r["median_ci"][0] <= float(np.median(x)) <= r["median_ci"][1]
    assert r["messages"] == []


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
    assert r["reference"] == "call-weighted mean of the places"
    assert any("call-weighted average of these places" in m and "geography" in m for m in r["messages"])
    # grand mean is call-weighted: (1 + 2 + 10 + 11 + 12 + 13) / 6 = 49 / 6 = 8.1667, not the mean of the place means (1.5 + 11.5) / 2 = 6.5
    assert qc.anom({"A": [1.0, 2.0], "B": [10.0, 11.0, 12.0, 13.0]})["grand_mean"] == approx(49 / 6)
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


# Day 5 with 12 late of 20 (p-bar 0.20): exact tail 1.017e-4. m = 5 points, Bonferroni level 0.00135 / 5 = 0.00027.
# 1.017e-4 < 0.00027: one such signal is strong enough alone -> out of control.
def test_control_status_known_answer_out_of_control_with_evidence():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 12], 100, 20)
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day")
    assert c["status"] == "out_of_control" and c["watch"] is False and c["m"] == 5
    assert len(c["signals"]) == 1
    sig = c["signals"][0]
    assert (sig["start"], sig["n"], sig["late"]) == ("2026-08-05", 20, 12)
    assert sig["p"] == approx(0.6) and sig["ucl"] == approx(0.4683) and sig["lcl"] == 0.0
    assert sig["p_value"] == pytest.approx(1.0173e-4, abs=1e-7)
    assert "1 day(s) above" in c["reason"]


# Day 5 with 11 late: exact tail 5.63e-4 < 0.00135 (a signal) but not < 0.00027: only one, not strong -> watch, in control.
def test_control_status_single_weak_signal_is_a_watch_not_out_of_control():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 11], 100, 20)
    assert r["points"][4]["signal"] is True
    assert r["points"][4]["p_value"] == pytest.approx(5.634e-4, abs=1e-7)
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day")
    assert c["status"] == "in_control" and c["watch"] is True and len(c["signals"]) == 1
    assert c["reason"] == "1 period above the limit, not confirmed (needs 2, or a stronger single signal)"


def test_control_status_two_signals_are_out_of_control_even_if_each_is_weak():
    r = qc.p_chart([20] * 5, [11, 3, 1, 11, 2], 100, 20)       # two days at 5.63e-4 each
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day")
    assert c["status"] == "out_of_control" and len(c["signals"]) == 2 and c["watch"] is False
    assert "2 day(s) above" in c["reason"]


def test_control_status_above_ucl_without_exact_signal_is_plain_in_control():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 10], 100, 20)         # 10 late: above UCL, exact tail 0.0026
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day")
    assert c["status"] == "in_control" and c["watch"] is False and c["signals"] == []
    assert c["reason"] == "no day above the upper control limit"


def test_control_status_unstable_baseline_is_insufficient():
    r = qc.p_chart([20] * 5, [2, 3, 1, 4, 12], 100, 20)
    shaky = {"stable": False, "reasons": ["2 of 10 baseline periods were unusual (more than 10%)"]}
    c = qc.control_status(dated(r["points"]), r["p_bar"], True, "day", baseline=shaky)
    assert c["status"] == "insufficient_baseline" and "more than 10%" in c["reason"] and c["signals"] == []
    fine = qc.control_status(dated(r["points"]), r["p_bar"], True, "day", baseline={"stable": True, "reasons": []})
    assert fine["status"] == "out_of_control"


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
    assert c["watch"] is False and c["m"] == len(points)


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


def test_response_profile_known_answer():
    r = qc.response_profile(list(range(1, 21)), [12] * 20)
    assert r['n'] == 20
    assert r['median_min'] == 10.5
    assert r['p90_min'] == pytest.approx(18.1)
    assert r['max_min'] == 20
    assert r['over_target_pct'] == 40  # 12 itself is on time
    assert r['target_min'] == 12
    assert r['low_n']


@pytest.mark.parametrize('times,targets,n,median,late', [
    ([], [], 0, None, None),
    ([8], [8], 1, 8, 0),
    ([9, 9, 9], [8, 8, 8], 3, 9, 100),
    ([None, float('nan'), float('inf'), -1, 0, 5], [8]*6, 1, 5, 0),
    ([5, 8, 12], [None, 8, float('nan')], 1, 8, 0),
])
def test_response_profile_degenerate(times, targets, n, median, late):
    r = qc.response_profile(times, targets)
    assert r['n'] == n
    assert r['median_min'] == median
    assert r['over_target_pct'] == late
    assert r['p90_min'] == median


def test_response_profile_mixed_targets_and_sample_boundary():
    r = qc.response_profile([8]*30, [7]*15 + [9]*15)
    assert r['target_min'] is None
    assert r['over_target_pct'] == 50
    assert not r['low_n']
    with pytest.raises(ValueError):
        qc.response_profile([1], [])
# ---------------------------------------------------------------- 10. Phase I baseline screen

# Hand work, 10 baseline days of n = 100. Late: 20 on nine days and 40 on the tenth.
#   p0 = 220 / 1000 = 0.22. Tenth day: P(X >= 40 | 100, 0.22) = 3.8e-5 < 0.00135: flagged and dropped.
#   New p-bar = 180 / 900 = 0.20. The rest are all exactly 20 (no flag, chi-square 0, no run on one side).
#   1 of 10 dropped is 10%, not more than 10%: stable.
def test_baseline_screen_drops_one_unusual_period_and_stays_stable():
    r = qc.baseline_screen([100] * 10, [20] * 9 + [40])
    assert r["removed"] == [9] and r["m"] == 10
    assert r["p_bar"] == approx(0.20)
    assert r["n"] == [100] * 9 and r["late"] == [20] * 9
    assert r["stable"] is True and r["checked"] is True and r["reasons"] == []
    assert r["dispersion"]["overdispersed"] is False and r["dispersion"]["ratio"] == approx(0.0)
    no_bad_numbers(r)


def test_baseline_screen_more_than_ten_percent_dropped_is_unstable():
    # Two of ten days at 45 late: p0 = 0.226; P(X >= 45 | 100, 0.2) = 1e-8 < 0.00135. 2 / 10 = 20% > 10%.
    r = qc.baseline_screen([100] * 10, [20] * 8 + [45, 45])
    assert r["removed"] == [8, 9] and r["stable"] is False
    assert any("more than 10%" in x for x in r["reasons"])


def test_baseline_screen_run_of_eight_on_one_side_is_unstable():
    # p-bar = (8 x 23 + 2 x 17) / 1000 = 0.218; eight days at 0.23 are all above it, no day is extreme.
    r = qc.baseline_screen([100] * 10, [23] * 8 + [17] * 2)
    assert r["removed"] == [] and r["p_bar"] == approx(0.218)
    assert r["stable"] is False and any("8 baseline periods in a row" in x for x in r["reasons"])
    seven = qc.baseline_screen([100] * 10, [23] * 7 + [17] * 3)          # seven in a row is allowed
    assert seven["stable"] is True


def test_baseline_screen_overdispersion_is_unstable():
    # Late alternates 12 and 30 of 100: p-bar 0.21, no single day extreme (tails near 0.02-0.04).
    # Pearson chi-square = 10 x 9^2 / (100 x 0.21 x 0.79) = 48.8 on df 9: ratio 5.42, p-value 1.8e-7.
    r = qc.baseline_screen([100] * 10, [12, 30] * 5)
    assert r["removed"] == [] and r["dispersion"]["overdispersed"] is True
    assert r["dispersion"]["ratio"] == pytest.approx(5.4250, abs=1e-3)
    assert r["stable"] is False and any("vary more than chance" in x for x in r["reasons"])


def test_baseline_screen_flags_a_low_period_too():
    # Nine days at 20 and one at 0 of 100: P(X <= 0 | 100, 0.18) is tiny, so the low day is dropped too.
    r = qc.baseline_screen([100] * 10, [20] * 9 + [0])
    assert r["removed"] == [9]


def test_baseline_screen_too_few_periods_is_not_checked():
    r = qc.baseline_screen([100, 100, 100], [10, 40, 90])
    assert r["stable"] is True and r["checked"] is False and r["removed"] == []
    assert "too few baseline periods to check stability" in r["messages"]
    assert r["p_bar"] == approx(140 / 300)


def test_baseline_screen_degenerate_inputs():
    empty = qc.baseline_screen([], [])
    assert empty["p_bar"] is None and empty["checked"] is False and empty["messages"]
    zero = qc.baseline_screen([100] * 5, [0] * 5)
    assert zero["p_bar"] == 0.0 and zero["checked"] is False and zero["stable"] is True and zero["messages"]
    no_calls = qc.baseline_screen([0, 0, 0, 0], [0, 0, 0, 0])
    assert no_calls["p_bar"] is None and no_calls["checked"] is False
    for r in (empty, zero, no_calls):
        no_bad_numbers(r)


# ---------------------------------------------------------------- 11. places that read "below" by chance

# n = 30, goal 90%. Wilson upper bound of k / 30 on time:
#   k = 23: p = 0.76667, centre (0.76667 + 0.06402) / 1.12805 = 0.73638, half 1.95996 sqrt(0.005963 + 0.001067) / 1.12805 = 0.14568,
#           upper 0.8821 < 0.90: below.
#   k = 24: p = 0.8, centre 0.76597, half 1.95996 x 0.08 / 1.12805 = 0.13900, upper 0.9050 >= 0.90: not below.
# The "below" values are k = 0..23, so the chance = P(X <= 23 | 30, 0.9) = 1 - P(X >= 24) = 0.025827.
def test_chance_below_known_answer():
    r = qc.chance_below([30], 90)
    by_hand = sum(math.comb(30, k) * 0.9 ** k * 0.1 ** (30 - k) for k in range(0, 24))
    assert r["expected"] == pytest.approx(by_hand, abs=1e-9)
    assert r["expected"] == pytest.approx(0.025827, abs=1e-6)
    assert qc.wilson_ci(23, 30)[1] < 0.9 <= qc.wilson_ci(24, 30)[1]
    assert r["n_places"] == 1


def test_chance_below_adds_places_and_skips_small_ones():
    one = qc.chance_below([30], 90)["expected"]
    r = qc.chance_below([30, 30, 29, 5], 90)                 # 29 and 5 calls can never read "below"
    assert r["n_places"] == 2 and r["expected"] == pytest.approx(2 * one, abs=1e-12)


def test_chance_below_degenerate():
    for ns, goal in (([], 90), ([10, 20], 90), (None, 90)):
        r = qc.chance_below(ns, goal)
        assert r["expected"] is None and r["n_places"] == 0 and r["messages"]
    bad = qc.chance_below([30], 100)
    assert bad["expected"] is None and bad["messages"]
    no_bad_numbers(bad)


# ---------------------------------------------------------------- 12. excess late calls

def test_excess_late_known_answer_and_degenerate():
    assert qc.excess_late(200, 30, 90) == approx(10.0)       # goal allows 0.10 x 200 = 20 late; 30 - 20 = 10
    assert qc.excess_late(200, 10, 90) == approx(-10.0)      # 10 - 20
    assert qc.excess_late(0, 0, 90) is None
    assert qc.excess_late(None, 0, 90) is None
    assert qc.excess_late(200, 30, 100) is None and qc.excess_late(200, 30, None) is None


# ---------------------------------------------------------------- 13. plain stage medians

def test_stage_summary_known_answer():
    now = {"dispatch_s": [10, 20, 30, None], "turnout_s": [60, 90], "drive_s": [300], "held": [True, False, False, None]}
    base = {"dispatch_s": [5, 15], "turnout_s": [40], "drive_s": [200, 400, float("nan")], "held": [False, False]}
    r = qc.stage_summary(now, base)
    # dispatch median of 10, 20, 30 = 20; turnout (60 + 90) / 2 = 75; held 1 of 3 known = 33.33%; n = 4 rows
    assert r["now"] == {"dispatch_s": 20.0, "turnout_s": 75.0, "drive_s": 300.0, "held_pct": approx(100 / 3), "n": 4}
    assert r["base"] == {"dispatch_s": 10.0, "turnout_s": 40.0, "drive_s": 300.0, "held_pct": 0.0, "n": 2}
    assert r["messages"] == []
    no_bad_numbers(r)


def test_stage_summary_degenerate():
    r = qc.stage_summary({"dispatch_s": [], "turnout_s": [], "drive_s": [], "held": []}, {})
    empty = {"dispatch_s": None, "turnout_s": None, "drive_s": None, "held_pct": None, "n": 0}
    assert r["now"] == empty and r["base"] == empty and len(r["messages"]) == 2
    no_held = qc.stage_summary({"dispatch_s": [10], "turnout_s": [5], "drive_s": [7], "held": [None]}, {})
    assert no_held["now"]["held_pct"] is None and no_held["now"]["dispatch_s"] == 10.0
