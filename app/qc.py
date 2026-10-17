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
Cpk confidence bound; Ott (1967) and Nelson (1982) for the analysis of means (ANOM);
Hahn & Meeker (1991), Statistical Intervals, for the distribution-free order-statistic interval
of a percentile; the SYSEN 5300 textbook (https://timothyfraser.com/sigma/).

The "exact" signals use the binomial distribution itself (scipy.stats.binom), not the normal
approximation behind the 3-sigma limits, so a tiny period cannot signal on approximation error.
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
ALPHA_POINT = 0.00135  # one-sided tail probability of a 3-sigma point (normal curve): the exact signal level
MIN_BASELINE_SUBGROUPS = 4   # fewer baseline subgroups than this cannot be screened for stability
MAX_DROP_SHARE = 0.10        # more than this share of baseline subgroups dropped = unstable baseline
BASELINE_RUN = 8             # this many baseline subgroups in a row on one side of p-bar = a shift


def response_profile(minutes, targets_min):
    """Median/P90 (NumPy linear interpolation), late share and n for valid calls.

    Inputs are paired; exclude missing/nonfinite/nonpositive times or targets.
    Exactly at target is on time. A shared reference exists only for equal targets.
    Quantiles describe observed calls, not confidence bounds or worst-case guarantees.
    """
    x, targets = np.asarray(minutes, dtype=float), np.asarray(targets_min, dtype=float)
    if x.shape != targets.shape or x.ndim != 1:
        raise ValueError("times and targets must be paired one-dimensional lists")
    valid = np.isfinite(x) & np.isfinite(targets) & (x > 0) & (targets > 0)
    x, targets = x[valid], targets[valid]
    n = len(x)
    return {"n": n, "median_min": float(np.median(x)) if n else None,
            "p90_min": float(np.quantile(x, .9, method="linear")) if n else None,
            "max_min": float(x.max()) if n else None,
            "over_target_pct": float(100 * np.count_nonzero(x > targets) / n) if n else None,
            "target_min": float(targets[0]) if n and np.all(targets == targets[0]) else None,
            "low_n": n < MIN_CALLS,
            "messages": ["Fewer than 30 valid calls: tail estimates are uncertain."] if n < MIN_CALLS else []}


def _floats(values):
    """Turn a list (or array, possibly with None) into a float numpy array."""
    return np.asarray(values if values is not None else [], dtype=float)


def _round(v, digits=10):
    """Round away floating-point dust so a value exactly on a boundary compares as equal."""
    return None if v is None else round(float(v), digits)


def _mr_sigma(x):
    """Sigma from the moving range of values in the order given: MR-bar / 1.128. Returns (mr_bar, sigma)."""
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
    p_value = exact binomial upper tail P(X >= late_i | n_i, p-bar): how surprising this many late calls is.
    signal = point above its UCL AND p_value < ALPHA_POINT (0.00135, the tail of a 3-sigma point).
      The second condition stops a tiny period (n_i p-bar under 5) from signalling because the normal
      approximation behind the 3-sigma limit is poor there.
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
    p_value = [None] * len(p)
    if p_bar <= 0 or p_bar >= 1:
        messages.append("every baseline call was " + ("on time" if p_bar <= 0 else "late")
                        + ": the p chart has no spread, so no points are marked")
        signal, run_signal = np.zeros(len(p), dtype=bool), False
    else:
        for i in range(len(p)):
            if n_arr[i] > 0:
                p_value[i] = float(sps.binom.sf(late_arr[i] - 1, n_arr[i], p_bar))
        exact = np.array([v is not None and v < ALPHA_POINT for v in p_value], dtype=bool)
        signal = (p > ucl) & (n_arr > 0) & exact
        above = (p > p_bar).astype(int)
        run_signal = bool(len(above) >= 9 and (_window_sum(above, 9) == 9).any())
    points = [{"n": int(n_arr[i]), "late": int(late_arr[i]), "p": float(p[i]), "ucl": float(ucl[i]),
               "lcl": float(lcl[i]), "p_value": p_value[i], "signal": bool(signal[i])} for i in range(len(p))]
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

def capability(x, usl, goal_pct, sigma=None):
    """SECONDARY. One-sided Cpk on x = ln(total_s / target_s), upper spec limit USL = 0: (USL - mean) / (3 sigma).

    sigma = MR-bar / 1.128, the moving range of calls taken in time order across ALL the places and
    days of the selection. That mixes between-place and between-day variation into sigma, so it is
    effectively an overall (Ppk-like) sigma, not a within-subgroup (Cpk) one. Read the number as a
    rough summary, never as a status. Assumes x is normal; it is shown beside the on-time rate.

    upper = Bissell (1990) bound, corrected for the lower efficiency of MR-bar:
        Cpk + 1.645 sqrt(1/(9n) + 1.64 Cpk^2 / (2(n - 1)))
    bar = z(goal) / 3, the Cpk a process needs to reach the on-time goal.
    """
    x = _floats(x)
    n = len(x)
    result = {"cpk": None, "upper": None, "bar": None, "n": n, "messages": []}
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
    return result


# ================================================================ 4. median, P90, P95 with intervals

def _quantile_sorted(sorted_x, q):
    """Linear-interpolation quantile of an already sorted 1-D array (numpy's default method)."""
    k = q * (len(sorted_x) - 1)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return float(sorted_x[lo] + (k - lo) * (sorted_x[hi] - sorted_x[lo]))


CI_LEVEL = 0.95   # coverage of the distribution-free interval for a percentile


def _min_calls_for_ci(q):
    """Smallest n for which ANY pair of ranks (1, n) covers the q quantile with probability >= 95%.

    The widest possible interval is [smallest value, largest value]; it covers the q quantile with
    probability 1 - q^n - (1 - q)^n. Below this n no exact 95% interval exists.
    """
    n = 2
    while 1 - q ** n - (1 - q) ** n < CI_LEVEL - 1e-12:
        n += 1
    return n


def _order_stat_ci(sorted_x, q):
    """Exact distribution-free 95% interval for the q quantile (Hahn & Meeker 1991; Conover).

    Let B = the number of observations at or below the true quantile; B ~ Binomial(n, q).
    The interval [x_(l), x_(u)] (1-based ranks, l < u) covers the quantile exactly when l <= B < u, so
        coverage = P(l <= B < u) = F(u - 1) - F(l - 1),  F = the Binomial(n, q) cdf.
    Step 1: among the pairs with coverage >= 95% take the narrowest (fewest ranks apart); on a tie the
            pair whose two tail probabilities are closest to equal.
    Step 2: if no pair reaches 95% (small n), look at each side alone with a 2.5% tail: the lower rank is
            the largest l with F(l - 1) <= 0.025, the upper the smallest u <= n with 1 - F(u - 1) <= 0.025.
            A rank that does not exist gives None for that bound.
    Returns [lower, upper] with None for a bound that cannot be estimated.
    """
    n = len(sorted_x)
    cdf = sps.binom.cdf(np.arange(n + 1), n, q)            # cdf[j] = P(B <= j)
    tail = (1 - CI_LEVEL) / 2
    eps = 1e-12
    low_p = cdf[:n]                                         # low_p[l - 1] = P(B < l) for l = 1..n
    j = np.searchsorted(cdf, CI_LEVEL + low_p - eps, side="left")   # first j with cdf[j] >= 95% + P(B < l)
    l_all = np.arange(1, n + 1)
    u_all = j + 1                                           # rank u = j + 1
    ok = (u_all <= n) & (u_all > l_all)
    if ok.any():
        l_ok, u_ok = l_all[ok], u_all[ok]
        imbalance = np.abs(low_p[l_ok - 1] - (1 - cdf[u_ok - 1]))
        k = np.lexsort((imbalance, u_ok - l_ok))[0]         # narrowest first, then the most balanced tails
        return [float(sorted_x[l_ok[k] - 1]), float(sorted_x[u_ok[k] - 1])]
    lows = [l for l in range(1, n + 1) if cdf[l - 1] <= tail + eps]
    ups = [u for u in range(1, n + 1) if 1 - cdf[u - 1] <= tail + eps]
    return [float(sorted_x[max(lows) - 1]) if lows else None,
            float(sorted_x[min(ups) - 1]) if ups else None]


def percentiles(values):
    """Median, P90, P95 and spread (P95 - median) of minutes, with exact 95% intervals for the median and the P95.

    Point estimates use linear interpolation (numpy's default). Intervals are the distribution-free
    order-statistic intervals of _order_stat_ci at every n: no bootstrap, no normal approximation.
    A bound that needs more calls than there are is None, with a message (P95 needs 59 calls for any
    interval, the median 6).
    """
    x = _floats(values)
    x = np.sort(x[np.isfinite(x)])
    n = len(x)
    out = {"n": n, "median": None, "median_ci": [None, None], "p90": None, "p95": None,
           "p95_ci": [None, None], "spread": None, "messages": []}
    if n == 0:
        out["messages"].append("no timed calls: percentiles undefined")
        return out
    out["median"], out["p90"], out["p95"] = _quantile_sorted(x, 0.5), _quantile_sorted(x, 0.90), _quantile_sorted(x, 0.95)
    out["spread"] = out["p95"] - out["median"]
    out["median_ci"], out["p95_ci"] = _order_stat_ci(x, 0.5), _order_stat_ci(x, 0.95)
    for label, key, q in (("median", "median_ci", 0.5), ("P95", "p95_ci", 0.95)):
        lo, hi = out[key]
        if lo is None and hi is None:
            out["messages"].append(f"{label} interval not estimable under {_min_calls_for_ci(q)} calls")
        elif lo is None:
            out["messages"].append(f"{label} lower bound not estimable under {_min_calls_for_ci(q)} calls")
        elif hi is None:
            out["messages"].append(f"{label} upper bound not estimable under {_min_calls_for_ci(q)} calls")
    return out


# ================================================================ 5. ANOM

def anom(groups, alpha=0.05):
    """Analysis of means across places on ln(minutes), plus the one-way ANOVA F.

    Decision limits: grand mean +/- h sigma_p sqrt((N - n_i) / (N n_i)), h = t(1 - alpha/(2k), N - k) (Bonferroni).
    sigma_p = pooled within-place sd. verdict: "slower" above the upper limit, "faster" below the lower.
    The reference line (grand_mean) is the call-weighted mean of the places (sum of all values / N), so a
    big place pulls it toward itself. Method: Ott (1967); Nelson (1982) for unequal group sizes.
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
    messages.append("compared with the call-weighted average of these places; differences can reflect "
                    "geography (urban vs rural), not chance")
    return {"grand_mean": grand, "sigma_p": sigma_p, "h": h, "k": k, "N": N,
            "F": (ssb / df1) / (ssw / df2), "df1": df1, "df2": df2, "groups": out_groups,
            "reference": "call-weighted mean of the places", "messages": messages}


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


def control_status(points, p_bar, baseline_enough, unit, baseline=None):
    """B. Statistical control: has the late share changed relative to its own baseline?

    A "signal" is a p_chart() point above its UCL whose exact binomial tail p_value is under ALPHA_POINT.
    out_of_control: at least 2 signals, OR one signal with p_value < ALPHA_POINT / m (Bonferroni, m = number
                    of points: the chance of a false alarm anywhere in the chart stays near 0.00135).
                    Only the upper side counts, because the question is deterioration; points below
                    the LCL are listed as improvements.
    in_control:     the baseline is adequate and the signals are not enough for out_of_control.
                    Exactly one signal that is not strong enough sets watch = True (still in_control).
    insufficient_baseline: under 30 baseline calls (after the 120-day stretch), no subgroup size gives
                    5 expected late calls (unit None), p-bar of 0 or 1, no subgroups in the selection,
                    or `baseline` (the baseline_screen() dict) has stable == False.
    `points` are p_chart() points, optionally with a "start" date each. Being in control does not mean the
    service is good; that is the specification judgment's job.
    """
    m = len(points)
    out = {"status": "insufficient_baseline", "reason": "", "signals": [], "improvements": [], "watch": False,
           "m": m, "messages": []}
    if not baseline_enough:
        out["reason"] = f"fewer than {MIN_CALLS} baseline calls, even after stretching to 120 days"
    elif unit is None:
        out["reason"] = "low volume: no subgroup size gives 5 expected late calls"
    elif p_bar is None or p_bar <= 0 or p_bar >= 1:
        out["reason"] = "baseline late share is 0 or 1: no spread to set limits"
    elif baseline is not None and baseline.get("stable") is False:
        out["reason"] = "baseline is not stable: " + "; ".join(baseline.get("reasons") or ["unspecified"])
    elif not points:
        out["reason"] = "no subgroups in the selected period"
    else:
        keep = ("start", "n", "late", "p", "ucl", "lcl", "p_value")
        out["signals"] = [{k: p.get(k) for k in keep} for p in points if p.get("signal")]
        out["improvements"] = [{k: p.get(k) for k in keep} for p in points
                               if p.get("n") and p.get("p") is not None and p["p"] < p["lcl"]]
        k = len(out["signals"])
        strong = k == 1 and out["signals"][0]["p_value"] is not None and out["signals"][0]["p_value"] < ALPHA_POINT / m
        if k >= 2 or strong:
            out["status"] = "out_of_control"
            out["reason"] = (f"{k} {unit}(s) above the upper control limit" if k >= 2 else
                             f"1 {unit}(s) above the upper control limit, strong enough on its own "
                             f"(exact p = {out['signals'][0]['p_value']:.2g})")
        else:
            out["status"] = "in_control"
            if k == 1:
                out["watch"] = True
                out["reason"] = "1 period above the limit, not confirmed (needs 2, or a stronger single signal)"
            else:
                out["reason"] = f"no {unit} above the upper control limit"
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


def _extreme(n_arr, late_arr, p):
    """Exact binomial tail of each subgroup: the smaller of P(X >= late) and P(X <= late) given p."""
    upper = sps.binom.sf(late_arr - 1, n_arr, p)
    lower = sps.binom.cdf(late_arr, n_arr, p)
    return np.minimum(upper, lower)


def baseline_screen(n, late):
    """Phase I check that the baseline subgroups are stable enough to set limits.

    p0 = total late / total calls. A subgroup is flagged when its exact tail (P(X >= late) or P(X <= late),
    X ~ Binomial(n_i, p0)) is under ALPHA_POINT. Flagged subgroups are dropped ONCE and p-bar is recomputed.
    stable = False when, after dropping, any subgroup still flags; or more than 10% of the subgroups were
    dropped; or 8 or more subgroups in a row lie on one side of p-bar; or dispersion_check() finds the rest
    overdispersed. With fewer than 4 subgroups nothing is checked (stable True, checked False).
    n, late and p_bar in the result describe the subgroups KEPT (empty subgroups, n = 0, are ignored);
    `removed` holds the positions of the dropped subgroups in the input lists.
    """
    n_arr, late_arr = _floats(n), _floats(late)
    keep = n_arr > 0
    pos = np.flatnonzero(keep)                              # positions in the input
    n_arr, late_arr = n_arr[keep], late_arr[keep]
    m = int(len(n_arr))
    disp_empty = {"ratio": None, "p_value": None, "overdispersed": False}
    out = {"p_bar": None, "n": [int(v) for v in n_arr], "late": [int(v) for v in late_arr], "m": m,
           "removed": [], "stable": True, "checked": False, "reasons": [], "dispersion": disp_empty,
           "messages": []}
    if m:
        out["p_bar"] = float(late_arr.sum() / n_arr.sum())
    if m < MIN_BASELINE_SUBGROUPS:
        out["messages"].append("too few baseline periods to check stability")
        return out
    p0 = out["p_bar"]
    if p0 <= 0 or p0 >= 1:
        out["messages"].append("baseline late share is 0 or 1: stability not checked")
        return out
    out["checked"] = True
    flagged = _extreme(n_arr, late_arr, p0) < ALPHA_POINT
    out["removed"] = [int(v) for v in pos[flagged]]
    n_arr, late_arr = n_arr[~flagged], late_arr[~flagged]
    out["n"], out["late"] = [int(v) for v in n_arr], [int(v) for v in late_arr]
    if len(out["removed"]) > 0:
        out["messages"].append(f"{len(out['removed'])} baseline period(s) were unusually high or low and were dropped once")
    if len(n_arr) == 0:
        out["p_bar"], out["stable"] = None, False
        out["reasons"].append("every baseline period was unusual")
        return out
    p_bar = float(late_arr.sum() / n_arr.sum())
    out["p_bar"] = p_bar
    if 0 < p_bar < 1 and (_extreme(n_arr, late_arr, p_bar) < ALPHA_POINT).any():
        out["reasons"].append("after dropping unusual periods, others are still unusual")
    if len(out["removed"]) / m > MAX_DROP_SHARE:
        out["reasons"].append(f"{len(out['removed'])} of {m} baseline periods were unusual (more than 10%)")
    share = late_arr / n_arr
    for side in (share > p_bar, share < p_bar):
        run = longest = 0
        for flag in side:
            run = run + 1 if flag else 0
            longest = max(longest, run)
        if longest >= BASELINE_RUN:
            out["reasons"].append(f"{longest} baseline periods in a row on one side of the average (a shift)")
            break
    disp = dispersion_check(n_arr, late_arr)
    out["dispersion"] = {"ratio": disp["ratio"], "p_value": disp["p_value"], "overdispersed": disp["overdispersed"]}
    if disp["overdispersed"]:
        out["reasons"].append(f"baseline counts vary more than chance (chi-square / df = {disp['ratio']:.2f})")
    out["stable"] = not out["reasons"]
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


# ================================================================ 9. assumption checks for the I chart

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


# ================================================================ 10. places that read "below" by chance

def chance_below(ns, goal_pct):
    """How many places would be called "Below goal" purely by chance if every place truly met the goal.

    For a place with n calls and true on-time rate exactly g = goal_pct / 100, the observed count of on-time
    calls is X ~ Binomial(n, g). The place reads "below" when the Wilson upper bound of X / n is under g.
    P(below) = the sum of the binomial pmf over the k with wilson_ci(k, n)[1] < g. The expected number is
    the sum of P(below) over the places with at least MIN_CALLS calls (smaller ones are never "below").
    The upper bound rises with k, so the "below" values are k = 0 .. k_max; the sum is the binomial cdf at k_max.
    Returns {expected, n_places, messages}; expected is None when it cannot be computed.
    """
    out = {"expected": None, "n_places": 0, "messages": []}
    if goal_pct is None or not 0 < goal_pct < 100:
        out["messages"].append("the on-time goal must be between 0 and 100 percent")
        return out
    g = goal_pct / 100.0
    sizes = [int(v) for v in (ns or []) if v is not None and v >= MIN_CALLS]
    out["n_places"] = len(sizes)
    if not sizes:
        out["messages"].append(f"no place has at least {MIN_CALLS} calls")
        return out
    cache = {}
    for size in sizes:
        if size not in cache:
            k_max = -1
            for k in range(size + 1):          # the first k whose upper bound reaches g ends the "below" values
                if _round(wilson_ci(k, size)[1]) < _round(g):
                    k_max = k
                else:
                    break
            cache[size] = float(sps.binom.cdf(k_max, size, g)) if k_max >= 0 else 0.0
    out["expected"] = float(sum(cache[size] for size in sizes))
    return out


# ================================================================ 11. excess late calls (for ranking)

def excess_late(n_valid, n_late, goal_pct):
    """Late calls beyond what the goal allows: n_late - (1 - g) n_valid, with g = goal_pct / 100.

    Example: 200 valid calls, goal 90% allows 20 late calls; 30 late is 10 more than allowed.
    Negative = fewer late calls than the goal allows. None when n_valid is 0 or the goal is invalid.
    Used to rank places so a big place with a modest gap outranks a tiny place with a large rate.
    """
    if not n_valid or n_valid <= 0 or goal_pct is None or not 0 < goal_pct < 100:
        return None
    return _round(n_late - (100.0 - goal_pct) / 100.0 * n_valid)


# ================================================================ 12. plain stage medians

def _median_or_none(values):
    x = _floats(values)
    x = x[np.isfinite(x)]
    return float(np.median(x)) if len(x) else None


def _stage_block(data):
    held = [h for h in (data.get("held") or []) if h is not None]
    return {"dispatch_s": _median_or_none(data.get("dispatch_s")),
            "turnout_s": _median_or_none(data.get("turnout_s")),
            "drive_s": _median_or_none(data.get("drive_s")),
            "held_pct": 100.0 * sum(bool(h) for h in held) / len(held) if held else None,
            "n": len(data.get("dispatch_s") or [])}


def stage_summary(now, base):
    """Descriptive only: the median of each stage (seconds) and the percent held, now vs the baseline.

    now and base are {"dispatch_s": [...], "turnout_s": [...], "drive_s": [...], "held": [bool or None, ...]}.
    Missing values (None, NaN) are ignored; a stage with no values is None. No excess, no cause, no ranking.
    """
    out = {"now": _stage_block(now or {}), "base": _stage_block(base or {}), "messages": []}
    if out["now"]["n"] == 0:
        out["messages"].append("no calls in the selected period")
    if out["base"]["n"] == 0:
        out["messages"].append("no calls in the baseline period")
    return out
