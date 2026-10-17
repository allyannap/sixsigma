"""Every statistic of the EMS Response Monitor, one plain function each (SPEC.md section 4).

Pure functions: lists or arrays in, plain dicts out. No web framework, no file reading.
Rules that hold everywhere:
  * Times in the log statistics are natural logs of MINUTES (ln_min).
  * Never return inf or NaN. Where a number is undefined, return None and add a plain-English
    sentence to the result's "messages" list.
  * Every function returns a dict with a "messages" list (queue_label() returns just the label key).

The two judgments of the approved decisions brief are kept apart:
  A. specification: on_time() - observed on-time rate with a 95% Wilson interval against the goal.
  B. statistical control: p_chart() + control_status() - late share against a fixed baseline.
  queue_label() combines them; neither one is ever read as the other.

Sources: Montgomery, Introduction to Statistical Quality Control (I-MR, p chart, Nelson tests);
Wilson (1927) and Brown, Cai & DasGupta (2001) for the binomial interval; Bissell (1990) for the
Cpk confidence bound; Nelson (1971) and Bonferroni limits for ANOM; the SYSEN 5300 textbook
(https://timothyfraser.com/sigma/).
"""
import math
from statistics import NormalDist

import numpy as np
from scipy import stats as sps

D2 = 1.128            # d2 for subgroups of size 2: sigma = MR-bar / D2
MR_UCL_FACTOR = 3.267  # D4 for n = 2: MR chart upper limit = 3.267 x MR-bar
MIN_CALLS = 30         # fewer valid calls than this is "insufficient data"
Z95 = 1.645            # one-sided 95% normal quantile used in the Cpk bound
Z95_TWO_SIDED = NormalDist().inv_cdf(0.975)   # 1.959964, the Wilson interval's z
VAR_RATIO = 1.64       # variance of MR-bar sigma relative to s (Bissell correction)
DAYS_PER_UNIT = {"day": 1.0, "week": 7.0, "month": 30.4375}
STAGES = ("dispatch_s", "turnout_s", "drive_s")   # received -> assigned -> en route -> on scene


def _floats(values):
    """Turn a list (or array, possibly with None) into a float numpy array."""
    return np.asarray(values if values is not None else [], dtype=float)


def _round(v, digits=10):
    """Round away floating-point dust so a value exactly on a boundary compares as equal."""
    return None if v is None else round(float(v), digits)


def _mr_sigma(x):
    """Within (short-term) sigma from the moving range: MR-bar / 1.128. Returns (mr_bar, sigma)."""
    if len(x) < 2:
        return None, None
    mr_bar = float(np.mean(np.abs(np.diff(x))))
    return mr_bar, mr_bar / D2


# ================================================================ 1. p chart

def subgroup_unit(base_calls_per_day, p_bar):
    """Shortest of "day", "week", "month" whose expected late calls (calls x days x p-bar) is at least 5.

    Returns None when even a month is not enough: the chart is then "low volume, no signals".
    """
    if base_calls_per_day is None or p_bar is None:
        return None
    if base_calls_per_day <= 0 or p_bar <= 0:
        return None
    for unit, days in DAYS_PER_UNIT.items():
        if _round(base_calls_per_day * days * p_bar) >= 5:
            return unit
    return None


