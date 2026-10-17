"""Data layer for the EMS Response Monitor (task H-04, role 3).

This file only HANDLES data. There are no statistics here (those live in app/qc.py).
It is read-only: the three synthetic files are the only incident source (no user logging).
It does five jobs:

1. load  : read data/incidents_<dataset>.csv.gz once, cache it.
2. derive: add the per-call fields defined in docs/api.md "Shared definitions".
3. select: the calls of one place, one urgency set, one date range.
4. baseline: the same place and urgency, the days BEFORE the range (60, stretched to 120).
5. children / subgroups: the place list for the map, and the per-day or per-week counts.

Everything is vectorised pandas (no per-row Python loops) so a request stays well under 2 s.
Durations use real elapsed seconds, so the daylight-saving jump cannot create fake delays.
"""
from __future__ import annotations

import threading
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
TARGETS_CSV = ROOT / "config" / "targets.csv"
ZCTA_CSV = DATA_DIR / "lookup" / "zcta_county.csv"
COUNTIES_CSV = DATA_DIR / "lookup" / "counties.csv"

DATASETS = ("baseline", "station_closure", "summer_surge")
LEVELS = ("state", "county", "zcta")
GROUPS = ("red", "yellow", "green")
AREA_TYPES = ("urban", "suburban", "rural", "remote")
TZ = "America/New_York"

MIN_CALLS = 30          # fewer timed calls than this: the place is "not enough"
STRETCH_DAYS = 120      # baseline is stretched to this when the first window has < MIN_CALLS
STATE_NAME = "New York State"

TIME_COLUMNS = ["t_received", "t_assigned", "t_enroute", "t_onscene"]
REQUIRED_COLUMNS = ["incident_id", "zcta", "urgency_code", "t_received", "t_assigned",
                    "t_enroute", "disposition", "valid_time"]
EPOCH_DAY = pd.Timestamp("1970-01-01")


# ---------------------------------------------------------------- lookups

_lookups_cache: dict = {}


def read_targets(path: Path = TARGETS_CSV) -> pd.DataFrame:
    """config/targets.csv: one row per (urgency_code, urban_rural). Fails loudly on a missing file or a malformed table."""
    t = pd.read_csv(path)
    need = {"urgency_code", "urban_rural", "urgency_group", "target_s", "goal_on_time_pct"}
    if not need.issubset(t.columns):
        raise ValueError(f"{path} must have columns {sorted(need)}")
    if t.duplicated(["urgency_code", "urban_rural"]).any():
        raise ValueError(f"{path} has a duplicated (urgency_code, urban_rural) pair")
    return t


def lookups() -> dict:
    """targets, zcta -> county map, county names. Read once."""
    if not _lookups_cache:
        zc = pd.read_csv(ZCTA_CSV, dtype={"zcta": str, "county_fips": str})
        co = pd.read_csv(COUNTIES_CSV, dtype={"county_fips": str})
        _lookups_cache.update(
            targets=read_targets(),
            zcta_county=zc,
            counties=co,
            zcta_to_county=dict(zip(zc["zcta"], zc["county_fips"])),
            zcta_to_area=dict(zip(zc["zcta"], zc["urban_rural"])),
            county_names=dict(zip(co["county_fips"], co["county_name"])),
        )
    return _lookups_cache


# ---------------------------------------------------------------- derive

