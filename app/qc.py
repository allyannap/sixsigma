"""Every statistic of the EMS Response Monitor, one plain function each (SPEC.md section 4).

Pure functions: lists or arrays in, plain dicts out. No web framework, no file reading.
Rules that hold everywhere:
  * Times in the log statistics are natural logs of MINUTES (ln_min); USL = ln(target_s / 60).
  * Never return inf or NaN. Where a number is undefined, return None and add a plain-English
    sentence to the result's "messages" list.
  * Every function returns a dict with a "messages" list (status() returns just the status word).

Sources: Montgomery, Introduction to Statistical Quality Control (I-MR, p chart, Nelson tests);
Bissell (1990) for the Cpk confidence bound; Nelson (1982/1984) for the 8 tests; Nelson (1971)
and Bonferroni limits for ANOM; the SYSEN 5300 textbook (https://timothyfraser.com/sigma/).
"""
import math
from statistics import NormalDist

import numpy as np
from scipy import stats as sps

D2 = 1.128            # d2 for subgroups of size 2: sigma = MR-bar / D2
MR_UCL_FACTOR = 3.267  # D4 for n = 2: MR chart upper limit = 3.267 x MR-bar
MIN_CALLS = 30         # fewer timed calls than this is "not enough calls"
Z95 = 1.645            # one-sided 95% normal quantile used in the Cpk bound
VAR_RATIO = 1.64       # variance of MR-bar sigma relative to s (Bissell correction)
DAYS_PER_UNIT = {"day": 1.0, "week": 7.0, "month": 30.4375}
FIXES = ("closer", "add_ambulance", "center_faster", "crew_faster")


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
    signal = point above its UCL. run_signal = 9 points in a row above the CL.
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

