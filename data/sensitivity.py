"""How often does the control rule cry wolf, and how big a change does it catch? Prints two tables; writes no file.

Run from the repo root:   python data/sensitivity.py        (about 1 minute)

Table 1, FALSE ALARMS. The clean file (data/incidents_baseline.csv.xz) has no planted change, so every county or
state window the rule calls "out of control" is a false alarm. A window is a selection [from, to]; its baseline is
the 60 days before it (stretched to 120), exactly as the dashboard does it. A window needs a full 60-day baseline
inside the file, so a year of data holds only three non-overlapping 90-day windows and one 180-day window.
The 180-day rows therefore use windows that step back 30 days at a time and OVERLAP: they re-use the same calls,
so read them as one rough estimate, not as independent trials.

Table 2, DETECTION. ZIP 11368 (the closure ZIP) is rebuilt in memory from the CLEAN file: its calls from Sep 1, 2026
get their DRIVE time multiplied (1.15, 1.25, 1.6, or a drift of +2% per week). The generator raises the travel
estimate by the same factor and derives the drive from it, so scaling the drive is the same change up to rounding to
whole seconds (the 1.6 row is checked against the real closure file at the end). Dispatch and turnout are untouched.
For each scenario: the status over Sep 1 to Oct 15, and the replay from Aug 25 (fixed baseline, one more day each tick):
the first day the ZIP is out of control and the first day it stays so until the end.

The rule under test is the one in app/qc.py (p chart, exact binomial signal, two signals or a very strong one).
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app import data, qc                       # noqa: E402
from app.main import place_core                # noqa: E402

FIRST_DAY = date(2025, 10, 16)                 # first day of the files
LAST_DAY = date(2026, 10, 15)
BASELINE_DAYS = 60
CLOSURE_ZIP, CLOSURE_START = "11368", date(2026, 9, 1)


def windows(length, step):
    """Windows of `length` days ending Oct 15, 2026 and stepping back `step` days, each with a full 60-day baseline."""
    out, end = [], LAST_DAY
    while end - timedelta(days=length - 1) - timedelta(days=BASELINE_DAYS) >= FIRST_DAY:
        out.append((end - timedelta(days=length - 1), end))
        end -= timedelta(days=step)
    return out[::-1]


def county_statuses(df, group, frm, to):
    """{county_fips: place_core dict} for one window and one urgency group."""
    sel = data.select(df, "state", None, group, frm, to)
    sel_groups = {k: g for k, g in sel.groupby("county_fips", observed=True)}
    base = data.child_baselines(df, "state", None, group, frm, BASELINE_DAYS)
    out = {}
    for kid in data.children("state"):
        rows = sel_groups.get(kid["id"], sel.iloc[:0])
        b_rows, b_info = base[kid["id"]]
        out[kid["id"]] = place_core(qc, rows, b_rows, b_info)
    return out


def state_status(df, group, frm, to):
    rows = data.select(df, "state", None, group, frm, to)
    b_rows, b_info = data.baseline(df, "state", None, group, frm, BASELINE_DAYS)
    return place_core(qc, rows, b_rows, b_info)


def false_alarm_table(df):
    print("TABLE 1. FALSE ALARMS on the clean baseline file (every out_of_control here is a false alarm)")
    head = f"{'level':<7}{'urgency':<8}{'window':<8}{'step':<12}{'windows':>8}{'looks':>7}{'evaluable':>10}{'out':>5}{'watch':>6}{'out/looks':>10}{'out/evaluable':>14}"
    print(head)
    print("-" * len(head))
    plan = [("county", 90, 90, "non-overlap"), ("county", 180, 30, "overlap 30d"),
            ("state", 90, 30, "overlap 30d"), ("state", 180, 30, "overlap 30d")]
    for level, length, step, label in plan:
        for group in ("red", "yellow"):
            wins = windows(length, step)
            looks = evaluable = out = watch = 0
            for frm, to in wins:
                cores = (county_statuses(df, group, frm, to).values() if level == "county"
                         else [state_status(df, group, frm, to)])
                for core in cores:
                    looks += 1
                    evaluable += core["control"] != "insufficient_baseline"
                    out += core["control"] == "out_of_control"
                    watch += bool(core["watch"])
            print(f"{level:<7}{group:<8}{str(length) + ' d':<8}{label:<12}{len(wins):>8}{looks:>7}{evaluable:>10}{out:>5}{watch:>6}"
                  f"{100.0 * out / looks:>9.1f}%{(100.0 * out / evaluable if evaluable else float('nan')):>13.1f}%")
    print()


def scaled_zip(df, mult_for_date):
    """The closure ZIP's calls from the clean file, drive time multiplied by mult_for_date(call date) from Sep 1."""
    sub = df[df["zcta"] == CLOSURE_ZIP].copy()
    when = sub["date"].dt.date
    mult = np.array([mult_for_date(d) if d >= CLOSURE_START else 1.0 for d in when])
    sub["drive_s"] = np.where(sub["timed"], np.maximum(1, np.rint(sub["drive_s"] * mult)), sub["drive_s"])
    sub["total_s"] = sub["dispatch_s"] + sub["turnout_s"] + sub["drive_s"]
    sub["dispatch_to_scene_s"] = sub["turnout_s"] + sub["drive_s"]
    sub["late"] = (sub["timed"] & (sub["total_s"] > sub["target_s"])).to_numpy()
    sub["minutes"] = np.where(sub["timed"], sub["total_s"] / 60.0, np.nan)
    sub["ln_min"] = np.log(sub["minutes"])
    return sub