def p_chart(n, late, base_n, base_late):
    """p chart of the fraction late. Centre line and limits come from the BASELINE.

    CL = p-bar = base_late / base_n. Limits p-bar +/- 3 sqrt(p-bar (1 - p-bar) / n_i), LCL >= 0, UCL <= 1.
    signal = point above its UCL (the one rule that sets control_status).
    run_signal = 9 points in a row above the CL (shown for information only; it does not set the status).
    """
    messages = []
    n_arr, late_arr = _floats(n), _floats(late)
    if not base_n or base_n <= 0:
        return {"p_bar": None, "points": [], "run_signal": False,
                "messages": ["no baseline calls: the p chart cannot be drawn"]}
    p_bar = base_late / base_n
    p = np.divide(late_arr, n_arr, out=np.zeros_like(late_arr), where=n_arr > 0)
    width = 3 * np.sqrt(p_bar * (1 - p_bar) / np.where(n_arr > 0, n_arr, 1))
    ucl, lcl = np.minimum(1.0, p_bar + width), np.maximum(0.0, p_bar - width)
    if p_bar <= 0 or p_bar >= 1:
        messages.append("every baseline call was " + ("on time" if p_bar <= 0 else "late")
                        + ": the p chart has no spread, so no points are marked")
        signal, run_signal = np.zeros(len(p), dtype=bool), False
    else:
        signal = (p > ucl) & (n_arr > 0)
        above = (p > p_bar).astype(int)
        run_signal = bool(len(above) >= 9 and (_window_sum(above, 9) == 9).any())
    points = [{"n": int(n_arr[i]), "late": int(late_arr[i]), "p": float(p[i]), "ucl": float(ucl[i]),
               "lcl": float(lcl[i]), "signal": bool(signal[i])} for i in range(len(p))]
    return {"p_bar": float(p_bar), "points": points, "run_signal": run_signal, "messages": messages}


# ================================================================ 2. I-MR chart and the 8 Nelson tests

# Only test 1 is an alert (the API marks only it). The other seven are computed and unit-tested, but their
# false-alarm rate on this data was not validated (an earlier review saw them flag 64% of clean counties).
NELSON_RULES = {
    1: ("One call beyond 3 sigma", True),
    2: ("9 calls in a row on one side of the center line", False),
    3: ("6 calls in a row going up or down", False),
    4: ("14 calls in a row alternating up and down", False),
    5: ("2 of 3 calls beyond 2 sigma on the same side", False),
    6: ("4 of 5 calls beyond 1 sigma on the same side", False),
    7: ("15 calls in a row within 1 sigma", False),
    8: ("8 calls in a row beyond 1 sigma on either side", False),
}


def _window_sum(b, w):
    """out[i] = sum of b[i-w+1 .. i] (0 where the window does not fit yet). Vectorized with cumsum."""
    b = np.asarray(b, dtype=int)
    out = np.zeros(len(b), dtype=int)
    if len(b) >= w:
        c = np.concatenate([[0], np.cumsum(b)])
        out[w - 1:] = c[w:] - c[:-w]
    return out


def nelson_tests(z):
    """The 8 Nelson tests on z-scores (distance from the centre line in sigma units).

    Returns {test_id: boolean array}; a test is True at the call that COMPLETES the pattern.
    """
    z = _floats(z)
    n = len(z)
    out = {i: np.zeros(n, dtype=bool) for i in range(1, 9)}
    if n == 0:
        return out
    out[1] = np.abs(z) > 3
    out[2] = (_window_sum(z > 0, 9) == 9) | (_window_sum(z < 0, 9) == 9)
    d = np.diff(z)
    if n >= 2:
        out[3][1:] = (_window_sum(d > 0, 5) == 5) | (_window_sum(d < 0, 5) == 5)
    if n >= 3:
        out[4][2:] = _window_sum(d[:-1] * d[1:] < 0, 12) == 12
    out[5] = (_window_sum(z > 2, 3) >= 2) | (_window_sum(z < -2, 3) >= 2)
    out[6] = (_window_sum(z > 1, 5) >= 4) | (_window_sum(z < -1, 5) >= 4)
    out[7] = _window_sum(np.abs(z) < 1, 15) == 15
    out[8] = _window_sum(np.abs(z) > 1, 8) == 8
    return out


