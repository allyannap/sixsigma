"""Check the three synthetic incident files. One PASS/FAIL line per check; exit 1 on any FAIL.

Run from the repo root:   python data/validate.py
Optional (for testing): --dir DIR --lookup DIR
It also runs a self-test first: the time-order check must FAIL on a tiny bad table.
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
NAMES = ["baseline", "station_closure", "summer_surge"]
TIME_COLS = ["t_received", "t_assigned", "t_enroute", "t_onscene"]
RESULTS = []  # (ok, text)


def report(ok, text):
    RESULTS.append(ok)
    print(("PASS  " if ok else "FAIL  ") + text)


def parse_times(df):
    """Return a copy with the four time columns as UTC datetimes (empty -> NaT)."""
    out = df.copy()
    for c in TIME_COLS:
        out[c] = pd.to_datetime(out[c], utc=True)
    return out


def times_in_order(t):
    """True when t_received <= t_assigned <= t_enroute <= t_onscene (onscene may be empty)."""
    a = (t["t_received"] <= t["t_assigned"]) & (t["t_assigned"] <= t["t_enroute"])
    b = t["t_onscene"].isna() | (t["t_enroute"] <= t["t_onscene"])
    return bool((a & b).all())


def self_test():
    """Degenerate case: the order check must reject t_assigned earlier than t_received."""
    bad = pd.DataFrame({
        "t_received": ["2026-01-01T10:00:00-05:00"], "t_assigned": ["2026-01-01T09:59:00-05:00"],
        "t_enroute": ["2026-01-01T10:01:00-05:00"], "t_onscene": ["2026-01-01T10:09:00-05:00"]})
    good = bad.copy()
    good["t_assigned"] = "2026-01-01T10:00:30-05:00"
    ok = (not times_in_order(parse_times(bad))) and times_in_order(parse_times(good))
    report(ok, "self-test: order check rejects t_assigned < t_received and accepts a good row")


def red_late(df, lookup, targets):
    """Red calls that count for time statistics, with total_s and late; urban_rural attached."""
    t = df.merge(targets[["urgency_code", "urgency_group", "target_s"]], on="urgency_code")
    t = t[(t.urgency_group == "red") & t["t_onscene"].notna() & (t["valid_time"] == "Y")].copy()
    t["total_s"] = (t["t_onscene"] - t["t_received"]).dt.total_seconds()
    t["late"] = t["total_s"] > t["target_s"]
    t["date"] = t["t_received"].dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
    return t.merge(lookup[["zcta", "urban_rural", "county_fips"]], on="zcta")


def pct(x):
    return 100.0 * x.mean() if len(x) else float("nan")


def in_range(d, a, b):
    return d[(d["date"] >= a) & (d["date"] <= b)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(HERE))
    ap.add_argument("--lookup", default=str(HERE / "lookup"))
    args = ap.parse_args()
    d, ld = Path(args.dir), Path(args.lookup)

    self_test()
    lookup = pd.read_csv(ld / "zcta_county.csv", dtype={"zcta": str, "county_fips": str})
    counties = pd.read_csv(ld / "counties.csv", dtype={"county_fips": str})
    targets = pd.read_csv(ROOT / "config" / "targets.csv")
    codes = set(targets["urgency_code"])
    # same rule generate.py uses: most populous urban ZIP, ties to the smaller ZIP code
    urban = lookup[lookup.urban_rural == "urban"].sort_values(["population", "zcta"], ascending=[False, True])
    closure_zip = urban.iloc[0].zcta
    monroe = "36055"

    frames, parsed = {}, {}
    for n in NAMES:
        path = d / f"incidents_{n}.csv.gz"
        if not path.exists():
            report(False, f"{n}: file exists ({path.name})")
            continue
        df = pd.read_csv(path, dtype={"zcta": str, "incident_id": str}, keep_default_na=False,
                         na_values=[""])
        df["disposition"] = df["disposition"].astype(str)
        frames[n] = df
        t = parse_times(df)
        parsed[n] = t
        mb = path.stat().st_size / 1e6
        report(mb < 25, f"{n}: file size {mb:.1f} MB < 25 MB")
        report(len(df) > 0 and 300_000 <= len(df) <= 500_000, f"{n}: about 400,000 calls ({len(df):,})")
        report(df["incident_id"].is_unique, f"{n}: incident_id unique")
        report(bool(t["t_received"].is_monotonic_increasing), f"{n}: sorted by t_received")
        report(times_in_order(t), f"{n}: times in order (received <= assigned <= enroute <= onscene)")
        report(bool(df["zcta"].isin(set(lookup["zcta"])).all()), f"{n}: every zcta is in zcta_county.csv")
        report(bool(df["urgency_code"].isin(codes).all()), f"{n}: every urgency_code is in config/targets.csv")
        on = df["t_onscene"].notna()
        report(bool((df.loc[on, "eta_google_s"] > 0).all()), f"{n}: eta_google_s > 0 whenever t_onscene is filled")
        canc = df["disposition"] == "CANCELLED"
        report(bool((~on[canc]).all()) and bool(canc[~on].all()),
               f"{n}: CANCELLED has empty t_onscene and every empty t_onscene is CANCELLED")
        month = t["t_received"].dt.tz_convert("America/New_York").dt.month
        peak = int(month.value_counts().idxmax())
        report(peak in (6, 7, 8), f"{n}: monthly volume peaks in Jun-Aug (peak month {peak})")
        cty = df.merge(lookup[["zcta", "county_fips"]], on="zcta")["county_fips"]
        report(cty.nunique() == 62 and set(cty) == set(counties["county_fips"]),
               f"{n}: 62 counties and every county has calls ({cty.nunique()} with calls)")

    # Acceptance bands, baseline file
    if "baseline" in parsed:
        r = red_late(parsed["baseline"], lookup, targets)
        g = r.groupby("urban_rural")["late"].apply(pct)
        n_calls = r.groupby("urban_rural").size()
        for grp, lo, hi in [("urban", 5, 10), ("suburban", 6, 10), ("rural", 30, 100)]:
            v = g.get(grp, float("nan"))
            report(lo <= v <= hi, f"baseline red % late, {grp}: {v:.2f}% (band {lo}-{hi}%, "
                                  f"{int(n_calls.get(grp, 0)):,} calls)")

    # Planted story 1: station closure
    if "station_closure" in parsed and "baseline" in parsed:
        r = red_late(parsed["station_closure"], lookup, targets)
        z = r[r["zcta"] == closure_zip]
        before = pct(in_range(z, "2026-07-01", "2026-08-31")["late"])
        after = pct(in_range(z, "2026-09-01", "2026-10-15")["late"])
        report(after >= 2 * before,
               f"station_closure ZIP {closure_zip} red % late: Jul-Aug {before:.2f}%, "
               f"Sep 1-Oct 15 {after:.2f}% (need at least 2x)")
        cols = [c for c in frames["baseline"].columns if c != "incident_id"]
        a = frames["baseline"][frames["baseline"]["zcta"] != closure_zip][cols].reset_index(drop=True)
        b = frames["station_closure"][frames["station_closure"]["zcta"] != closure_zip][cols].reset_index(drop=True)
        report(a.equals(b), f"station_closure: all other ZIPs identical to baseline ({len(b):,} rows)")

    # Planted story 2: summer surge in Monroe County
    if "summer_surge" in parsed and "baseline" in parsed:
        def monroe_window(n, a, b):
            df = frames[n].merge(lookup[["zcta", "county_fips"]], on="zcta")
            df = df[df["county_fips"] == monroe]
            dt = df["t_received"].str[:10]
            return df[(dt >= a) & (dt <= b)]
        s = monroe_window("summer_surge", "2026-07-01", "2026-08-31")
        b = monroe_window("baseline", "2026-07-01", "2026-08-31")
        ratio = len(s) / len(b)
        report(1.25 <= ratio <= 1.35, f"summer_surge Monroe Jul-Aug volume / baseline = {ratio:.3f} "
                                      f"({len(s):,} / {len(b):,}; band 1.25-1.35)")
        h1 = (s["held"] == "Y").mean()
        s2 = monroe_window("summer_surge", "2026-09-01", "2026-10-15")
        h2 = (s2["held"] == "Y").mean()
        report(h1 > 0.15, f"summer_surge Monroe held rate Jul-Aug = {h1:.3f} (need > 0.15)")
        report(h2 < 0.05, f"summer_surge Monroe held rate Sep 1-Oct 15 = {h2:.3f} (need < 0.05)")

    fails = RESULTS.count(False)
    print(f"\n{len(RESULTS) - fails} PASS, {fails} FAIL")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
