"""Build config/targets.csv: one row per (urgency code, area type) = 10 codes x 4 area types.

Run from the repo root:   python config/build_targets.py                 (default: red target by area type, below)
                          python config/build_targets.py --flat          (the old flat 480 s red target)
                          python config/build_targets.py --from-history  (red target = area P90; circular, see below)

DEFAULT (team policy decision, Oct 16, H-13): the red target depends on the area type, adapted from the
demand-zone response-time objectives of NFPA 1720 (Standard for the Organization and Deployment of Fire
Suppression Operations, Emergency Medical Operations, and Special Operations to the Public by Volunteer Fire
Departments): urban 8 min, suburban 10 min, rural 14 min. These are ILLUSTRATIVE PLACEHOLDERS, not certified
standards for any center:
  urban    480 s  (8 min; also the decisions brief's placeholder)
  suburban 600 s  (NFPA 1720 suburban zone, 10 min)
  rural    840 s  (NFPA 1720 rural zone, 14 min)
  remote   840 s  (FLAGGED: NFPA 1720 says remote-zone response depends on travel distance and gives no fixed
                   time, so the rural value is reused here; a center must set its own)
  yellow 900 s and green 1800 s in every area type; goal 90% on time everywhere.
CAVEAT: NFPA 1720 is a fire-service standard for volunteer departments, and its clock (dispatch or
notification to arrival) is not the same as our call-received-to-on-scene clock (t_received to t_onscene).
It is used here only as a source of the tier ratio and round numbers. Area types here are defined by
2020 Census density (see data/README.md), not by NFPA's own demand-zone definitions.

--flat reproduces the earlier flat placeholder: red 480 s in every area type.
--from-history sets each area type's red target to its own P90 from the reference period. It is not the
default because it is circular for the specification check (every area's on-time rate then sits at about
90% by construction and nearly every place reads "inconclusive").

Reference columns (written in every mode, for context only):
  1. Read data/incidents_baseline.csv.xz.
  2. Keep timed RED calls (urgency codes 0-2): not CANCELLED, t_onscene present, valid_time = Y,
     times in order, received 2025-10-16 to 2026-04-15 inclusive (America/New_York dates).
  3. Join each call's ZCTA to its area type (data/lookup/zcta_county.csv, column urban_rural).
  4. Per area type: reference_p90_s = 90th percentile of total_s (numpy linear interpolation);
     with --from-history, target_s = reference_p90_s rounded UP to a multiple of 10 s.
  5. Yellow (codes 3-5) are 900 s and green (6-9) 1800 s in every area type; every goal is 90%.
The output is deterministic: running it again gives the same file, byte for byte.
"""
import argparse
import math
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
REF_FROM, REF_TO = "2025-10-16", "2026-04-15"
AREA_TYPES = ["urban", "suburban", "rural", "remote"]
RED_CODES, YELLOW_CODES, GREEN_CODES = [0, 1, 2], [3, 4, 5], [6, 7, 8, 9]
FLAT_RED_S, YELLOW_S, GREEN_S, GOAL_PCT = 480, 900, 1800, 90
# Default red targets by area type (NFPA 1720 demand zones, adapted; remote reuses rural and is flagged).
TIER_RED_S = {"urban": 480, "suburban": 600, "rural": 840, "remote": 840}


def round_up_10(x):
    """Round up to the next multiple of 10 seconds (a value already on a multiple stays)."""
    return int(math.ceil(round(x, 6) / 10.0) * 10)


def reference_calls():
    """Timed red calls in the reference period, with total_s and urban_rural."""
    df = pd.read_csv(ROOT / "data" / "incidents_baseline.csv.xz", dtype={"zcta": str},
                     keep_default_na=False, na_values=[""])
    df = df[df["urgency_code"].isin(RED_CODES)].copy()
    for c in ["t_received", "t_assigned", "t_enroute", "t_onscene"]:
        df[c] = pd.to_datetime(df[c], utc=True, format="ISO8601")
    date = df["t_received"].dt.tz_convert("America/New_York").dt.strftime("%Y-%m-%d")
    in_order = ((df["t_received"] <= df["t_assigned"]) & (df["t_assigned"] <= df["t_enroute"])
                & (df["t_enroute"] <= df["t_onscene"]))
    keep = ((df["cancelled"] != "Y") & df["t_onscene"].notna() & (df["valid_time"] == "Y")
            & in_order & (date >= REF_FROM) & (date <= REF_TO))
    df = df[keep].copy()
    df["total_s"] = (df["t_onscene"] - df["t_received"]).dt.total_seconds()
    area = pd.read_csv(ROOT / "data" / "lookup" / "zcta_county.csv", dtype={"zcta": str})
    return df.merge(area[["zcta", "urban_rural"]], on="zcta", how="left")


def build(mode="tiered"):
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
                group, p90, n = "red", red[area][1], red[area][2]
                target = {"history": red[area][0], "flat": FLAT_RED_S, "tiered": TIER_RED_S[area]}[mode]
            else:
                group = "yellow" if code in YELLOW_CODES else "green"
                target, p90, n = (YELLOW_S if group == "yellow" else GREEN_S), "", ""
            rows.append((code, area, group, target, GOAL_PCT, p90, n))
    out = pd.DataFrame(rows, columns=["urgency_code", "urban_rural", "urgency_group", "target_s",
                                      "goal_on_time_pct", "reference_p90_s", "n_reference"])
    return out, red


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--flat", action="store_true", help="flat red target 480 s in every area type")
    g.add_argument("--from-history", action="store_true", help="red target = area type P90 (circular; not the default)")
    args = ap.parse_args()
    mode = "history" if args.from_history else "flat" if args.flat else "tiered"
    out, red = build(mode)
    out.to_csv(HERE / "targets.csv", index=False, lineterminator="\n")
    label = {"history": "history-based red targets", "flat": f"flat red target {FLAT_RED_S} s",
             "tiered": "red targets by area type, adapted from NFPA 1720 (illustrative placeholders)"}[mode]
    print(f"wrote {len(out)} rows to config/targets.csv ({label}; reference period {REF_FROM} to {REF_TO})")
    for area in AREA_TYPES:
        t, p90, n = red[area]
        t = {"history": t, "flat": FLAT_RED_S, "tiered": TIER_RED_S[area]}[mode]
        flag = "  (remote reuses the rural value: NFPA 1720 gives no fixed time; flagged)" if mode == "tiered" and area == "remote" else ""
        print(f"  {area:9s} red target {t} s ({t / 60:.2f} min), reference P90 {p90} s, n = {n:,}{flag}")


if __name__ == "__main__":
    main()
