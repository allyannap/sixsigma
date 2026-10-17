"""Generate the three SYNTHETIC EMS incident files and a small messy sample (fixed seed, no Census key needed).

Run from the repo root:   python data/generate.py            (all four files, about 3 minutes; check the printed time)
                          python data/generate.py --messy    (only the messy sample, from the baseline file)
Reads:  data/params.json, data/lookup/zcta_county.csv, data/lookup/counties.csv, config/targets.csv
Writes: data/incidents_baseline.csv.xz, data/incidents_station_closure.csv.xz,
        data/incidents_summer_surge.csv.xz, data/incidents_messy_sample.csv.xz

Random streams (all fixed by the seed in params.json):
  (seed, zcta)           a ZIP's ordinary calls. A ZIP that no story touches gets exactly the same calls
                         in all three files.
  (seed, zcta, 2)        the extra calls of the summer surge, drawn separately, so the ordinary calls of
                         Monroe County are identical to the baseline outside the surge.
  (seed, county_fips, 1) the county's day-to-day effects (weather, load), shared by all its ZIPs.
  (seed, 7777)           the problems injected into the messy sample.

What makes the calls less tidy than independent draws (all parameters are in params.json): a day effect
shared by a county, winter and summer effects on lateness, an hour-of-day arrival profile, and congestion
(more held calls on busy county-days).

Testing options (optional): --lookup DIR  --out DIR  (default: data/lookup and data/)
"""
import argparse
import json
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
COLUMNS = ["incident_id", "zcta", "urgency_code", "t_received", "t_assigned", "t_enroute",
           "t_onscene", "cancelled", "valid_time", "held"]


def load_params():
    with open(HERE / "params.json") as f:
        return json.load(f)


def day_table(params):
    """One row per local calendar day: date, start (UTC epoch s), length (s)."""
    tz = ZoneInfo(params["timezone"])
    d0 = date.fromisoformat(params["date_start"])
    d1 = date.fromisoformat(params["date_end"])
    days = []
    d = d0
    while d <= d1:
        days.append(d)
        d += timedelta(days=1)
    starts, lengths = [], []
    for d in days:
        a = datetime(d.year, d.month, d.day, tzinfo=tz).timestamp()
        n = d + timedelta(days=1)
        b = datetime(n.year, n.month, n.day, tzinfo=tz).timestamp()
        starts.append(a)
        lengths.append(b - a)  # 23, 24 or 25 hours on DST days
    return days, np.array(starts), np.array(lengths)


def whole_seconds(x):
    """Round to whole seconds, minimum 1."""
    return np.maximum(1, np.rint(x)).astype(np.int64)


# ---------------------------------------------------------------------------------------------
# Counts per day (ordinary, and the surge extras on their own stream)
# ---------------------------------------------------------------------------------------------
def zcta_lambda(pop, daily_factor, params):
    """Expected calls per local day for one ZIP (no random variation, no surge)."""
    return pop * params["base_rate_per_person_per_year"] / 365.0 * daily_factor


def zcta_streams(zcta, lam, county, params, days_arr, surge):
    """(rng, ordinary counts per day, rng_extra, extra counts per day).

    The ordinary counts are the FIRST draw of the ZIP's own stream, so they are the same in every file.
    The surge extras are an additional Poisson(lam x (m - 1)) on surge days, from a separate stream.
    """
    rng = np.random.default_rng([params["seed"], int(zcta)])
    base = rng.poisson(lam)
    rng_x, extra = None, np.zeros(len(lam), dtype=np.int64)
    if surge and county == params["summer_surge"]["county_fips"]:
        rng_x = np.random.default_rng([params["seed"], int(zcta), 2])
        m = params["summer_surge"]["volume_multiplier"]
        extra = rng_x.poisson(np.where(days_arr["surge_mask"], lam * (m - 1.0), 0.0))
    return rng, base, rng_x, extra


def county_effects(counties, params, n_days):
    """Per-county, per-day lognormal(0, sigma) multipliers: (on the drive estimate, on dispatch time)."""
    out = {}
    for fips in counties:
        z = np.random.default_rng([params["seed"], int(fips), 1]).standard_normal((2, n_days))
        out[fips] = (np.exp(params["day_effect"]["sigma_eta"] * z[0]),
                     np.exp(params["day_effect"]["sigma_dispatch"] * z[1]))
    return out


