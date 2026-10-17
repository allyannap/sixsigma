"""Check the three synthetic incident files and the messy sample. One PASS/FAIL line per check; exit 1 on any FAIL.

Run from the repo root:   python data/validate.py
Optional: --dir DIR --lookup DIR (testing), --reproduce (rebuild into a temp folder with the fixed seed
and check the content is identical, about 1.5 minutes), --messy (only the messy-sample checks).
It also runs a self-test first: the time-order check must FAIL on a tiny bad table.

The red "% late" bands are GENERATOR TUNING TARGETS (the parameters were adjusted until the synthetic data
landed in them), not external benchmarks.
"""
import argparse
import hashlib
import json
import subprocess
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
NAMES = ["baseline", "station_closure", "summer_surge"]
# The demo windows in README.md; each needs 120 days of history before it (the longest baseline).
DEMO_WINDOWS = [("2026-07-18", "2026-10-15"), ("2026-09-01", "2026-10-15"), ("2026-07-01", "2026-08-31")]
FILE_COLUMNS = ["incident_id", "zcta", "urgency_code", "t_received", "t_assigned", "t_enroute",
                "t_onscene", "cancelled", "valid_time", "held"]  # the whole input contract: 10 columns
TIME_COLS = ["t_received", "t_assigned", "t_enroute", "t_onscene"]
BAD_TOTAL_S = 4 * 3600  # a response over 4 hours is not a real response time (messy-sample detector)
RED_REF_S = 480  # the bands below judge every red call against 480 s (NFPA-style), not the tier target
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
    groups = targets.drop_duplicates("urgency_code")[["urgency_code", "urgency_group"]]
    t = df.merge(groups, on="urgency_code")
    t["target_s"] = RED_REF_S
    t = t[(t.urgency_group == "red") & t["t_onscene"].notna() & (t["valid_time"] == "Y")].copy()
    t["total_s"] = (t["t_onscene"] - t["t_received"]).dt.total_seconds()
    t["late"] = t["total_s"] > t["target_s"]
    t["date"] = t["t_received"].dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
    return t.merge(lookup[["zcta", "urban_rural", "county_fips"]], on="zcta")


def pct(x):
    return 100.0 * x.mean() if len(x) else float("nan")


def in_range(d, a, b):
    return d[(d["date"] >= a) & (d["date"] <= b)]


def daily_dispersion(r):
    """Per county: Pearson chi-square / (days - 1) of the DAILY red late counts against one pooled late share.
    Returns a DataFrame (county_fips, red_per_day, dispersion, days). 1 means binomial; above 1 means overdispersed."""
    rows = []
    for c, g in r.groupby("county_fips"):
        d = g.groupby("date")["late"].agg(["sum", "count"])
        p = d["sum"].sum() / d["count"].sum()
        if not 0 < p < 1 or len(d) < 30:
            continue
        chi = ((d["sum"] - d["count"] * p) ** 2 / (d["count"] * p * (1 - p))).sum()
        rows.append((c, d["count"].mean(), chi / (len(d) - 1), len(d)))
    return pd.DataFrame(rows, columns=["county_fips", "red_per_day", "dispersion", "days"])


def detect_problems(df, lookup, codes):
    """Count each kind of data problem in an incident table (times NaT where empty). Returns (counts, row masks)."""
    t = parse_times(df)
    first3 = t["t_received"].notna() & t["t_assigned"].notna() & t["t_enroute"].notna()
    in_order = ((t["t_received"] <= t["t_assigned"]) & (t["t_assigned"] <= t["t_enroute"])
                & (t["t_onscene"].isna() | (t["t_enroute"] <= t["t_onscene"])))
    total = (t["t_onscene"] - t["t_received"]).dt.total_seconds()
    dup_exact = df.duplicated(keep="first")
    masks = {
        "missing_t_received": t["t_received"].isna(),
        "missing_t_assigned": t["t_assigned"].isna(),
        "out_of_order": first3 & ~in_order,
        "exact_duplicate_rows": dup_exact,
        "duplicate_id_different_content": df.duplicated("incident_id", keep="first") & ~dup_exact,
        "unknown_zcta": ~df["zcta"].isin(set(lookup["zcta"])),
        "unknown_urgency_code": ~df["urgency_code"].isin(codes),
        "valid_time_N_with_bad_times": (df["valid_time"] == "N") & (total > BAD_TOTAL_S),
    }
    return {k: int(v.sum()) for k, v in masks.items()}, masks