def imr(x, base_x):
    """I-MR chart on ln(minutes). Limits come from the baseline; points are the selection in time order.

    CL = baseline mean, sigma = baseline MR-bar / 1.128, I limits CL +/- 3 sigma, MR UCL = 3.267 MR-bar.
    """
    x, base = _floats(x), _floats(base_x)
    messages = []
    mr = np.concatenate([[np.nan], np.abs(np.diff(x))]) if len(x) else np.array([])
    mr_bar, sigma = _mr_sigma(base)
    empty = {"cl": None, "ucl": None, "lcl": None, "sigma": None, "mr_bar": None, "mr_ucl": None}
    tests_by_id = nelson_tests(np.zeros(len(x)))     # nothing fired until we have a sigma
    if len(base) < 2:
        messages.append("the baseline has fewer than 2 calls: no control limits")
        limits = empty
    elif sigma == 0:
        messages.append("no variation in the baseline: control limits undefined")
        limits = {**empty, "cl": float(base.mean()), "mr_bar": 0.0}
    else:
        cl = float(base.mean())
        limits = {"cl": cl, "ucl": cl + 3 * sigma, "lcl": cl - 3 * sigma, "sigma": sigma, "mr_bar": mr_bar,
                  "mr_ucl": MR_UCL_FACTOR * mr_bar}
        tests_by_id = nelson_tests((x - cl) / sigma)
    points = []
    for i in range(len(x)):
        points.append({"x": float(x[i]), "mr": None if i == 0 else float(mr[i]),
                       "tests": [t for t in range(1, 9) if tests_by_id[t][i]]})
    tests = [{"id": t, "rule": NELSON_RULES[t][0], "alert": NELSON_RULES[t][1],
              "fired": bool(tests_by_id[t].any())} for t in range(1, 9)]
    return {**limits, "points": points, "tests": tests, "messages": messages}


# ================================================================ 3. one-sided Cpk

def is_too_slow(upper, bar):
    """Too slow overall = the Cpk upper 95% bound is strictly below the bar (equal is NOT too slow)."""
    if upper is None or bar is None:
        return False
    return _round(upper) < _round(bar)


def capability(x, usl, goal_pct, sigma=None):
    """SECONDARY. One-sided Cpk on ln(minutes): (USL - mean) / (3 sigma), sigma = MR-bar / 1.128 (within sigma).

    Assumes ln(minutes) is normal; it is shown beside the on-time rate and never sets a status.

    upper = Bissell (1990) bound, corrected for the lower efficiency of MR-bar:
        Cpk + 1.645 sqrt(1/(9n) + 1.64 Cpk^2 / (2(n - 1)))
    bar = z(goal) / 3. too_slow = upper < bar.
    """
    x = _floats(x)
    n = len(x)
    result = {"cpk": None, "upper": None, "bar": None, "n": n, "too_slow": False, "messages": []}
    if not 0 < goal_pct < 100:
        result["messages"].append("the on-time goal must be between 0 and 100 percent")
        return result
    result["bar"] = NormalDist().inv_cdf(goal_pct / 100.0) / 3.0
    if n < 2:
        result["messages"].append("too few calls: Cpk needs at least 2")
        return result
    if sigma is None:
        sigma = _mr_sigma(x)[1]
    if not sigma or sigma <= 0:
        result["messages"].append("no variation: Cpk undefined")
        return result
    cpk = (usl - float(x.mean())) / (3.0 * sigma)
    se = math.sqrt(1.0 / (9 * n) + VAR_RATIO * cpk ** 2 / (2 * (n - 1)))
    result["cpk"], result["upper"] = cpk, cpk + Z95 * se
    result["too_slow"] = is_too_slow(result["upper"], result["bar"])
    return result


# ================================================================ 4. median, P90, P95 with intervals

def _quantile_sorted(sorted_x, q):
    """Linear-interpolation quantile of an already sorted 1-D array (numpy's default method)."""
    k = q * (len(sorted_x) - 1)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return float(sorted_x[lo] + (k - lo) * (sorted_x[hi] - sorted_x[lo]))