def derive(raw: pd.DataFrame, targets: pd.DataFrame | None = None,
           zcta_to_county: dict | None = None,
           zcta_to_area: dict | None = None) -> pd.DataFrame:
    """Add every derived field of docs/api.md to a raw incidents table.

    `raw` has the incidents.csv columns (times as ISO 8601 text with the New York offset).
    Returns a new table sorted by t_received.
    """
    lk = lookups() if (targets is None or zcta_to_county is None or zcta_to_area is None) else None
    targets = lk["targets"] if targets is None else targets
    zcta_to_county = lk["zcta_to_county"] if zcta_to_county is None else zcta_to_county
    zcta_to_area = lk["zcta_to_area"] if zcta_to_area is None else zcta_to_area

    missing = [c for c in REQUIRED_COLUMNS if c not in raw.columns]
    if missing:
        raise ValueError(f"missing required columns: {missing}")

    df = pd.DataFrame({
        "incident_id": raw["incident_id"].astype(str).to_numpy(),
        "zcta": raw["zcta"].astype(str).str.zfill(5).to_numpy(),
        "urgency_code": pd.to_numeric(raw["urgency_code"]).astype("int64").to_numpy(),
        "disposition": raw["disposition"].astype(str).to_numpy(),
        "valid_time": raw["valid_time"].astype(str).to_numpy(),
    })
    n = len(df)
    df["eta_google_s"] = (pd.to_numeric(raw["eta_google_s"], errors="coerce").to_numpy(dtype=float)
                          if "eta_google_s" in raw.columns else np.full(n, np.nan))
    df["held"] = (raw["held"].astype(str).to_numpy() == "Y") if "held" in raw.columns else np.zeros(n, bool)

    # Times: parse with the offset, then work in seconds since the epoch (UTC).
    # Real elapsed seconds, so 1:59 AM to 3:01 AM on the spring-forward night is 120 s, not 3720 s.
    secs = {}
    for c in TIME_COLUMNS:
        if c in raw.columns:
            ts = pd.to_datetime(raw[c], utc=True, format="ISO8601")
        else:
            ts = pd.Series(pd.NaT, index=raw.index, dtype="datetime64[s, UTC]")
        secs[c] = (ts - pd.Timestamp(0, tz="UTC")).dt.total_seconds().to_numpy(dtype=float)
        if c == "t_received":
            received = ts
    if np.isnan(secs["t_received"]).any():
        raise ValueError("t_received is empty in some rows")

    local = received.dt.tz_convert(TZ)
    df["t_received"] = pd.Series(local.array)                  # tz-aware New York clock time
    day_ts = local.dt.tz_localize(None).dt.normalize()         # the New York calendar date
    df["date"] = day_ts.to_numpy()
    df["day"] = ((day_ts - EPOCH_DAY).dt.days).to_numpy(dtype="int64")

    df["dispatch_s"] = secs["t_assigned"] - secs["t_received"]
    df["turnout_s"] = secs["t_enroute"] - secs["t_assigned"]
    df["drive_s"] = secs["t_onscene"] - secs["t_enroute"]
    df["dispatch_to_scene_s"] = secs["t_onscene"] - secs["t_assigned"]
    df["total_s"] = secs["t_onscene"] - secs["t_received"]

    # Timed call: not cancelled, has t_onscene, valid_time = Y, and the times are in order.
    in_order = ((df["dispatch_s"] >= 0) & (df["turnout_s"] >= 0)
                & (df["drive_s"] >= 0) & (df["total_s"] > 0))
    df["timed"] = ((df["disposition"] != "CANCELLED") & df["total_s"].notna()
                   & (df["valid_time"] == "Y") & in_order).to_numpy()
    df["minutes"] = np.where(df["timed"], df["total_s"] / 60.0, np.nan)
    df["ln_min"] = np.log(df["minutes"])  # NaN stays NaN; minutes > 0 whenever timed

    # Place (zcta -> county, area type) and targets (per urgency code AND area type).
    df["county_fips"] = pd.Categorical(df["zcta"].map(zcta_to_county))
    area = df["zcta"].map(zcta_to_area)
    df["urban_rural"] = pd.Categorical(area, categories=list(AREA_TYPES))
    t = targets.set_index(["urgency_code", "urban_rural"])
    keys = pd.MultiIndex.from_arrays([df["urgency_code"], area])
    missing_keys = sorted({k for k in keys[t.index.get_indexer(keys) < 0] if not pd.isna(k[1])})
    if missing_keys or area.isna().any():
        codes = sorted(set(df["urgency_code"]) - set(targets["urgency_code"]))
        raise ValueError(f"urgency_code / area type not in config/targets.csv: {codes or missing_keys}; "
                         "also check every zcta is in data/lookup/zcta_county.csv")
    pos = t.index.get_indexer(keys)
    df["urgency_group"] = pd.Categorical(t["urgency_group"].to_numpy()[pos], categories=list(GROUPS))
    df["target_s"] = t["target_s"].to_numpy(dtype=float)[pos]
    df["goal_on_time_pct"] = t["goal_on_time_pct"].to_numpy(dtype=float)[pos]
    df["late"] = (df["timed"] & (df["total_s"] > df["target_s"])).to_numpy()
    # Cpk input: ln(total_s / target_s) for timed calls; USL = 0 (late means above 0).
    df["ln_ratio"] = np.where(df["timed"], np.log(df["total_s"] / df["target_s"]), np.nan)
    df["zcta"] = pd.Categorical(df["zcta"])

    df = df.sort_values("t_received", kind="stable").reset_index(drop=True)
    return df


# ---------------------------------------------------------------- load and cache

_cache: dict[str, pd.DataFrame] = {}
_lock = threading.Lock()