NELSON_RULES = {
    1: ("One call beyond 3 sigma", True),
    2: ("9 calls in a row on one side of the center line", True),
    3: ("6 calls in a row going up or down", False),
    4: ("14 calls in a row alternating up and down", False),
    5: ("2 of 3 calls beyond 2 sigma on the same side", True),
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
    """One-sided Cpk on ln(minutes): (USL - mean) / (3 sigma), sigma = MR-bar / 1.128 (within sigma).

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


# ================================================================ 4. P95 with an interval

def _percentile95(sorted_x):
    """Linear-interpolation 95th percentile of an already sorted 1-D array."""
    k = 0.95 * (len(sorted_x) - 1)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    return float(sorted_x[lo] + (k - lo) * (sorted_x[hi] - sorted_x[lo]))


def p95_boot(values, n_boot=2000, seed=0):
    """P95, median and spread (P95 - median) of minutes, with a 95% interval for the P95.

    n <= 5,000: percentile bootstrap (n_boot resamples, fixed seed).
    n > 5,000: order-statistic interval, ranks n p +/- 1.96 sqrt(n p (1 - p)), p = 0.95.
    """
    x = _floats(values)
    x = np.sort(x[np.isfinite(x)])
    n = len(x)
    if n == 0:
        return {"p95": None, "median": None, "spread": None, "ci": [None, None],
                "messages": ["no timed calls: P95 undefined"]}
    p95, median = _percentile95(x), float(np.median(x))
    out = {"p95": p95, "median": median, "spread": p95 - median, "ci": [p95, p95], "messages": []}
    if n == 1 or x[0] == x[-1]:
        out["messages"].append("only one value or no variation: the interval is a single point")
        return out
    if n > 5000:
        half = 1.96 * math.sqrt(n * 0.95 * 0.05)
        lo_rank = max(1, int(math.floor(n * 0.95 - half)))
        hi_rank = min(n, int(math.ceil(n * 0.95 + half)))
        out["ci"] = [float(x[lo_rank - 1]), float(x[hi_rank - 1])]
        out["messages"].append("interval from order statistics (more than 5,000 calls)")
        return out
    rng = np.random.default_rng(seed)
    k = 0.95 * (n - 1)
    lo, hi = int(math.floor(k)), int(math.ceil(k))
    boot = np.empty(n_boot)
    step = max(1, 2_000_000 // n)                      # resamples per chunk keeps memory small
    for start in range(0, n_boot, step):
        m = min(step, n_boot - start)
        sample = x[rng.integers(0, n, size=(m, n))]
        part = np.partition(sample, [lo, hi], axis=1)
        boot[start:start + m] = part[:, lo] + (k - lo) * (part[:, hi] - part[:, lo])
    out["ci"] = [float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))]
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


# ================================================================ 6. changed recently, and the status

def changed_recently(sel_x, base_x, sel_late, sel_n, base_late, base_n):
    """Has the selection shifted UP against its baseline? (needs 30 or more calls in each)

    Z_loc = (mean_sel - mean_base) / (sigma_base sqrt(1/n_sel + 1/n_base)) on ln(minutes), sigma_base = baseline MR-bar / 1.128.
    Z_p = (p_sel - p_base) / sqrt(p_pool (1 - p_pool) (1/n_sel + 1/n_base)) on the fraction late,
          only when n_sel p_pool >= 5 and n_sel (1 - p_pool) >= 5.
    changed = Z_loc > 3 or Z_p > 3 (a Z exactly 3 is not changed).
    """
    sx, bx = _floats(sel_x), _floats(base_x)
    out = {"changed": False, "z_loc": None, "z_p": None, "reasons": [], "messages": []}
    if min(len(sx), sel_n, len(bx), base_n) < MIN_CALLS:
        out["messages"].append("fewer than 30 timed calls in the selection or its baseline: cannot test for a recent change")
        return out
    # Location: shift of the mean of ln(minutes)
    sigma_base = _mr_sigma(bx)[1]
    if not sigma_base:
        out["messages"].append("no variation in the baseline: Z_loc undefined")
    else:
        se = sigma_base * math.sqrt(1.0 / len(sx) + 1.0 / len(bx))
        out["z_loc"] = float((sx.mean() - bx.mean()) / se)
    # Proportion late
    p_sel, p_base = sel_late / sel_n, base_late / base_n
    p_pool = (sel_late + base_late) / (sel_n + base_n)
    if sel_n * p_pool >= 5 and sel_n * (1 - p_pool) >= 5:
        se_p = math.sqrt(p_pool * (1 - p_pool) * (1.0 / sel_n + 1.0 / base_n))
        out["z_p"] = float((p_sel - p_base) / se_p)
    if out["z_loc"] is not None and _round(out["z_loc"], 8) > 3:
        out["reasons"].append(f"Typical wait is higher than its baseline (Z = {out['z_loc']:.2f}, limit 3)")
    if out["z_p"] is not None and _round(out["z_p"], 8) > 3:
        out["reasons"].append(f"Share of late calls is higher than its baseline (Z = {out['z_p']:.2f}, limit 3)")
    out["changed"] = bool(out["reasons"])
    return out


def status(too_slow, changed, n_sel, n_base):
    """One word per place: act_now, recent_change, ongoing_gap, on_track or not_enough (under 30 in either)."""
    if n_sel < MIN_CALLS or n_base < MIN_CALLS:
        return "not_enough"
    if too_slow and changed:
        return "act_now"
    if changed:
        return "recent_change"
    if too_slow:
        return "ongoing_gap"
    return "on_track"


# ================================================================ 7. fault tree

CAUSES = ("held", "dispatch", "turnout", "long_trip", "slow_drive", "typical_late")
TREE_EVENTS = ("dispatch", "turnout", "long_trip", "slow_drive")   # the four basic events, in z column order


def _held(calls):
    return np.array([str(c.get("held")).strip().upper() in ("Y", "TRUE", "1") for c in calls], dtype=bool)


def _col(calls, key):
    return np.array([np.nan if c.get(key) is None else c.get(key) for c in calls], dtype=float)


def _logs(calls):
    """ln of the four quantities the tree compares: dispatch_s, turnout_s, eta_google_s, drive_s / eta_google_s."""
    with np.errstate(divide="ignore", invalid="ignore"):
        disp, turn = _col(calls, "dispatch_s"), _col(calls, "turnout_s")
        eta, drive = _col(calls, "eta_google_s"), _col(calls, "drive_s")
        cols = [disp, turn, eta, drive / eta]
        return np.array([np.where(np.isfinite(c) & (c > 0), np.log(np.where(c > 0, c, 1.0)), np.nan) for c in cols])


def fault_tree(late_calls, base_calls):
    """Series (OR) fault tree for each late call.

    held = Y -> "held" (no ambulance free). Otherwise the basic event with the largest standardized excess
    z = (ln(step) - ln(baseline median)) / (baseline sd of ln(step)) among dispatch (911 center), turnout (crew),
    long_trip (Google estimate) and slow_drive (drive / Google estimate). All z <= 0 -> "typical_late".
    The baseline is the baseline's NOT-held calls (held calls would inflate the 911 center's spread).
    """
    messages = []
    base_calls = list(base_calls)
    pool = [c for c, h in zip(base_calls, _held(base_calls)) if not h] or base_calls
    names = ("dispatch_s", "turnout_s", "eta_google_s", "drive_ratio")
    base_info, median_ln, sd_ln = {}, np.full(4, np.nan), np.full(4, np.nan)
    if pool:
        logs = _logs(pool)
        for i, name in enumerate(names):
            v = logs[i][np.isfinite(logs[i])]
            if len(v) >= 2:
                median_ln[i], sd_ln[i] = float(np.median(v)), float(np.std(v, ddof=1))
            base_info[name] = {"median": float(math.exp(median_ln[i])) if np.isfinite(median_ln[i]) else None,
                               "sd_ln": float(sd_ln[i]) if np.isfinite(sd_ln[i]) else None}
    else:
        base_info = {name: {"median": None, "sd_ln": None} for name in names}
        messages.append("no baseline calls: every late call is called typical")
    usable = np.isfinite(sd_ln) & (sd_ln > 0)
    if pool and not usable.all():
        skipped = [names[i] for i in range(4) if not usable[i]]
        messages.append("baseline has no spread (or no data) for: " + ", ".join(skipped) + "; those causes are skipped")

    late_calls = list(late_calls)
    counts = {c: 0 for c in CAUSES}
    if not late_calls:
        return {"counts": counts, "per_call": [], "z": [], "base": base_info, "messages": messages}
    with np.errstate(invalid="ignore", divide="ignore"):
        z = (_logs(late_calls).T - median_ln) / sd_ln                   # shape (calls, 4)
    z[:, ~usable] = np.nan
    held = _held(late_calls)
    best = np.where(np.isnan(z).all(axis=1), -np.inf, np.nanmax(np.where(np.isnan(z), -np.inf, z), axis=1))
    pick = np.argmax(np.where(np.isnan(z), -np.inf, z), axis=1)
    per_call = []
    for i in range(len(late_calls)):
        if held[i]:
            cause = "held"
        elif best[i] > 0:
            cause = TREE_EVENTS[pick[i]]
        else:
            cause = "typical_late"
        per_call.append(cause)
        counts[cause] += 1
    z_list = [[None if np.isnan(v) else float(v) for v in row] for row in z]
    return {"counts": counts, "per_call": per_call, "z": z_list, "base": base_info, "messages": messages}


# ================================================================ 8. what-if replay

def whatif(calls, fix, pct, base_dispatch_nonheld_median):
    """Replay the selected calls with ONE change; everything else is held fixed (no queueing effects).

    closer: drive shortened by pct. center_faster: dispatch_s shortened by pct. crew_faster: turnout_s shortened by pct.
    add_ambulance: each held call's dispatch_s is set to the baseline median dispatch_s of non-held calls
    (a call is never made slower). A call is late when its total_s is above target_s.
    """
    if fix not in FIXES:
        raise ValueError(f"unknown fix '{fix}'; use one of {list(FIXES)}")
    if not 0 <= pct <= 100:
        raise ValueError("pct must be between 0 and 100")
    messages = []
    if not calls:
        blank = {"late": 0, "pct_late": 0.0, "p95_min": None}
        return {"now": dict(blank), "with_fix": dict(blank), "avoided": 0,
                "messages": ["no timed calls in the selection: nothing to replay"]}
    total = _col(calls, "total_s")
    if np.isnan(total).any():
        total = np.where(np.isnan(total), _col(calls, "dispatch_s") + _col(calls, "turnout_s") + _col(calls, "drive_s"), total)
    target = _col(calls, "target_s")
    saved = np.zeros(len(calls))
    if fix == "closer":
        saved = np.nan_to_num(_col(calls, "drive_s")) * pct / 100.0
    elif fix == "center_faster":
        saved = np.nan_to_num(_col(calls, "dispatch_s")) * pct / 100.0
    elif fix == "crew_faster":
        saved = np.nan_to_num(_col(calls, "turnout_s")) * pct / 100.0
    elif base_dispatch_nonheld_median is None:
        messages.append("no baseline median dispatch time: 'add an ambulance' cannot be replayed")
    else:
        saved = np.where(_held(calls), np.maximum(np.nan_to_num(_col(calls, "dispatch_s")) - base_dispatch_nonheld_median, 0.0), 0.0)
    new_total = total - saved

    def summarize(t):
        late = int((t > target).sum())
        return {"late": late, "pct_late": round(100.0 * late / len(t), 1),
                "p95_min": round(float(np.percentile(t, 95)) / 60.0, 2)}

    now, with_fix = summarize(total), summarize(new_total)
    return {"now": now, "with_fix": with_fix, "avoided": now["late"] - with_fix["late"], "messages": messages}