def _order_stat_ci(sorted_x, q):
    """Distribution-free 95% interval for the q quantile: ranks n q +/- 1.96 sqrt(n q (1 - q))."""
    n = len(sorted_x)
    half = 1.96 * math.sqrt(n * q * (1 - q))
    lo_rank = max(1, int(math.floor(n * q - half)))
    hi_rank = min(n, int(math.ceil(n * q + half)))
    return [float(sorted_x[lo_rank - 1]), float(sorted_x[hi_rank - 1])]


def p95_boot(values, n_boot=2000, seed=0):
    """Median, P90, P95 and spread (P95 - median) of minutes, with 95% intervals for the median and the P95.

    n <= 5,000: percentile bootstrap (n_boot resamples, fixed seed), one set of resamples for both intervals.
    n > 5,000: order-statistic intervals, ranks n q +/- 1.96 sqrt(n q (1 - q)).
    """
    x = _floats(values)
    x = np.sort(x[np.isfinite(x)])
    n = len(x)
    if n == 0:
        return {"p95": None, "p90": None, "median": None, "spread": None, "ci": [None, None],
                "median_ci": [None, None], "n": 0, "messages": ["no timed calls: percentiles undefined"]}
    p95, p90, median = _quantile_sorted(x, 0.95), _quantile_sorted(x, 0.90), _quantile_sorted(x, 0.5)
    out = {"p95": p95, "p90": p90, "median": median, "spread": p95 - median, "ci": [p95, p95],
           "median_ci": [median, median], "n": n, "messages": []}
    if n == 1 or x[0] == x[-1]:
        out["messages"].append("only one value or no variation: the intervals are single points")
        return out
    if n > 5000:
        out["ci"], out["median_ci"] = _order_stat_ci(x, 0.95), _order_stat_ci(x, 0.5)
        out["messages"].append("intervals from order statistics (more than 5,000 calls)")
        return out
    rng = np.random.default_rng(seed)
    k95, k50 = 0.95 * (n - 1), 0.5 * (n - 1)
    idx = sorted({int(math.floor(k95)), int(math.ceil(k95)), int(math.floor(k50)), int(math.ceil(k50))})
    boot95, boot50 = np.empty(n_boot), np.empty(n_boot)

    def interp(part, k):
        lo, hi = int(math.floor(k)), int(math.ceil(k))
        return part[:, lo] + (k - lo) * (part[:, hi] - part[:, lo])

    step = max(1, 2_000_000 // n)                      # resamples per chunk keeps memory small
    for start in range(0, n_boot, step):
        m = min(step, n_boot - start)
        part = np.partition(x[rng.integers(0, n, size=(m, n))], idx, axis=1)
        boot95[start:start + m], boot50[start:start + m] = interp(part, k95), interp(part, k50)
    out["ci"] = [float(np.percentile(boot95, 2.5)), float(np.percentile(boot95, 97.5))]
    out["median_ci"] = [float(np.percentile(boot50, 2.5)), float(np.percentile(boot50, 97.5))]
    return out


# ================================================================ 5. ANOM

def anom(groups, alpha=0.05):
    """Analysis of means across places on ln(minutes), plus the one-way ANOVA F.

    Decision limits: grand mean +/- h sigma_p sqrt((N - n_i) / (N n_i)), h = t(1 - alpha/(2k), N - k) (Bonferroni).
    sigma_p = pooled within-place sd. verdict: "slower" above the upper limit, "faster" below the lower.
    """
    data = {key: _floats(v) for key, v in groups.items()}
    data = {key: v[np.isfinite(v)] for key, v in data.items()}
    data = {key: v for key, v in data.items() if len(v) > 0}
    k = len(data)
    N = int(sum(len(v) for v in data.values()))
    empty = {"grand_mean": None, "sigma_p": None, "h": None, "k": k, "N": N, "F": None,
             "df1": None, "df2": None, "groups": {}}
    if k < 2:
        return {**empty, "messages": ["ANOM needs at least 2 places with calls"]}
    if N - k <= 0:
        return {**empty, "messages": ["ANOM needs more than one call in some place"]}
    ns = np.array([len(v) for v in data.values()], dtype=float)
    means = np.array([v.mean() for v in data.values()])
    grand = float(sum(v.sum() for v in data.values()) / N)
    ssw = float(sum(((v - v.mean()) ** 2).sum() for v in data.values()))
    ssb = float((ns * (means - grand) ** 2).sum())
    df1, df2 = k - 1, N - k
    sigma_p = math.sqrt(ssw / df2)
    messages = []
    if sigma_p == 0:
        messages.append("no variation within places: ANOM limits and F undefined")
        return {**empty, "grand_mean": grand, "df1": df1, "df2": df2, "messages": messages}
    h = float(sps.t.ppf(1 - alpha / (2 * k), df2))
    t_ci = float(sps.t.ppf(1 - alpha / 2, df2))
    half = h * sigma_p * np.sqrt((N - ns) / (N * ns))
    out_groups = {}
    for i, key in enumerate(data):
        lower, upper = grand - half[i], grand + half[i]
        verdict = "slower" if means[i] > upper else "faster" if means[i] < lower else "inside"
        se = sigma_p / math.sqrt(ns[i])
        out_groups[key] = {"n": int(ns[i]), "mean": float(means[i]),
                           "ci": [float(means[i] - t_ci * se), float(means[i] + t_ci * se)],
                           "lower": float(lower), "upper": float(upper), "verdict": verdict}
    return {"grand_mean": grand, "sigma_p": sigma_p, "h": h, "k": k, "N": N,
            "F": (ssb / df1) / (ssw / df2), "df1": df1, "df2": df2, "groups": out_groups, "messages": messages}


# ================================================================ 6. A. specification: on-time rate against the goal

SPEC_STATUSES = ("meets", "below", "inconclusive")


def wilson_ci(k, n, z=Z95_TWO_SIDED):
    """Wilson score interval for a binomial proportion k / n. Returns [lo, hi], or [None, None] when n = 0.

    centre = (p + z^2 / 2n) / (1 + z^2 / n), half = z sqrt(p (1 - p) / n + z^2 / 4n^2) / (1 + z^2 / n).
    Unlike the plain normal (Wald) interval it stays inside [0, 1] and is not a single point at p = 0 or 1.
    """
    if not n or n <= 0:
        return [None, None]
    if k < 0 or k > n:
        raise ValueError("k must be between 0 and n")
    p = k / n
    z2 = z * z
    denom = 1 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
    return [max(0.0, centre - half), min(1.0, centre + half)]


def spec_from_interval(lo, hi, goal):
    """Meets when lo >= goal, below when hi < goal, otherwise inconclusive (the interval includes the goal)."""
    if lo is None or hi is None or goal is None:
        return "inconclusive"
    if _round(lo) >= _round(goal):
        return "meets"
    if _round(hi) < _round(goal):
        return "below"
    return "inconclusive"


def on_time(n_valid, n_on_time, goal_pct, min_n=MIN_CALLS):
    """A. Specification: are calls meeting the service goal?

    n_valid = completed calls with trustworthy, in-order times; n_on_time = those with total_s <= target_s.
    The 95% Wilson interval of the on-time rate is compared with goal g = goal_pct / 100:
      meets: lower bound >= g;  below: upper bound < g;  inconclusive: the interval includes g,
      or fewer than min_n valid calls (insufficient data), or the goal is invalid.
    The rate and interval are returned even when the status is inconclusive.
    """
    n_valid, n_on_time = int(n_valid or 0), int(n_on_time or 0)
    out = {"n_valid": n_valid, "n_on_time": n_on_time, "n_late": n_valid - n_on_time,
           "on_time_rate": None, "late_rate": None, "ci": [None, None],
           "goal": None, "status": "inconclusive", "reason": "", "messages": []}
    if goal_pct is None or not 0 < goal_pct < 100:
        out["reason"] = "no valid on-time goal"
        out["messages"].append("the on-time goal must be between 0 and 100 percent")
        return out
    out["goal"] = goal_pct / 100.0
    if n_valid == 0:
        out["reason"] = "insufficient data: no valid calls"
        return out
    out["on_time_rate"] = n_on_time / n_valid
    out["late_rate"] = 1 - out["on_time_rate"]
    out["ci"] = wilson_ci(n_on_time, n_valid)
    if n_valid < min_n:
        out["reason"] = f"insufficient data: {n_valid} valid calls (under {min_n})"
        return out
    out["status"] = spec_from_interval(out["ci"][0], out["ci"][1], out["goal"])
    out["reason"] = {"meets": "lower 95% bound is at or above the goal",
                     "below": "upper 95% bound is below the goal",
                     "inconclusive": "the 95% interval includes the goal"}[out["status"]]
    return out


# ================================================================ 7. B. statistical control from the p chart

CONTROL_STATUSES = ("in_control", "out_of_control", "insufficient_baseline")


def control_status(points, p_bar, baseline_enough, unit):
    """B. Statistical control: has the late share changed relative to its own baseline?

    out_of_control: at least one subgroup above its p-chart UCL (Shewhart rule 1, upper side only, because
                    the question is deterioration; points below the LCL are listed as improvements).
    in_control:     the baseline is adequate and no subgroup is above its UCL.
    insufficient_baseline: under 30 baseline calls (after the 120-day stretch), no subgroup size gives
                    5 expected late calls (unit None), p-bar of 0 or 1, or no subgroups in the selection.
    `points` are p_chart() points, optionally with a "start" date each. Being in control does not mean the
    service is good; that is the specification judgment's job.
    """
    out = {"status": "insufficient_baseline", "reason": "", "signals": [], "improvements": [], "messages": []}
    if not baseline_enough:
        out["reason"] = f"fewer than {MIN_CALLS} baseline calls, even after stretching to 120 days"
    elif unit is None:
        out["reason"] = "low volume: no subgroup size gives 5 expected late calls"
    elif p_bar is None or p_bar <= 0 or p_bar >= 1:
        out["reason"] = "baseline late share is 0 or 1: no spread to set limits"
    elif not points:
        out["reason"] = "no subgroups in the selected period"
    else:
        keep = ("start", "n", "late", "p", "ucl", "lcl")
        out["signals"] = [{k: p.get(k) for k in keep} for p in points if p.get("signal")]
        out["improvements"] = [{k: p.get(k) for k in keep} for p in points
                               if p.get("n") and p.get("p") is not None and p["p"] < p["lcl"]]
        out["status"] = "out_of_control" if out["signals"] else "in_control"
        out["reason"] = (f"{len(out['signals'])} {unit}(s) above the upper control limit" if out["signals"]
                         else f"no {unit} above the upper control limit")
    return out


def dispersion_check(n, late, p_bar=None, alpha=0.01):
    """Over-dispersion check for p-chart subgroups (assumption: late counts are binomial).

    Pearson chi-square = sum (late_i - n_i p)^2 / (n_i p (1 - p)) on m subgroups, df = m - 1 when p is
    estimated from the same subgroups (p_bar None), else m. ratio = chi-square / df is about 1 for binomial
    data; overdispersed = the upper-tail p-value is below alpha (then 3-sigma limits are too narrow).
    """
    n_arr, late_arr = _floats(n), _floats(late)
    keep = n_arr > 0
    n_arr, late_arr = n_arr[keep], late_arr[keep]
    out = {"m": int(len(n_arr)), "chi2": None, "df": None, "ratio": None, "p_value": None,
           "overdispersed": False, "messages": []}
    if len(n_arr) < 2:
        out["messages"].append("fewer than 2 subgroups: dispersion not checked")
        return out
    p = float(late_arr.sum() / n_arr.sum()) if p_bar is None else float(p_bar)
    if p <= 0 or p >= 1:
        out["messages"].append("late share is 0 or 1: dispersion not checked")
        return out
    chi2 = float((((late_arr - n_arr * p) ** 2) / (n_arr * p * (1 - p))).sum())
    df = len(n_arr) - 1 if p_bar is None else len(n_arr)
    out.update(chi2=chi2, df=df, ratio=chi2 / df, p_value=float(sps.chi2.sf(chi2, df)))
    out["overdispersed"] = out["p_value"] < alpha
    if out["overdispersed"]:
        out["messages"].append(f"baseline late counts vary more than binomial (chi-square / df = {out['ratio']:.2f}): "
                               "p-chart limits may be too narrow, so treat signals with caution")
    return out


# ================================================================ 8. C. queue label from A and B

QUEUE = ("act_now", "ongoing_gap", "recent_change", "meets_stable", "needs_data")


def queue_label(spec, control):
    """Combine A (meets / below / inconclusive) and B (in_control / out_of_control / insufficient_baseline).

    below + out_of_control            -> act_now        (performance gap + recent signal)
    below + in_control                -> ongoing_gap
    meets or inconclusive + out       -> recent_change  (recent process change: investigate)
    meets + in_control                -> meets_stable   (meets goal; statistically stable)
    anything else, including any insufficient_baseline and inconclusive + in_control -> needs_data
    """
    if spec not in SPEC_STATUSES or control not in CONTROL_STATUSES:
        raise ValueError(f"unknown spec '{spec}' or control '{control}'")
    if control == "insufficient_baseline":
        return "needs_data"
    if spec == "below":
        return "act_now" if control == "out_of_control" else "ongoing_gap"
    if control == "out_of_control":
        return "recent_change"
    return "meets_stable" if spec == "meets" else "needs_data"


# ================================================================ 9. What Held Up the Call: stage excess

def _col(calls, key):
    return np.array([np.nan if c.get(key) is None else c.get(key) for c in calls], dtype=float)


def stage_excess(late_calls, base_calls):
    """Recorded time per response stage for late calls, against the baseline's stage medians.

    Stages: dispatch_s (received -> assigned), turnout_s (assigned -> en route), drive_s (en route -> on scene).
    For each late call, excess_k = stage_k - baseline median_k (seconds); its largest positive excess names the
    stage to review ("none" when no stage is above its median). Averages add up exactly:
        mean total of late calls - sum of baseline stage medians = sum over stages of mean excess,
    because each call's total is the sum of its three stages. This measures where recorded time went;
    it does not prove a cause.
    `held` is counted only where the calls carry it (None when no call has the field).
    """
    late_calls, base_calls = list(late_calls), list(base_calls)
    out = {"n_late": len(late_calls), "base_median": {s: None for s in STAGES},
           "late_mean": {s: None for s in STAGES}, "mean_excess": {s: None for s in STAGES},
           "total": {"late_mean": None, "base_median_sum": None, "excess": None},
           "counts": {**{s: 0 for s in STAGES}, "none": 0}, "per_call": [], "top_stage": None,
           "held": None, "messages": []}
    medians = np.full(len(STAGES), np.nan)
    for i, s in enumerate(STAGES):
        v = _col(base_calls, s)
        v = v[np.isfinite(v)]
        if len(v):
            medians[i] = float(np.median(v))
            out["base_median"][s] = medians[i]
    if not np.isfinite(medians).all():
        out["messages"].append("no baseline calls with all three stage times: excess not computed")
    if not late_calls:
        out["messages"].append("no late calls in the selection")
        return out
    if any("held" in c for c in late_calls):
        out["held"] = int(sum(str(c.get("held")).strip().upper() in ("Y", "TRUE", "1") for c in late_calls))
    stages = np.column_stack([_col(late_calls, s) for s in STAGES])          # shape (calls, 3)
    complete = np.isfinite(stages).all(axis=1)
    if not complete.all():
        out["messages"].append(f"{int((~complete).sum())} late call(s) lack a stage time and are left out")
    stages = stages[complete]
    if len(stages) == 0:
        return out
    means = stages.mean(axis=0)
    out["late_mean"] = {s: float(means[i]) for i, s in enumerate(STAGES)}
    out["total"]["late_mean"] = float(stages.sum(axis=1).mean())
    if not np.isfinite(medians).all():
        return out
    excess = stages - medians
    out["mean_excess"] = {s: float(excess[:, i].mean()) for i, s in enumerate(STAGES)}
    out["total"]["base_median_sum"] = float(medians.sum())
    out["total"]["excess"] = out["total"]["late_mean"] - out["total"]["base_median_sum"]
    best = excess.max(axis=1)
    pick = excess.argmax(axis=1)
    for i in range(len(stages)):
        stage = STAGES[pick[i]] if best[i] > 0 else "none"
        out["per_call"].append(stage)
        out["counts"][stage] += 1
    top = max(STAGES, key=lambda s: out["mean_excess"][s])
    out["top_stage"] = top if out["mean_excess"][top] > 0 else None
    return out


# ================================================================ 10. travel time against the Google estimate

def travel_vs_estimate(diff_s, base_diff_s, min_base=MIN_CALLS):
    """Actual en-route-to-on-scene seconds minus the Google estimate, now against the baseline.

    "Unusual travel-time difference" = a difference above the baseline's 95th percentile of differences
    for the same place and urgency, so about 5% of calls are unusual when nothing changed.
    A positive difference (slower than the estimate) is an investigation clue, not a failure.
    """
    d, b = _floats(diff_s), _floats(base_diff_s)
    d, b = d[np.isfinite(d)], b[np.isfinite(b)]
    out = {"n": int(len(d)), "median_s": None, "pct_slower": None, "pct_faster": None,
           "base_n": int(len(b)), "base_median_s": None, "threshold_s": None,
           "n_unusual": None, "pct_unusual": None, "messages": []}
    if len(d):
        out["median_s"] = float(np.median(d))
        out["pct_slower"] = 100.0 * float((d > 0).mean())
        out["pct_faster"] = 100.0 * float((d < 0).mean())
    else:
        out["messages"].append("no calls with a travel-time estimate in the selection")
    if len(b):
        out["base_median_s"] = float(np.median(b))
    if len(b) < min_base:
        out["messages"].append(f"fewer than {min_base} baseline calls with an estimate: no 'unusual' threshold")
        return out
    out["threshold_s"] = _quantile_sorted(np.sort(b), 0.95)
    if len(d):
        out["n_unusual"] = int((d > out["threshold_s"]).sum())
        out["pct_unusual"] = 100.0 * out["n_unusual"] / len(d)
    return out


# ================================================================ 11. assumption checks for the I chart

def assumption_checks(x):
    """Skewness and lag-1 autocorrelation of a series (I-chart assumptions: symmetric, independent).

    For n >= 30, a |lag-1 autocorrelation| above 2 / sqrt(n) or |skew| above 1 is reported in messages.
    """
    x = _floats(x)
    x = x[np.isfinite(x)]
    n = len(x)
    out = {"n": n, "skew": None, "lag1": None, "messages": []}
    if n < 3 or np.std(x) == 0:
        out["messages"].append("too few values or no variation: assumptions not checked")
        return out
    out["skew"] = float(sps.skew(x, bias=False))
    c = x - x.mean()
    out["lag1"] = float((c[:-1] * c[1:]).sum() / (c * c).sum())
    if n >= MIN_CALLS:
        if abs(out["lag1"]) > 2 / math.sqrt(n):
            out["messages"].append(f"calls are not independent in time (lag-1 autocorrelation {out['lag1']:.2f}): "
                                   "I-chart limits may be misleading")
        if abs(out["skew"]) > 1:
            out["messages"].append(f"log times are still skewed (skew {out['skew']:.2f}): I-chart tail marks are approximate")
    return out