def load(dataset: str) -> pd.DataFrame:
    """The derived table for one dataset. Read and derived once, then cached."""
    if dataset not in DATASETS:
        raise ValueError(f"unknown dataset '{dataset}'; use one of {list(DATASETS)}")
    with _lock:
        if dataset not in _cache:
            path = DATA_DIR / f"incidents_{dataset}.csv.gz"
            raw = pd.read_csv(path, dtype={"incident_id": str, "zcta": str})
            _cache[dataset] = derive(raw)
    return _cache[dataset]


def date_range(df: pd.DataFrame) -> tuple[date, date]:
    """First and last New York calendar date in a table."""
    if len(df) == 0:
        raise ValueError("no calls")
    return (EPOCH_DAY + pd.Timedelta(days=int(df["day"].iloc[0]))).date(), \
           (EPOCH_DAY + pd.Timedelta(days=int(df["day"].iloc[-1]))).date()


DEFAULT_DAYS = 90       # default selection length (team decision Oct 16: fewer "insufficient data" places)


def default_range(df: pd.DataFrame) -> tuple[date, date]:
    """Default selection: the dataset's last 90 days (Jul 18 to Oct 15, 2026)."""
    last = date_range(df)[1]
    return last - timedelta(days=DEFAULT_DAYS - 1), last


# ---------------------------------------------------------------- places

def check_place(level: str, id: str | None) -> str:
    """Validate level and id; return the place name. Raises ValueError (HTTP 400)."""
    if level not in LEVELS:
        raise ValueError(f"unknown level '{level}'; use one of {list(LEVELS)}")
    lk = lookups()
    if level == "state":
        return STATE_NAME
    if not id:
        raise ValueError(f"level={level} needs an id")
    if level == "county":
        if id not in lk["county_names"]:
            raise ValueError(f"unknown county id '{id}'")
        return lk["county_names"][id]
    if id not in lk["zcta_to_county"]:
        raise ValueError(f"unknown zcta id '{id}'")
    return id


def parse_groups(urgency: str | list | None) -> list[str]:
    """'red,yellow' -> ['red', 'yellow']; an empty value means red."""
    if urgency is None or urgency == "":
        return ["red"]
    parts = urgency.split(",") if isinstance(urgency, str) else list(urgency)
    groups = [p.strip().lower() for p in parts if p.strip()]
    bad = [g for g in groups if g not in GROUPS]
    if bad or not groups:
        raise ValueError(f"unknown urgency {bad or urgency}; use red, yellow, green")
    return [g for g in GROUPS if g in groups]


def parse_date(value) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        raise ValueError(f"bad date '{value}'; use YYYY-MM-DD") from None


def children(level: str, id: str | None = None) -> list[dict]:
    """The places listed under the selected place: [{id, name}]."""
    name = check_place(level, id)
    lk = lookups()
    if level == "state":
        co = lk["counties"].sort_values("county_name")
        return [{"id": f, "name": n} for f, n in zip(co["county_fips"], co["county_name"])]
    if level == "county":
        z = lk["zcta_county"]
        return [{"id": zc, "name": zc} for zc in sorted(z.loc[z["county_fips"] == id, "zcta"])]
    return [{"id": id, "name": name}]


def child_key(level: str) -> str:
    """The column that identifies a child place."""
    return "county_fips" if level == "state" else "zcta"


# ---------------------------------------------------------------- select and baseline

def _days(d: date) -> int:
    return (d - date(1970, 1, 1)).days


def _slice_days(df: pd.DataFrame, d_from: date, d_to: date) -> pd.DataFrame:
    """Rows with d_from <= date <= d_to. The table is sorted by day, so two searches are enough."""
    days = df["day"].to_numpy()
    lo = int(np.searchsorted(days, _days(d_from), side="left"))
    hi = int(np.searchsorted(days, _days(d_to), side="right"))
    return df.iloc[lo:hi]


def select(df: pd.DataFrame, level: str, id: str | None, urgency, from_, to) -> pd.DataFrame:
    """All calls (timed and untimed) in [from_, to], in the urgency groups, inside the place.

    An empty selection returns a table with zero rows, never an error.
    """
    check_place(level, id)
    d_from, d_to = parse_date(from_), parse_date(to)
    if d_to < d_from:
        raise ValueError("'to' is before 'from'")
    rows = _slice_days(df, d_from, d_to)
    mask = rows["urgency_group"].isin(parse_groups(urgency)).to_numpy()
    if level == "county":
        mask = mask & (rows["county_fips"] == id).to_numpy()
    elif level == "zcta":
        mask = mask & (rows["zcta"] == id).to_numpy()
    return rows[mask]