def congestion_factor(total, expected, params):
    """Multiplier on the held probability for each county-day: ((calls + k) / (expected + k))^2, clipped."""
    c = params["congestion"]
    ratio = (total + c["shrink_calls"]) / (expected + c["shrink_calls"])
    return np.clip(ratio ** c["exponent"], c["min_factor"], c["max_factor"])


# ---------------------------------------------------------------------------------------------
# The calls
# ---------------------------------------------------------------------------------------------
def draw_calls(rng, day_idx, ctx):
    """Every attribute of the calls placed on the days in `day_idx` (one entry per call). Draw order is fixed."""
    p, d = ctx["p"], ctx["days"]
    n = len(day_idx)
    u_hour = rng.random(n)
    code = rng.choice(10, size=n, p=np.array(p["urgency_code_probs_0_to_9"]))
    z_disp = rng.standard_normal(n)
    u_held = rng.random(n)
    z_held_extra = rng.standard_normal(n)
    z_turn = rng.standard_normal(n)
    z_eta = rng.standard_normal(n)
    z_ratio = rng.standard_normal(n)
    u_disp = rng.random(n)
    u_valid = rng.random(n)
    u_slow = rng.random(n)
    z_slow = rng.standard_normal(n)

    # Time of day: invert the hour profile's cumulative curve, then place it as a FRACTION of the local
    # day, so 23- and 25-hour daylight-saving days work.
    cdf = ctx["hour_cdf"]
    hour = np.minimum(np.searchsorted(cdf, u_hour, side="right"), 23)
    lo = np.where(hour > 0, cdf[np.maximum(hour - 1, 0)], 0.0)
    frac = (hour + (u_hour - lo) / (cdf[hour] - lo)) / 24.0
    t_recv = np.floor(d["start"][day_idx] + frac * d["length"][day_idx]).astype(np.int64)

    grp = ctx["groups"][code]  # 0 red, 1 yellow, 2 green
    names = ["red", "yellow", "green"]
    disp_med = np.array([p["dispatch_median_s"][g] for g in names])[grp]
    ratio_med = np.array([p["drive_ratio_median"][g] for g in names])[grp]
    dispatch = (disp_med * d["dispatch_month_factor"][day_idx] * ctx["hour_dispatch_factor"][hour]
                * ctx["disp_mult"][day_idx] * np.exp(p["dispatch_sigma"] * z_disp))
    held_p = p["held_probability"] * ctx["cong"][day_idx]
    if ctx["in_surge"]:
        s = p["summer_surge"]
        m = d["surge_mask"][day_idx]
        held_p = np.where(m, held_p + (s["held_probability"] - p["held_probability"]), held_p)  # planted, on top
        dispatch = np.where(m, dispatch * s["dispatch_multiplier"], dispatch)
    held = u_held < np.minimum(held_p, 1.0)
    dispatch = dispatch + held * (p["held_extra_dispatch_median_s"]
                                  * np.exp(p["held_extra_dispatch_sigma"] * z_held_extra))
    turnout = p["turnout_median_s"] * np.exp(p["turnout_sigma"] * z_turn)
    eta = (p["eta_median_s"][ctx["kind"]] * d["eta_month_factor"][day_idx]
           * ctx["eta_mult"][day_idx] * np.exp(p["eta_sigma"] * z_eta))
    if ctx["closure"]:
        eta = np.where(t_recv >= d["closure_start"], eta * p["station_closure"]["eta_multiplier"], eta)
    eta_s = whole_seconds(eta)
    # Ambulances are usually a little faster than the estimate, but not always: the lognormal ratio lets
    # them be slower too, and a small share of slow outliers (detours, wrong address, road closures) is added.
    slow = np.where(u_slow < p["drive_slow_outlier_probability"],
                    p["drive_slow_outlier_median"] * np.exp(p["drive_slow_outlier_sigma"] * z_slow), 1.0)
    drive = whole_seconds(eta_s * ratio_med * np.exp(p["drive_ratio_sigma"] * z_ratio) * slow)
    dispatch_s = whole_seconds(dispatch)
    turnout_s = whole_seconds(turnout)

    dp = p["disposition_probs"]
    disp = np.where(u_disp < dp["CANCELLED"], "CANCELLED",
           np.where(u_disp < dp["CANCELLED"] + dp["REFUSED"], "REFUSED",
           np.where(u_disp < dp["CANCELLED"] + dp["REFUSED"] + dp["TREATED"], "TREATED",
                    "TRANSPORTED")))
    t_assigned = t_recv + dispatch_s
    t_enroute = t_assigned + turnout_s
    t_onscene = t_enroute + drive
    return dict(zcta=np.full(n, ctx["zcta"]), code=code, t_recv=t_recv, t_assigned=t_assigned,
                t_enroute=t_enroute, t_onscene=t_onscene, disp=disp,
                valid=np.where(u_valid < p["valid_time_N_probability"], "N", "Y"),
                eta=eta_s, held=np.where(held, "Y", "N"))