def messy_checks(d, ld, lookup, codes):
    """The messy sample: each injected problem type is detected with exactly the logged count."""
    path = d / "incidents_messy_sample.csv.xz"
    if not path.exists():
        report(False, f"messy sample: file exists ({path.name})")
        return
    m = json.load(open(HERE / "params.json"))["messy_sample"]
    df = pd.read_csv(path, dtype={"zcta": str, "incident_id": str}, keep_default_na=False, na_values=[""])
    report(list(df.columns) == FILE_COLUMNS, "messy sample: header is exactly the 10 input columns")
    df["valid_time"] = df["valid_time"].astype(str)
    mb = path.stat().st_size / 1e6
    report(mb < 1 and 10_000 <= len(df) <= 16_000, f"messy sample: {len(df):,} rows (10,000-16,000), {mb:.2f} MB")
    counts, masks = detect_problems(df, lookup, codes)
    for key, got in counts.items():
        want = m["n_" + key]
        report(got == want, f"messy sample: {key.replace('_', ' ')} detected {got}, injected {want}")
    # the rows no detector flagged are untouched baseline rows (same incident_id, same values)
    flagged = pd.concat(masks, axis=1).any(axis=1)
    clean = df[~flagged].set_index("incident_id")
    zero, _ = detect_problems(df[~flagged], lookup, codes)
    report(sum(zero.values()) == 0, f"messy sample: detectors find nothing in the {len(clean):,} untouched rows")
    bpath = d / "incidents_baseline.csv.xz"
    if bpath.exists():
        base = pd.read_csv(bpath, dtype=str, keep_default_na=False, na_values=[""]).set_index("incident_id")
        raw = pd.read_csv(path, dtype=str, keep_default_na=False, na_values=[""])
        a = raw[~flagged.to_numpy()].set_index("incident_id").fillna("")
        sub = base.loc[a.index].fillna("")
        report(a.equals(sub),
               "messy sample: every untouched row equals the baseline row with the same incident_id")
    # one county, one month
    cty = lookup.set_index("zcta")["county_fips"]
    ok = (clean.index.size > 0 and set(clean["zcta"].map(cty)) == {m["county_fips"]}
          and set(clean["t_received"].str[:7]) == {m["month"]})
    report(bool(ok), f"messy sample: untouched rows are all {m['county_name']} ({m['county_fips']}) in {m['month']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=str(HERE))
    ap.add_argument("--lookup", default=str(HERE / "lookup"))
    ap.add_argument("--reproduce", action="store_true", help="rebuild from the seed and compare (slow)")
    ap.add_argument("--messy", action="store_true", help="only check the messy sample (fast)")
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

    if args.messy:
        messy_checks(d, ld, lookup, codes)
        fails = RESULTS.count(False)
        print(f"\n{len(RESULTS) - fails} PASS, {fails} FAIL")
        sys.exit(1 if fails else 0)

    frames, parsed = {}, {}
    for n in NAMES:
        path = d / f"incidents_{n}.csv.xz"
        if not path.exists():
            report(False, f"{n}: file exists ({path.name})")
            continue
        df = pd.read_csv(path, dtype={"zcta": str, "incident_id": str}, keep_default_na=False,
                         na_values=[""])
        report(list(df.columns) == FILE_COLUMNS and "eta_google_s" not in df.columns
               and "disposition" not in df.columns,
               f"{n}: header is exactly the 10 input columns, no eta_google_s, no disposition")
        frames[n] = df
        t = parse_times(df)
        parsed[n] = t
        mb = path.stat().st_size / 1e6
        report(mb < 25, f"{n}: file size {mb:.1f} MB < 25 MB")
        report(len(df) > 0 and 1_600_000 <= len(df) <= 2_000_000, f"{n}: about 1.8 million calls ({len(df):,})")
        report(df["incident_id"].is_unique, f"{n}: incident_id unique")
        report(bool(t["t_received"].is_monotonic_increasing), f"{n}: sorted by t_received")
        report(times_in_order(t), f"{n}: times in order (received <= assigned <= enroute <= onscene)")
        report(bool(df["zcta"].isin(set(lookup["zcta"])).all()), f"{n}: every zcta is in zcta_county.csv")
        report(bool(df["urgency_code"].isin(codes).all()), f"{n}: every urgency_code is in config/targets.csv")
        on = df["t_onscene"].notna()
        report(bool(df["cancelled"].isin(["Y", "N"]).all()), f"{n}: cancelled is Y or N on every row")
        canc = df["cancelled"] == "Y"
        report(bool((~on[canc]).all()) and bool(canc[~on].all()),
               f"{n}: cancelled = Y has empty t_onscene and every empty t_onscene is cancelled")
        month = t["t_received"].dt.tz_convert("America/New_York").dt.month
        peak = int(month.value_counts().idxmax())
        report(peak in (6, 7, 8), f"{n}: monthly volume peaks in Jun-Aug (peak month {peak})")
        ok_on = on & (df["valid_time"] == "Y")
        tot = (t.loc[ok_on, "t_onscene"] - t.loc[ok_on, "t_received"]).dt.total_seconds()
        parts = ((t.loc[ok_on, "t_assigned"] - t.loc[ok_on, "t_received"]).dt.total_seconds()
                 + (t.loc[ok_on, "t_enroute"] - t.loc[ok_on, "t_assigned"]).dt.total_seconds()
                 + (t.loc[ok_on, "t_onscene"] - t.loc[ok_on, "t_enroute"]).dt.total_seconds())
        report(bool((tot == parts).all()), f"{n}: stage intervals add up to total_s for every completed call")
        first = t["t_received"].dt.tz_convert("America/New_York").dt.date.min()
        need = min(date.fromisoformat(a) for a, _ in DEMO_WINDOWS) - timedelta(days=120)
        report(first <= need, f"{n}: data starts {first}, at least 120 baseline days before every demo window ({need})")
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
            report(lo <= v <= hi, f"baseline red % late at {RED_REF_S} s, {grp}: {v:.2f}% (band {lo}-{hi}%, "
                                  f"{int(n_calls.get(grp, 0)):,} calls)")
        rem, rur = g.get("remote", float("nan")), g.get("rural", float("nan"))
        report(rem > rur, f"baseline red % late at {RED_REF_S} s, remote > rural: remote {rem:.2f}% vs "
                          f"rural {rur:.2f}% ({int(n_calls.get('remote', 0)):,} remote calls)")
        # Day-to-day dependence: daily late counts are overdispersed. Counties with under 5 red calls a day have
        # too few calls per day for the daily test to show it, so the check uses the counties with 5 or more.
        disp = daily_dispersion(r)
        big = disp[disp["red_per_day"] >= 5]
        report(len(big) >= 10 and big["dispersion"].median() > 1.15,
               f"baseline daily red late counts overdispersed: median Pearson dispersion {big['dispersion'].median():.2f} "
               f"over {len(big)} counties with 5+ red calls a day (need > 1.15); all {len(disp)} counties: "
               f"median {disp['dispersion'].median():.2f}, max {disp['dispersion'].max():.2f}")
        # Seasonality in lateness: winter (Dec-Feb) roads. Compared within urban ZIPs so the mix of areas cannot cause it.
        month = r["date"].str[5:7].astype(int)
        win = month.isin([12, 1, 2])
        ur = r["urban_rural"] == "urban"
        w_u, o_u = pct(r.loc[win & ur, "late"]), pct(r.loc[~win & ur, "late"])
        w_all, o_all = pct(r.loc[win, "late"]), pct(r.loc[~win, "late"])
        report(w_u >= 1.15 * o_u and w_all >= 1.10 * o_all,
               f"baseline red % late, Dec-Feb vs other months: urban {w_u:.2f}% vs {o_u:.2f}% (need 1.15x), "
               f"statewide {w_all:.2f}% vs {o_all:.2f}% (need 1.10x)")
        # Hour of day: arrivals follow the profile in params.json.
        hours = parsed["baseline"]["t_received"].dt.tz_convert("America/New_York").dt.hour.value_counts()
        report(hours.max() / hours.min() > 1.8,
               f"baseline arrivals by hour: busiest hour {int(hours.idxmax())}:00 has {hours.max() / hours.min():.2f}x "
               f"the calls of the quietest ({int(hours.idxmin())}:00) (need > 1.8)")

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
        fb, fc = frames["baseline"], frames["station_closure"]
        pre = lambda f: f[(f["zcta"] == closure_zip) & (f["t_received"].str[:10] < "2026-09-01")][cols].reset_index(drop=True)
        report(pre(fb).equals(pre(fc)),
               f"station_closure: ZIP {closure_zip} before Sep 1 identical to baseline ({len(pre(fc)):,} rows)")

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
        cols = [c for c in frames["baseline"].columns if c != "incident_id"]
        county_of = lookup.set_index("zcta")["county_fips"]
        fb, fs = frames["baseline"], frames["summer_surge"]
        other = lambda f: f[f["zcta"].map(county_of) != monroe][cols].reset_index(drop=True)
        report(other(fb).equals(other(fs)), f"summer_surge: all non-Monroe ZIPs identical to baseline ({len(other(fs)):,} rows)")
        outside = lambda f: f[(f["t_received"].str[:10] < "2026-07-01") | (f["t_received"].str[:10] > "2026-08-31")][cols].reset_index(drop=True)
        report(outside(fb).equals(outside(fs)),
               f"summer_surge: every row received outside Jul 1 - Aug 31 (Monroe too) identical to baseline ({len(outside(fs)):,} rows)")

    messy_checks(d, ld, lookup, codes)

    if args.reproduce:
        with tempfile.TemporaryDirectory() as tmp:
            subprocess.run([sys.executable, str(HERE / "generate.py"), "--out", tmp], check=True,
                           stdout=subprocess.DEVNULL)
            for n in NAMES + ["messy_sample"]:
                a = hashlib.sha256(pd.read_csv(d / f"incidents_{n}.csv.xz", dtype=str).to_csv().encode()).hexdigest()
                b = hashlib.sha256(pd.read_csv(Path(tmp) / f"incidents_{n}.csv.xz", dtype=str).to_csv().encode()).hexdigest()
                report(a == b, f"{n}: rebuilt from the fixed seed, content identical (sha256 {a[:12]})")

    fails = RESULTS.count(False)
    print(f"\n{len(RESULTS) - fails} PASS, {fails} FAIL")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