def zip_core(sub, frm, to):
    rows = data.select(sub, "zcta", CLOSURE_ZIP, "red", frm, to)
    b_rows, b_info = data.baseline(sub, "zcta", CLOSURE_ZIP, "red", frm, BASELINE_DAYS)
    return place_core(qc, rows, b_rows, b_info)


def replay_days(sub):
    """Daily status of the replay from Aug 25: (first out_of_control day, first day from which it stays so)."""
    day, states = date(2026, 8, 25), []
    while day <= LAST_DAY:
        states.append((day, zip_core(sub, date(2026, 8, 25), day)["control"] == "out_of_control"))
        day += timedelta(days=1)
    first = next((d for d, s in states if s), None)
    stays = None
    for i, (d, s) in enumerate(states):
        if all(x for _, x in states[i:]):
            stays = d
            break
    return first, stays


def detection_table(df):
    print(f"TABLE 2. DETECTION for ZIP {CLOSURE_ZIP}, red calls, change from {CLOSURE_START} (drive time scaled in the clean file)")
    head = f"{'scenario':<22}{'Sep1-Oct15':<16}{'on time %':>10}{'queue':>15}{'first OOC day':>15}{'OOC to the end from':>21}"
    print(head)
    print("-" * len(head))
    scenarios = [("no change (x1.00)", lambda d: 1.0), ("x1.15", lambda d: 1.15), ("x1.25", lambda d: 1.25),
                 ("x1.60 (the planted)", lambda d: 1.6),
                 ("drift +2% per week", lambda d: 1.0 + 0.02 * ((d - CLOSURE_START).days / 7.0))]
    for name, f in scenarios:
        sub = scaled_zip(df, f)
        core = zip_core(sub, CLOSURE_START, LAST_DAY)
        first, stays = replay_days(sub)
        print(f"{name:<22}{core['control']:<16}{core['on_time_pct']:>10}{core['queue']:>15}"
              f"{str(first):>15}{str(stays):>21}")
    print()


def check_against_closure_file():
    real = data.load("station_closure")
    rows = data.select(real, "zcta", CLOSURE_ZIP, "red", CLOSURE_START, LAST_DAY)
    b_rows, b_info = data.baseline(real, "zcta", CLOSURE_ZIP, "red", CLOSURE_START, BASELINE_DAYS)
    core = place_core(qc, rows, b_rows, b_info)
    first, stays = replay_days(real[real["zcta"] == CLOSURE_ZIP])
    print(f"CHECK, the real station_closure file for {CLOSURE_ZIP}: {core['control']}, {core['on_time_pct']}% on time, "
          f"first OOC day {first}, OOC to the end from {stays}")


def main():
    df = data.load("baseline")
    false_alarm_table(df)
    detection_table(df)
    check_against_closure_file()


if __name__ == "__main__":
    main()