def make_zcta(zcta, kind, county, lam, ctx_common, effects, cong, surge, closure):
    """All calls of one ZIP area, as a dict of numpy arrays: ordinary calls first, then surge extras."""
    p = ctx_common["p"]
    ctx = dict(ctx_common, zcta=zcta, kind=kind, eta_mult=effects[0], disp_mult=effects[1], cong=cong,
               in_surge=surge and county == p["summer_surge"]["county_fips"],
               closure=closure and zcta == p["station_closure"]["zcta_resolved"])
    rng, base, rng_x, extra = zcta_streams(zcta, lam, county, p, ctx_common["days"], surge)
    n_days = np.arange(len(lam))
    parts = []
    if base.sum():
        parts.append(draw_calls(rng, np.repeat(n_days, base), ctx))
    if extra.sum():
        parts.append(draw_calls(rng_x, np.repeat(n_days, extra), ctx))
    if not parts:
        return None
    return {k: np.concatenate([x[k] for x in parts]) for k in parts[0]}


def iso(epoch, tz, empty=None):
    """UTC epoch seconds -> '2026-10-11T22:14:05-04:00' strings (empty where `empty` is True)."""
    ts = pd.to_datetime(epoch, unit="s", utc=True).tz_convert(tz)
    s = pd.Series(ts.strftime("%Y-%m-%dT%H:%M:%S%z"))
    s = s.str.replace(r"(\d\d)$", r":\1", regex=True)
    if empty is not None:
        s[empty] = ""
    return s.to_numpy()


def build_file(name, params, lookup, groups, ctx_common, effects, expected_by_county, lam_by_zcta, outdir):
    surge = name == "summer_surge"
    closure = name == "station_closure"
    days_arr = ctx_common["days"]
    n_days = len(days_arr["start"])
    # Pass 1: how many calls does each county get each day (ordinary + surge extras)? Congestion needs it.
    total = {c: np.zeros(n_days) for c in expected_by_county}
    for r in lookup.itertuples():
        _, base, _, extra = zcta_streams(r.zcta, lam_by_zcta[r.zcta], r.county_fips, params, days_arr, surge)
        total[r.county_fips] += base + extra
    cong = {c: congestion_factor(total[c], expected_by_county[c], params) for c in total}
    # Pass 2: the calls themselves.
    parts = []
    for r in lookup.itertuples():
        o = make_zcta(r.zcta, r.urban_rural, r.county_fips, lam_by_zcta[r.zcta], ctx_common,
                      effects[r.county_fips], cong[r.county_fips], surge, closure)
        if o is not None:
            parts.append(o)
    cat = {k: np.concatenate([o[k] for o in parts]) for k in parts[0]}
    order = np.lexsort((cat["zcta"], cat["t_recv"]))  # sort by time; ties by ZIP, deterministic
    cat = {k: v[order] for k, v in cat.items()}
    n = len(order)
    tz = params["timezone"]
    cancelled = cat["disp"] == "CANCELLED"
    df = pd.DataFrame({
        "incident_id": [f"NY26-{i:07d}" for i in range(1, n + 1)],
        "zcta": cat["zcta"],
        "urgency_code": cat["code"],
        "t_received": iso(cat["t_recv"], tz),
        "t_assigned": iso(cat["t_assigned"], tz),
        "t_enroute": iso(cat["t_enroute"], tz),
        "t_onscene": iso(cat["t_onscene"], tz, empty=cancelled),
        "cancelled": np.where(cancelled, "Y", "N"),   # the model's disposition and travel estimate stay internal
        "valid_time": cat["valid"],
        "held": cat["held"],
    })[COLUMNS]
    path = outdir / f"incidents_{name}.csv.xz"
    df.to_csv(path, index=False, compression={"method": "xz", "preset": 9})
    print(f"wrote {path.name}: {n:,} calls, {path.stat().st_size / 1e6:.1f} MB")
    return df


