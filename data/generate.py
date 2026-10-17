"""Generate the three SYNTHETIC EMS incident files (fixed seed, no Census key needed).

Run from the repo root:   python data/generate.py
Reads:  data/params.json, data/lookup/zcta_county.csv, data/lookup/counties.csv, config/targets.csv
Writes: data/incidents_baseline.csv.gz, data/incidents_station_closure.csv.gz,
        data/incidents_summer_surge.csv.gz

Every ZIP area (ZCTA) has its own random generator seeded from (seed, zcta). So a ZIP that no
story touches gets exactly the same calls in all three files.

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
           "t_onscene", "disposition", "valid_time", "eta_google_s", "held"]


def load_params():
    with open(HERE / "params.json") as f:
        return json.load(f)


def day_table(params):
    """One row per local calendar day: start (UTC epoch s), length (s), month, weekday."""
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


def lognormal(rng, median, sigma, size):
    """Lognormal draws with the given MEDIAN (median = exp(mu))."""
    return rng.lognormal(mean=np.log(median), sigma=sigma, size=size)


def whole_seconds(x):
    """Round to whole seconds, minimum 1."""
    return np.maximum(1, np.rint(x)).astype(np.int64)


def make_zcta(zcta, pop, kind, county, daily_factor, params, groups, surge, closure, days_arr):
    """All calls of one ZIP area, as a dict of numpy arrays. Draw order is fixed."""
    p = params
    rng = np.random.default_rng([p["seed"], int(zcta)])
    base_daily = pop * p["base_rate_per_person_per_year"] / 365.0
    lam = base_daily * daily_factor.copy()
    in_surge = surge and county == p["summer_surge"]["county_fips"]
    if in_surge:
        lam[days_arr["surge_mask"]] *= p["summer_surge"]["volume_multiplier"]
    counts = rng.poisson(lam)
    n = int(counts.sum())
    out = {"n": n}
    if n == 0:
        return out
    day_idx = np.repeat(np.arange(len(lam)), counts)
    u_time = rng.random(n)
    t_recv = np.floor(days_arr["start"][day_idx] + u_time * days_arr["length"][day_idx]).astype(np.int64)
    code = rng.choice(10, size=n, p=np.array(p["urgency_code_probs_0_to_9"]))
    grp = groups[code]  # 0 red, 1 yellow, 2 green
    z_disp = rng.standard_normal(n)
    u_held = rng.random(n)
    z_held_extra = rng.standard_normal(n)
    z_turn = rng.standard_normal(n)
    z_eta = rng.standard_normal(n)
    z_ratio = rng.standard_normal(n)
    u_disp = rng.random(n)
    u_valid = rng.random(n)

    names = ["red", "yellow", "green"]
    disp_med = np.array([p["dispatch_median_s"][g] for g in names])[grp]
    ratio_med = np.array([p["drive_ratio_median"][g] for g in names])[grp]
    dispatch = disp_med * np.exp(p["dispatch_sigma"] * z_disp)
    held_p = np.full(n, p["held_probability"])
    if in_surge:
        m = days_arr["surge_mask"][day_idx]
        held_p[m] = p["summer_surge"]["held_probability"]
        dispatch[m] *= p["summer_surge"]["dispatch_multiplier"]
    held = u_held < held_p
    dispatch = dispatch + held * (p["held_extra_dispatch_median_s"]
                                  * np.exp(p["held_extra_dispatch_sigma"] * z_held_extra))
    turnout = p["turnout_median_s"] * np.exp(p["turnout_sigma"] * z_turn)
    eta = p["eta_median_s"][kind] * np.exp(p["eta_sigma"] * z_eta)
    if closure and zcta == p["station_closure"]["zcta_resolved"]:
        from_ts = days_arr["closure_start"]
        eta = np.where(t_recv >= from_ts, eta * p["station_closure"]["eta_multiplier"], eta)
    eta_s = whole_seconds(eta)
    drive = whole_seconds(eta_s * ratio_med * np.exp(p["drive_ratio_sigma"] * z_ratio))
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
    out.update(zcta=np.full(n, zcta), code=code, t_recv=t_recv, t_assigned=t_assigned,
               t_enroute=t_enroute, t_onscene=t_onscene, disp=disp,
               valid=np.where(u_valid < p["valid_time_N_probability"], "N", "Y"),
               eta=eta_s, held=np.where(held, "Y", "N"))
    return out


def iso(epoch, tz, empty=None):
    """UTC epoch seconds -> '2026-10-11T22:14:05-04:00' strings (empty where `empty` is True)."""
    ts = pd.to_datetime(epoch, unit="s", utc=True).tz_convert(tz)
    s = pd.Series(ts.strftime("%Y-%m-%dT%H:%M:%S%z"))
    s = s.str.replace(r"(\d\d)$", r":\1", regex=True)
    if empty is not None:
        s[empty] = ""
    return s.to_numpy()


def build_file(name, params, lookup, groups, days_arr, daily_factor, outdir):
    surge = name == "summer_surge"
    closure = name == "station_closure"
    parts = []
    for r in lookup.itertuples():
        o = make_zcta(r.zcta, r.population, r.urban_rural, r.county_fips, daily_factor,
                      params, groups, surge, closure, days_arr)
        if o["n"]:
            parts.append(o)
    cat = {k: np.concatenate([o[k] for o in parts]) for k in parts[0] if k != "n"}
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
        "disposition": cat["disp"],
        "valid_time": cat["valid"],
        "eta_google_s": cat["eta"],
        "held": cat["held"],
    })[COLUMNS]
    path = outdir / f"incidents_{name}.csv.gz"
    df.to_csv(path, index=False, compression="gzip")
    print(f"wrote {path.name}: {n:,} calls, {path.stat().st_size / 1e6:.1f} MB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lookup", default=str(HERE / "lookup"))
    ap.add_argument("--out", default=str(HERE))
    args = ap.parse_args()
    lookup_dir, outdir = Path(args.lookup), Path(args.out)

    params = load_params()
    lookup = pd.read_csv(lookup_dir / "zcta_county.csv", dtype={"zcta": str, "county_fips": str})
    if lookup.empty:
        sys.exit("zcta_county.csv is empty. Run: python data/build_lookups.py")
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
    days_arr = {
        "start": starts, "length": lengths,
        "surge_mask": np.array([sd0 <= d <= sd1 for d in days]),
        "closure_start": datetime(cdate.year, cdate.month, cdate.day, tzinfo=tz).timestamp(),
    }
    for name in ["baseline", "station_closure", "summer_surge"]:
        build_file(name, params, lookup, groups, days_arr, daily_factor, outdir)


if __name__ == "__main__":
    main()