def baseline_window(from_, days: int) -> tuple[date, date]:
    """The `days` days before `from_`: from 2026-09-16 and 60 days is 2026-07-18 to 2026-09-15."""
    d_from = parse_date(from_)
    return d_from - timedelta(days=days), d_from - timedelta(days=1)


def baseline(df: pd.DataFrame, level: str, id: str | None, urgency, from_,
             baseline_days: int = 60) -> tuple[pd.DataFrame, dict]:
    """The baseline calls and a description of the window used.

    Starts with `baseline_days` (default 60). If that has fewer than 30 timed calls, uses 120 days.
    If it is still under 30, `info["enough"]` is False (the place is "not enough").
    """
    if baseline_days < 1:
        raise ValueError("baseline_days must be at least 1")
    days, stretched = baseline_days, False
    while True:
        start, end = baseline_window(from_, days)
        rows = select(df, level, id, urgency, start, end)
        timed = int(rows["timed"].sum())
        if timed >= MIN_CALLS or days >= STRETCH_DAYS:
            break
        days, stretched = STRETCH_DAYS, True
    info = {"from": start, "to": end, "days": days, "timed": timed,
            "stretched": stretched, "enough": timed >= MIN_CALLS}
    return rows, info


def child_baselines(df: pd.DataFrame, level: str, id: str | None, urgency, from_,
                    baseline_days: int = 60) -> dict:
    """Baseline for every child place at once: {child_id: (rows, info)}.

    Same 60 -> 120 day rule as `baseline`, but one filter and one group-by for all the
    children instead of one filter per child. Children with no baseline calls get an empty table.
    """
    key = child_key(level)
    out = {}
    windows = [baseline_days] if baseline_days >= STRETCH_DAYS else [baseline_days, STRETCH_DAYS]
    parts = []
    for days in windows:
        start, end = baseline_window(from_, days)
        rows = select(df, level, id, urgency, start, end)
        parts.append((days, start, end, {k: g for k, g in rows.groupby(key, observed=True)}, rows.iloc[:0]))
    for child in children(level, id):
        cid = child["id"]
        for i, (days, start, end, groups, empty) in enumerate(parts):
            rows = groups.get(cid, empty)
            timed = int(rows["timed"].sum())
            if timed >= MIN_CALLS or i == len(parts) - 1:
                out[cid] = (rows, {"from": start, "to": end, "days": days, "timed": timed,
                                   "stretched": i > 0, "enough": timed >= MIN_CALLS})
                break
    return out


def calls_per_day(info: dict) -> float:
    """Mean timed calls per day in a baseline window (input of qc.subgroup_unit)."""
    return info["timed"] / info["days"] if info["days"] else 0.0


# ---------------------------------------------------------------- subgroups and small summaries

def subgroups(timed: pd.DataFrame, unit: str) -> dict:
    """Timed calls per subgroup, in time order: {start: [dates], n: [...], late: [...]}.

    unit "day": one subgroup per New York calendar day.
    unit "week": one per ISO week (Monday start). unit "month": one per calendar month. Subgroups with no timed call are left out.
    """
    if unit not in ("day", "week", "month"):
        raise ValueError("unit must be 'day', 'week' or 'month'")
    if len(timed) == 0:
        return {"start": [], "n": [], "late": []}
    t = timed[timed["timed"]]
    if unit == "day":
        key = t["day"]
    elif unit == "week":
        key = t["day"] - ((t["day"] + 3) % 7)  # 1970-01-01 was a Thursday
    else:  # calendar month: first day of the month, as a day number
        key = pd.Series(t["date"].to_numpy().astype("datetime64[M]").astype("datetime64[D]").astype("int64"),
                        index=t.index)
    g = t.groupby(key.to_numpy()).agg(n=("late", "size"), late=("late", "sum"))
    starts = [(date(1970, 1, 1) + timedelta(days=int(k))).isoformat() for k in g.index]
    return {"start": starts, "n": [int(v) for v in g["n"]], "late": [int(v) for v in g["late"]]}


def weighted_goal(timed: pd.DataFrame) -> float | None:
    """Call-weighted goal %: the mean of goal_on_time_pct over the timed calls (None if none)."""
    if len(timed) == 0:
        return None
    return float(timed["goal_on_time_pct"].mean())


# ---------------------------------------------------------------- replay (read-only simulated stream)

def day_events(df: pd.DataFrame, level: str, id: str | None, urgency, day) -> pd.DataFrame:
    """Every call received on one New York calendar day in the place and urgency groups, in time order.

    The replay feed plays the synthetic file back one simulated day at a time; nothing is written.
    """
    d = parse_date(day)
    return select(df, level, id, urgency, d, d)