# ---------------------------------------------------------------------------------------------
# The messy sample
# ---------------------------------------------------------------------------------------------
def to_epoch(series):
    """ISO strings with offsets -> UTC epoch seconds (int64)."""
    ts = pd.to_datetime(series, utc=True, format="ISO8601")
    return ((ts - pd.Timestamp("1970-01-01", tz="UTC")).dt.total_seconds()).astype("int64").to_numpy()


def build_messy(baseline, lookup, params, outdir):
    """Baseline rows of ONE county and ONE month, with problems injected into disjoint rows.

    The counts in params["messy_sample"] are the injection log; validate.py --messy must detect exactly them.
    """
    m, tz = params["messy_sample"], params["timezone"]
    cty = lookup.set_index("zcta")["county_fips"]
    keep = (baseline["zcta"].map(cty) == m["county_fips"]) & (baseline["t_received"].str[:7] == m["month"])
    df = baseline[keep].reset_index(drop=True).copy()
    df["pos"] = np.arange(len(df), dtype=float)
    rng = np.random.default_rng([params["seed"], 7777])
    pool = rng.permutation(np.flatnonzero((df["cancelled"] != "Y").to_numpy()))
    at = 0

    def take(k):
        nonlocal at
        idx = pool[at:at + k]
        at += k
        return idx

    i_recv, i_asg = take(m["n_missing_t_received"]), take(m["n_missing_t_assigned"])
    i_ord = take(m["n_out_of_order"])
    i_zip, i_urg = take(m["n_unknown_zcta"]), take(m["n_unknown_urgency_code"])
    i_bad = take(m["n_valid_time_N_with_bad_times"])
    i_dup, i_conf = take(m["n_exact_duplicate_rows"]), take(m["n_duplicate_id_different_content"])
    copies = pd.concat([df.loc[i_dup].assign(pos=lambda x: x["pos"] + 0.5),
                        df.loc[i_conf].assign(pos=lambda x: x["pos"] + 0.5)])  # copied BEFORE any change

    df.loc[i_recv, "t_received"] = ""
    df.loc[i_asg, "t_assigned"] = ""
    # out of order: half swap assigned/enroute, half put the arrival before the call was received
    swap, early = i_ord[0::2], i_ord[1::2]
    a, e = df.loc[swap, "t_assigned"].copy(), df.loc[swap, "t_enroute"].copy()
    df.loc[swap, "t_assigned"], df.loc[swap, "t_enroute"] = e, a
    df.loc[early, "t_onscene"] = iso(to_epoch(df.loc[early, "t_received"]) - 60, tz)
    df.loc[i_zip, "zcta"] = m["unknown_zcta_value"]
    unknown_codes = m["unknown_urgency_code_values"]
    df.loc[i_urg, "urgency_code"] = [unknown_codes[j % len(unknown_codes)] for j in range(len(i_urg))]
    # valid_time N with genuinely bad times: arrival 8 to 30 hours after the crew left
    hours = rng.integers(8, 31, size=len(i_bad))
    df.loc[i_bad, "t_onscene"] = iso(to_epoch(df.loc[i_bad, "t_enroute"]) + hours * 3600, tz)
    df.loc[i_bad, "valid_time"] = "N"
    # the duplicate-id copies: the second kind carries a different arrival time (45 s later)
    exact_copies = copies.iloc[:len(i_dup)].copy()
    conf_copies = copies.iloc[len(i_dup):].copy()
    conf_copies["t_onscene"] = iso(to_epoch(conf_copies["t_onscene"]) + 45, tz)
    out = pd.concat([df, exact_copies, conf_copies]).sort_values("pos", kind="stable")
    out = out.drop(columns="pos")[COLUMNS]
    path = outdir / "incidents_messy_sample.csv.xz"
    out.to_csv(path, index=False, compression={"method": "xz", "preset": 9})
    print(f"wrote {path.name}: {len(out):,} rows ({len(df):,} calls, {m['county_name']} {m['month']}), "
          f"{path.stat().st_size / 1e3:.0f} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lookup", default=str(HERE / "lookup"))
    ap.add_argument("--out", default=str(HERE))
    ap.add_argument("--messy", action="store_true",
                    help="write ONLY the messy sample, from the baseline file already in --out (seconds)")
    args = ap.parse_args()
    lookup_dir, outdir = Path(args.lookup), Path(args.out)

    params = load_params()
    lookup = pd.read_csv(lookup_dir / "zcta_county.csv", dtype={"zcta": str, "county_fips": str})
    if lookup.empty:
        sys.exit("zcta_county.csv is empty. Run: python data/build_lookups.py")
    if args.messy:
        base = pd.read_csv(outdir / "incidents_baseline.csv.xz", dtype={"zcta": str}, keep_default_na=False)
        build_messy(base, lookup, params, outdir)
        return
    targets = pd.read_csv(ROOT / "config" / "targets.csv")
    gmap = {"red": 0, "yellow": 1, "green": 2}
    groups = np.zeros(10, dtype=int)
    # targets.csv has one row per (code, area type); the group is the same in every area type
    for r in targets.drop_duplicates("urgency_code").itertuples():
        groups[int(r.urgency_code)] = gmap[r.urgency_group]

    # Resolve the closure ZIP: most populous urban ZCTA (ties broken by smaller ZIP code).
    urban = lookup[lookup.urban_rural == "urban"].sort_values(["population", "zcta"], ascending=[False, True])
    params["station_closure"]["zcta_resolved"] = urban.iloc[0].zcta
    print("station_closure ZIP:", params["station_closure"]["zcta_resolved"])
    if outdir == HERE:  # only a real run records the ZIP in params.json (not a test run)
        text = (HERE / "params.json").read_text()
        text = re.sub(r'("zcta_resolved":\s*)(null|"[^"]*")',
                      lambda m: f'{m.group(1)}"{params["station_closure"]["zcta_resolved"]}"', text)
        (HERE / "params.json").write_text(text)

    # Daily factor = month factor (normalized to mean 1) x day-of-week factor.
    days, starts, lengths = day_table(params)
    mf = np.array(params["month_factors_jan_to_dec"], dtype=float)
    if params["month_factors_normalized_to_mean_1"]:
        mf = mf / mf.mean()
    dow = np.array(params["dow_factors_mon_to_sun"], dtype=float)
    daily_factor = np.array([mf[d.month - 1] * dow[d.weekday()] for d in days])
    s = params["summer_surge"]
    sd0, sd1 = date.fromisoformat(s["from_date"]), date.fromisoformat(s["to_date"])
    cdate = date.fromisoformat(params["station_closure"]["from_date"])
    tz = ZoneInfo(params["timezone"])
    ls = params["lateness_seasonality"]
    eta_mf = np.array(ls["eta_month_factors_jan_to_dec"], dtype=float)
    disp_mf = np.array(ls["dispatch_month_factors_jan_to_dec"], dtype=float)
    days_arr = {
        "start": starts, "length": lengths,
        "surge_mask": np.array([sd0 <= d <= sd1 for d in days]),
        "closure_start": datetime(cdate.year, cdate.month, cdate.day, tzinfo=tz).timestamp(),
        "eta_month_factor": np.array([eta_mf[d.month - 1] for d in days]),
        "dispatch_month_factor": np.array([disp_mf[d.month - 1] for d in days]),
    }
    hod = params["hour_of_day"]
    w = np.array(hod["arrival_weights_0_to_23"], dtype=float)
    w = w / w.mean()
    ctx_common = {"p": params, "days": days_arr, "groups": groups,
                  "hour_cdf": np.cumsum(w) / w.sum(),
                  "hour_dispatch_factor": w ** hod["dispatch_hour_exponent"]}

    lam_by_zcta = {r.zcta: zcta_lambda(r.population, daily_factor, params) for r in lookup.itertuples()}
    counties = sorted(lookup["county_fips"].unique())
    effects = county_effects(counties, params, len(days))
    expected = {c: np.zeros(len(days)) for c in counties}
    for r in lookup.itertuples():
        expected[r.county_fips] += lam_by_zcta[r.zcta]

    baseline = None
    for name in ["baseline", "station_closure", "summer_surge"]:
        df = build_file(name, params, lookup, groups, ctx_common, effects, expected, lam_by_zcta, outdir)
        if name == "baseline":
            baseline = df
    build_messy(baseline, lookup, params, outdir)


if __name__ == "__main__":
    main()
