"""Build config/targets.csv: one row per (urgency code, area type) = 10 codes x 4 area types.

Run from the repo root:   python config/build_targets.py

Method (SPEC section 4):
  1. Read data/incidents_baseline.csv.gz.
  2. Keep timed RED calls (urgency codes 0-2): not CANCELLED, t_onscene present, valid_time = Y,
     times in order, received 2025-10-16 to 2026-04-15 inclusive (America/New_York dates).
  3. Join each call's ZCTA to its area type (data/lookup/zcta_county.csv, column urban_rural).
  4. Per area type: reference_p90_s = 90th percentile of total_s (numpy linear interpolation);
     target_s = reference_p90_s rounded UP to a multiple of 10 s.
  5. Yellow (codes 3-5) are 900 s and green (6-9) 1800 s in every area type; every goal is 90%.
The output is deterministic: running it again gives the same file, byte for byte.
"""
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REF_FROM, REF_TO = "2025-10-16", "2026-04-15"
AREA_TYPES = ["urban", "suburban", "rural", "remote"]
RED_CODES, YELLOW_CODES, GREEN_CODES = [0, 1, 2], [3, 4, 5], [6, 7, 8, 9]
YELLOW_S, GREEN_S, GOAL_PCT = 900, 1800, 90


def round_up_10(x):
    """Round up to the next multiple of 10 seconds (a value already on a multiple stays)."""
    return int(math.ceil(round(x, 6) / 10.0) * 10)


def reference_calls():
    """Timed red calls in the reference period, with total_s and urban_rural."""
    df = pd.read_csv(ROOT / "data" / "incidents_baseline.csv.gz", dtype={"zcta": str},
                     keep_default_na=False, na_values=[""])
    df = df[df["urgency_code"].isin(RED_CODES)].copy()
    for c in ["t_received", "t_assigned", "t_enroute", "t_onscene"]:
        df[c] = pd.to_datetime(df[c], utc=True, format="ISO8601")
    date = df["t_received"].dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
    in_order = ((df["t_received"] <= df["t_assigned"]) & (df["t_assigned"] <= df["t_enroute"])
                & (df["t_enroute"] <= df["t_onscene"]))
    keep = ((df["disposition"] != "CANCELLED") & df["t_onscene"].notna() & (df["valid_time"] == "Y")
            & in_order & (date >= REF_FROM) & (date <= REF_TO))
    df = df[keep].copy()
    df["total_s"] = (df["t_onscene"] - df["t_received"]).dt.total_seconds()
    area = pd.read_csv(ROOT / "data" / "lookup" / "zcta_county.csv", dtype={"zcta": str})
    return df.merge(area[["zcta", "urban_rural"]], on="zcta", how="left")


def build():
    calls = reference_calls()
    red = {}
    for area in AREA_TYPES:
        x = calls.loc[calls["urban_rural"] == area, "total_s"].to_numpy(dtype=float)
        if len(x) == 0:
            raise SystemExit(f"no reference red calls in area type '{area}': cannot set its target")
        p90 = float(np.percentile(x, 90))  # linear interpolation (numpy default)
        red[area] = (round_up_10(p90), round(p90, 1), len(x))
    rows = []
    for code in range(10):
        for area in AREA_TYPES:
            if code in RED_CODES:
                group, target, p90, n = "red", red[area][0], red[area][1], red[area][2]
            else:
                group = "yellow" if code in YELLOW_CODES else "green"
                target, p90, n = (YELLOW_S if group == "yellow" else GREEN_S), "", ""
            rows.append((code, area, group, target, GOAL_PCT, p90, n))
    out = pd.DataFrame(rows, columns=["urgency_code", "urban_rural", "urgency_group", "target_s",
                                      "goal_on_time_pct", "reference_p90_s", "n_reference"])
    return out, red


def main():
    out, red = build()
    out.to_csv(HERE / "targets.csv", index=False, lineterminator="\n")
    print(f"wrote {len(out)} rows to config/targets.csv (reference period {REF_FROM} to {REF_TO})")
    for area in AREA_TYPES:
        t, p90, n = red[area]
        print(f"  {area:9s} red target {t} s ({t / 60:.2f} min), reference P90 {p90} s, n = {n:,}")


if __name__ == "__main__":
    main()
