"""FastAPI app for the EMS Response Monitor (task H-04, role 3).

Thin layer: parse the filters, get the calls from app/data.py, hand numbers to app/qc.py,
return the JSON shapes of docs/api.md section B. No statistic is computed here; every
on-time interval, p chart, control status, queue label, percentile, I-MR, Cpk and ANOM
comes from app.qc.

Read-only: every route is a GET over the three SYNTHETIC files. There is no incident-entry
route; the replay feed plays the files back one simulated day at a time.
If app/qc.py is missing, health and meta still work and the statistics routes answer HTTP 503.
"""
from __future__ import annotations

import importlib
import math
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app import data

ROOT = Path(__file__).resolve().parent.parent
GEO_DIR = ROOT / "geo"
DIST_DIR = ROOT / "app" / "frontend" / "dist"
SOURCE = "Synthetic - simulated replay"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warm the cache in the background so the first request is fast.
    threading.Thread(target=lambda: [data.load(d) for d in data.DATASETS], daemon=True).start()
    yield


app = FastAPI(title="EMS Response Monitor API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- helpers

def get_qc():
    """Import app.qc when a route needs it; 503 if H-03 is not there yet."""
    try:
        return importlib.import_module("app.qc")
    except ImportError:
        raise HTTPException(503, "statistics module not ready (H-03)") from None


def num(x, nd=2):
    """JSON-safe number: None for NaN or inf, otherwise rounded."""
    if x is None:
        return None
    x = float(x)
    return round(x, nd) if math.isfinite(x) else None


def pct(part, whole):
    return round(100.0 * part / whole, 1) if whole else None


def minutes_list(values):
    return [num(v) for v in values]


def records(df: pd.DataFrame, cols: list[str]) -> list[dict]:
    """Rows as plain dicts for qc (NaN becomes None, bools stay bools)."""
    out = df[cols].astype(object).where(df[cols].notna(), None)
    return out.to_dict("records")


class Ctx:
    """One request's filters, validated, with the selection and baseline loaded on demand."""

    def __init__(self, dataset, from_, to, urgency, level, id, baseline_days):
        try:
            self.dataset = dataset
            self.df = data.load(dataset)
            self.level, self.id = level, id
            self.name = data.check_place(level, id)
            if level == "state":
                self.id = None
            self.groups = data.parse_groups(urgency)
            d_from, d_to = data.default_range(self.df)
            self.from_ = data.parse_date(from_) if from_ else d_from
            self.to = data.parse_date(to) if to else d_to
            if self.to < self.from_:
                raise ValueError("'to' is before 'from'")
            if baseline_days < 1:
                raise ValueError("baseline_days must be at least 1")
            self.baseline_days = baseline_days
            self._sel = self._base = self._info = None
        except (ValueError, FileNotFoundError) as e:
            raise HTTPException(400, str(e)) from None
        self.messages: list[str] = []

    @property
    def days(self) -> int:
        """Calendar days in the selection, both ends included."""
        return (self.to - self.from_).days + 1

    @property
    def sel(self) -> pd.DataFrame:
        if self._sel is None:
            self._sel = data.select(self.df, self.level, self.id, self.groups, self.from_, self.to)
        return self._sel

    @property
    def timed(self) -> pd.DataFrame:
        return self.sel[self.sel["timed"].to_numpy()]

    def _load_base(self):
        if self._base is None:
            self._base, self._info = data.baseline(self.df, self.level, self.id, self.groups,
                                                   self.from_, self.baseline_days)
            if self._info["stretched"]:
                self.messages.append(f"baseline stretched to {self._info['days']} days "
                                     "(under 30 timed calls in the first window)")
            if not self._info["enough"]:
                self.messages.append("not enough baseline calls (under 30 timed): limits are unreliable")
            if len(self.sel) == 0:
                self.messages.append("no calls in the selected range")

    @property
    def base(self) -> pd.DataFrame:
        self._load_base()
        return self._base

    @property
    def base_timed(self) -> pd.DataFrame:
        b = self.base
        return b[b["timed"].to_numpy()]

    @property
    def info(self) -> dict:
        self._load_base()
        return self._info

    def selection(self) -> dict:
        return {"dataset": self.dataset, "source": SOURCE, "level": self.level, "id": self.id, "name": self.name,
                "from": self.from_.isoformat(), "to": self.to.isoformat(), "urgency": self.groups,
                "baseline_from": self.info["from"].isoformat(), "baseline_to": self.info["to"].isoformat(),
                "baseline_days": self.info["days"]}

    def reply(self, body: dict, extra_messages=()) -> dict:
        msgs = list(self.messages) + [m for m in extra_messages if m]
        if len(self.groups) > 1:
            msgs.append("several urgency groups combined: the p chart mixes case mix; pick one group for SPC")
        return {"selection": self.selection(), **body, "messages": list(dict.fromkeys(msgs))}


def common(dataset: str = "baseline",
           from_: str | None = Query(None, alias="from"),
           to: str | None = None,
           urgency: str = "red",
           level: str = "state",
           id: str | None = None,
           baseline_days: int = 60) -> Ctx:
    return Ctx(dataset, from_, to, urgency, level, id, baseline_days)


USL_LN_RATIO = 0.0   # Cpk is on x = ln(total_s / target_s); late means x > 0, so USL = 0


def very_late_count(timed: pd.DataFrame) -> int:
    """Very late = total_s above twice the target."""
    return int((timed["total_s"] > 2 * timed["target_s"]).sum())


def pct_ci(ci):
    return [None if v is None else round(100.0 * v, 1) for v in ci]


def sig(x, digits=3):
    """JSON-safe number with `digits` significant figures (exact p-values span many powers of ten)."""
    if x is None or not math.isfinite(float(x)):
        return None
    return float(f"{float(x):.{digits}g}")


def spec_card(qc, timed: pd.DataFrame) -> dict:
    """A. Specification fields for one set of valid (timed) calls."""
    n = len(timed)
    late = int(timed["late"].sum())
    goal = data.weighted_goal(timed)
    s = qc.on_time(n, n - late, goal if goal is not None else 90.0)
    return {"valid": n, "on_time": n - late, "late": late,
            "on_time_pct": None if s["on_time_rate"] is None else round(100.0 * s["on_time_rate"], 1),
            "on_time_ci": pct_ci(s["ci"]), "goal_pct": None if s["goal"] is None else round(100.0 * s["goal"], 1),
            "spec": s["status"], "spec_reason": s["reason"]}


def control_card(qc, timed: pd.DataFrame, base_timed: pd.DataFrame, base_info: dict) -> dict:
    """B. Statistical control from the p chart.

    Steps: choose the subgroup unit from the whole baseline; split the baseline into subgroups; screen them
    (qc.baseline_screen drops unusual ones once and checks the rest are stable); draw the chart from the
    screened baseline; judge it with qc.control_status. `screen` is None when there is nothing to screen
    (not enough baseline calls, or no usable subgroup size).
    """
    base_n, base_late = len(base_timed), int(base_timed["late"].sum())
    raw_p_bar = base_late / base_n if base_n else None
    unit = qc.subgroup_unit(data.calls_per_day(base_info), raw_p_bar)
    points, run_signal, msgs = [], False, []
    screen, removed_starts = None, []
    p_bar, used_n, used_late = raw_p_bar, base_n, base_late
    if unit is not None and base_info["enough"]:
        bsg = data.subgroups(base_timed, unit)
        screen = qc.baseline_screen(bsg["n"], bsg["late"])
        msgs += screen["messages"]
        removed_starts = [bsg["start"][i] for i in screen["removed"]]
        used_n, used_late = sum(screen["n"]), sum(screen["late"])    # the baseline AFTER dropping unusual periods
        p_bar = screen["p_bar"]
        if used_n > 0:
            sg = data.subgroups(timed, unit)
            r = qc.p_chart(sg["n"], sg["late"], used_n, used_late)
            points = [{"start": st, **p, "p_value": sig(p["p_value"])} for st, p in zip(sg["start"], r["points"])]
            run_signal, msgs = r["run_signal"], msgs + r["messages"]
    ctl = qc.control_status(points, p_bar if p_bar is not None else raw_p_bar, base_info["enough"], unit, screen)
    return {"unit": unit, "p_bar": p_bar, "base_n": used_n, "base_late": used_late, "points": points,
            "run_signal": run_signal, "control": ctl["status"], "control_reason": ctl["reason"],
            "signals": ctl["signals"], "improvements": ctl["improvements"], "watch": ctl["watch"],
            "screen": screen, "removed_starts": removed_starts, "messages": msgs + ctl["messages"]}


def baseline_card(info: dict, ctl: dict | None = None) -> dict:
    """The baseline window plus what the stability screen found (checked False when nothing was screened)."""
    screen = (ctl or {}).get("screen")
    disp = (screen or {}).get("dispersion") or {"ratio": None, "p_value": None, "overdispersed": False}
    return {"from": info["from"].isoformat(), "to": info["to"].isoformat(), "days": info["days"],
            "valid": info["timed"], "stretched": info["stretched"], "enough": info["enough"],
            "p_bar": num((ctl or {}).get("p_bar"), 4),
            "checked": bool(screen and screen["checked"]), "stable": bool(screen["stable"]) if screen else True,
            "reasons": list(screen["reasons"]) if screen else [],
            "removed": len(screen["removed"]) if screen else 0,
            "removed_starts": list((ctl or {}).get("removed_starts") or []),
            "dispersion": {"ratio": num(disp["ratio"], 3), "p_value": sig(disp["p_value"]),
                           "overdispersed": bool(disp["overdispersed"])}}


def area_mix(timed: pd.DataFrame) -> dict | None:
    """Share of valid calls (percent) from urban, suburban, rural and remote ZIP areas; None with no valid calls."""
    if not len(timed):
        return None
    counts = timed["urban_rural"].value_counts()
    return {t: num(100 * int(counts.get(t, 0)) / len(timed), 1) for t in data.AREA_TYPES}


def place_core(qc, rows: pd.DataFrame, base_rows: pd.DataFrame, base_info: dict) -> dict:
    """A, B and the queue label of one place (no percentiles): enough for the statewide flagged list."""
    sel_t = split_timed(rows)
    card = spec_card(qc, sel_t)
    ctl = control_card(qc, sel_t, split_timed(base_rows), base_info)
    card.update(control=ctl["control"], control_reason=ctl["control_reason"], watch=bool(ctl["watch"]),
                unit=ctl["unit"], signals=ctl["signals"], baseline=baseline_card(base_info, ctl))
    card["queue"] = qc.queue_label(card["spec"], card["control"])
    card["excess_late"] = num(qc.excess_late(card["valid"], card["late"], card["goal_pct"]), 1)
    return card


def volume_fields(rows: pd.DataFrame, valid: int, base_rows: pd.DataFrame, base_info: dict, days: int) -> dict:
    """Call counts that are not time statistics: cancelled, invalid (untimed, not cancelled), calls per day."""
    cancelled = int(rows["cancelled"].sum())
    return {"cancelled": cancelled, "invalid": len(rows) - cancelled - valid, "cancel_pct": pct(cancelled, len(rows)),
            "calls_per_day": num(len(rows) / days, 2),
            "base_calls_per_day": num(len(base_rows) / base_info["days"], 2) if base_info["days"] else None}


def percentile_fields(pc: dict) -> dict:
    """JSON keys for qc.percentiles(); any interval bound may be None (too few calls)."""
    return {"median_min": num(pc["median"]), "median_ci": minutes_list(pc["median_ci"]), "p90_min": num(pc["p90"]),
            "p95_min": num(pc["p95"]), "p95_ci": minutes_list(pc["p95_ci"])}


def place_card(qc, rows, base_rows, base_info, days) -> dict:
    """Every number of one place's row: A, B, the queue label, volumes, percentiles, Cpk (secondary)."""
    sel_t = split_timed(rows)
    card = {"calls": len(rows), **place_core(qc, rows, base_rows, base_info), "very_late": very_late_count(sel_t)}
    card.update(volume_fields(rows, card["valid"], base_rows, base_info, days))
    card.update(percentile_fields(qc.percentiles(sel_t["minutes"].tolist())))
    card["response_profile"] = qc.response_profile(sel_t["minutes"].tolist(), (sel_t["target_s"] / 60).tolist())
    card["area_mix"] = area_mix(sel_t)
    card.update(cpk=None, cpk_upper=None)
    if len(sel_t) >= data.MIN_CALLS:
        # Secondary and assumption-dependent (lognormal times): Cpk never sets the queue label.
        cap = qc.capability(sel_t["ln_ratio"].tolist(), USL_LN_RATIO, data.weighted_goal(sel_t))
        card["cpk"], card["cpk_upper"] = num(cap["cpk"], 3), num(cap["upper"], 3)
    return card


def split_timed(rows: pd.DataFrame) -> pd.DataFrame:
    return rows[rows["timed"].to_numpy()]


# ---------------------------------------------------------------- health, meta

@app.get("/api/health")
def health():
    names = list(data.DATASETS)
    return {"status": "ok", "source": SOURCE, "datasets": names, "rows": {d: len(data.load(d)) for d in names},
            "quality": {d: data.quality(d) for d in names}}


@app.get("/api/meta")
def meta():
    lk = data.lookups()
    ranges = [data.date_range(data.load(d)) for d in data.DATASETS]
    counties = lk["counties"].sort_values("county_name")
    d_from, d_to = data.default_range(data.load(data.DATASETS[0]))
    return {
        "source": SOURCE,
        "datasets": list(data.DATASETS),
        "date_min": min(r[0] for r in ranges).isoformat(),
        "date_max": max(r[1] for r in ranges).isoformat(),
        "default_from": d_from.isoformat(), "default_to": d_to.isoformat(),
        "counties": [{"county_fips": f, "county_name": n}
                     for f, n in zip(counties["county_fips"], counties["county_name"])],
        "targets": records(lk["targets"], list(lk["targets"].columns)),
    }


# ---------------------------------------------------------------- statistics routes

def chance_below_card(qc, places: list[dict], goal_pct) -> dict:
    """How many places would read "Below target" by chance alone, beside how many do (qc.chance_below)."""
    cb = qc.chance_below([p["valid"] for p in places], goal_pct)
    return {"expected": num(cb["expected"], 2), "n_places": cb["n_places"],
            "observed_below": sum(p["spec"] == "below" for p in places), "messages": cb["messages"]}


@app.get("/api/summary")
def summary(c: Ctx = Depends(common)):
    qc = get_qc()
    sel_t = c.timed
    place = place_card(qc, c.sel, c.base, c.info, c.days)          # the selected place itself
    totals = {"calls": len(c.sel), **spec_card(qc, sel_t), "very_late": very_late_count(sel_t),
              **volume_fields(c.sel, len(sel_t), c.base, c.info, c.days), "excess_late": place["excess_late"]}
    pc = qc.percentiles(sel_t["minutes"].tolist())
    totals.update(percentile_fields(pc), spread_min=num(pc["spread"]))
    d2s = qc.percentiles((sel_t["dispatch_to_scene_s"] / 60.0).tolist())
    totals.update(median_dispatch_to_scene_min=num(d2s["median"]), p95_dispatch_to_scene_min=num(d2s["p95"]),
                  p95_dispatch_to_scene_ci=minutes_list(d2s["p95_ci"]))

    key = data.child_key(c.level)
    sel_groups = {k: g for k, g in c.sel.groupby(key, observed=True)}
    base_groups = data.child_baselines(c.df, c.level, c.id, c.groups, c.from_, c.baseline_days)
    places = []
    for kid in data.children(c.level, c.id):
        rows = sel_groups.get(kid["id"], c.sel.iloc[:0])
        b_rows, b_info = base_groups[kid["id"]]
        places.append({"id": kid["id"], "name": kid["name"], **place_card(qc, rows, b_rows, b_info, c.days)})

    per_county = data.select(c.df, "state", None, c.groups, c.from_, c.to)["county_fips"].value_counts()
    names = data.lookups()["county_names"]
    calls_by_county = [{"county_fips": f, "name": names[f], "calls": int(per_county.get(f, 0))}
                       for f in sorted(names)]
    counts = {q: sum(p["queue"] == q for p in places) for q in qc.QUEUE}
    attention = counts["act_now"] + counts["ongoing_gap"] + counts["recent_change"]
    return c.reply({"totals": totals, "place": place, "queue_counts": counts, "needs_attention": int(attention),
                    "chance_below": chance_below_card(qc, places, totals["goal_pct"]),
                    "places": places, "calls_by_county": calls_by_county}, pc["messages"])


@app.get("/api/flagged")
def flagged(c: Ctx = Depends(common)):
    """Every ZIP area in the state with 30 or more valid calls whose queue label is Act now or Recent change.

    Statewide: the selected level and id are ignored, so a bad ZIP inside a county that looks fine is still listed.
    No percentiles here, to keep it fast. Sorted: Act now first, then by late calls beyond what the goal allows.
    """
    qc = get_qc()
    lk = data.lookups()
    sel = data.select(c.df, "state", None, c.groups, c.from_, c.to)
    sel_groups = {k: g for k, g in sel.groupby("zcta", observed=True)}
    base_groups = data.child_baselines(c.df, "state", None, c.groups, c.from_, c.baseline_days,
                                       key="zcta", ids=data.all_zctas())
    checked, hits = [], []
    for zcta, rows in sel_groups.items():
        if int(rows["timed"].sum()) < data.MIN_CALLS:
            continue
        b_rows, b_info = base_groups[zcta]
        card = place_core(qc, rows, b_rows, b_info)
        checked.append(card)
        if card["queue"] in ("act_now", "recent_change"):
            fips = lk["zcta_to_county"][zcta]
            hits.append({"id": zcta, "county_fips": fips, "county": lk["county_names"][fips], "calls": len(rows),
                         **{k: card[k] for k in ("valid", "on_time_pct", "on_time_ci", "goal_pct", "spec", "control",
                                                 "watch", "queue", "signals", "excess_late")}})
    hits.sort(key=lambda h: (h["queue"] != "act_now", -(h["excess_late"] or 0.0), h["id"]))
    goal = data.weighted_goal(c.timed) if len(c.timed) else 90.0
    return c.reply({"scope": "statewide", "n_checked": len(checked), "n_flagged": len(hits), "flagged": hits,
                    "chance_below": chance_below_card(qc, checked, goal)})


def stage_block(b: dict) -> dict:
    return {"dispatch_s": num(b["dispatch_s"], 0), "turnout_s": num(b["turnout_s"], 0),
            "drive_s": num(b["drive_s"], 0), "held_pct": num(b["held_pct"], 1), "n": b["n"]}


@app.get("/api/stages")
def stages(c: Ctx = Depends(common)):
    """Plain stage medians for the selected place: the period beside its own baseline. Descriptive, no cause."""
    qc = get_qc()

    def columns(t: pd.DataFrame) -> dict:
        return {k: t[k].tolist() for k in ("dispatch_s", "turnout_s", "drive_s", "held")}

    r = qc.stage_summary(columns(c.timed), columns(c.base_timed))
    return c.reply({"now": stage_block(r["now"]), "base": stage_block(r["base"])}, r["messages"])


@app.get("/api/signal_calls")
def signal_calls(start: str | None = None, end: str | None = None, limit: int = Query(50, ge=1, le=500),
                 c: Ctx = Depends(common)):
    """The valid (timed) calls behind a signal: the selected place and urgency, received in [start, end], newest first."""
    try:
        d0 = data.parse_date(start) if start else c.from_
        d1 = data.parse_date(end) if end else c.to
        timed = split_timed(data.select(c.df, c.level, c.id, c.groups, d0, d1))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    calls = [{"incident_id": r.incident_id, "t_received": r.t_received.isoformat(), "zcta": str(r.zcta),
              "total_s": num(r.total_s, 0), "late": bool(r.late), "dispatch_s": num(r.dispatch_s, 0),
              "turnout_s": num(r.turnout_s, 0), "drive_s": num(r.drive_s, 0), "held": bool(r.held)}
             for r in timed.iloc[::-1].head(limit).itertuples()]
    return c.reply({"start": d0.isoformat(), "end": d1.isoformat(), "valid": len(timed),
                    "late": int(timed["late"].sum()), "returned": len(calls), "calls": calls})


@app.get("/api/anom")
def anom(c: Ctx = Depends(common)):
    qc = get_qc()
    blank = {"grand_mean_min": None, "reference": None, "h": None, "k": 0, "N": None, "F": None, "df1": None, "df2": None, "places": []}
    note = ("descriptive comparison within one urgency group; not adjusted for time of day, traffic, "
            "call mix or resources, so it is not evidence of unfair service")
    if len(c.groups) != 1:
        return c.reply(blank, ["ANOM compares places within ONE urgency group: select a single group"])
    key = data.child_key(c.level)
    names = {k["id"]: k["name"] for k in data.children(c.level, c.id)}
    all_groups = {k: g["ln_min"].tolist() for k, g in c.timed.groupby(key, observed=True)}
    groups = {k: v for k, v in all_groups.items() if len(v) >= data.MIN_CALLS}
    left_out = len(all_groups) - len(groups)
    msgs = [note] + ([f"{left_out} place(s) with under {data.MIN_CALLS} valid calls left out of ANOM"] if left_out else [])
    if len(groups) < 2:
        return c.reply({**blank, "k": len(groups)}, msgs + ["ANOM needs at least 2 places with 30 or more valid calls"])
    r = qc.anom(groups)
    places = []
    for pid, g in r["groups"].items():
        places.append({"id": pid, "name": names.get(pid, pid), "n": g["n"],
                       "mean_min": num(math.exp(g["mean"])),
                       "ci_min": [num(math.exp(v)) for v in g["ci"]],
                       "lower_min": num(math.exp(g["lower"])), "upper_min": num(math.exp(g["upper"])),
                       "verdict": g["verdict"]})
    return c.reply({"grand_mean_min": num(math.exp(r["grand_mean"])), "reference": r.get("reference"), "h": num(r["h"], 4), "k": r["k"],
                    "N": r["N"], "F": num(r["F"], 3), "df1": r["df1"], "df2": r["df2"],
                    "places": places}, r.get("messages", []) + msgs)


@app.get("/api/pchart")
def pchart(c: Ctx = Depends(common)):
    qc = get_qc()
    ctl = control_card(qc, c.timed, c.base_timed, c.info)
    msgs = list(ctl["messages"])
    dispersion = None
    if ctl["unit"] is None:
        msgs.append("low volume: too few late calls per month in the baseline, no chart marks")
    elif ctl["screen"] is not None:
        # on the baseline periods that were KEPT by the screen: these are the ones that set the limits
        d = qc.dispersion_check(ctl["screen"]["n"], ctl["screen"]["late"])
        dispersion = {"m": d["m"], "ratio": num(d["ratio"], 3), "p_value": sig(d["p_value"]),
                      "overdispersed": d["overdispersed"]}
        msgs += d["messages"]
    return c.reply({"unit": ctl["unit"], "p_bar": num(ctl["p_bar"], 4), "base_n": ctl["base_n"],
                    "base_late": ctl["base_late"], "baseline": baseline_card(c.info, ctl), "points": ctl["points"],
                    "run_signal": ctl["run_signal"], "control": ctl["control"], "control_reason": ctl["control_reason"],
                    "watch": bool(ctl["watch"]), "signals": ctl["signals"], "improvements": ctl["improvements"],
                    "dispersion": dispersion}, msgs)


@app.get("/api/imr")
def imr(c: Ctx = Depends(common)):
    """Secondary: individual calls on a log scale. Only Shewhart test 1 (beyond 3 sigma) is used."""
    qc = get_qc()
    t, b = c.timed, c.base_timed
    r = qc.imr(t["ln_min"].tolist(), b["ln_min"].tolist())
    checks = qc.assumption_checks(b["ln_min"].tolist())
    ids, rec = t["incident_id"].tolist(), [ts.isoformat() for ts in t["t_received"]]
    mins, lns = t["minutes"].tolist(), t["ln_min"].tolist()
    points = [{"incident_id": ids[i], "t_received": rec[i], "minutes": num(mins[i]), "ln_min": num(lns[i], 4),
               "mr": p.get("mr"), "beyond_3_sigma": 1 in p.get("tests", [])} for i, p in enumerate(r["points"])]
    ex = lambda v: num(math.exp(v)) if v is not None and math.isfinite(v) else None
    return c.reply({"cl_min": ex(r["cl"]), "ucl_min": ex(r["ucl"]), "lcl_min": ex(r["lcl"]),
                    "mr_ucl": r["mr_ucl"], "points": points,
                    "n_beyond": sum(p["beyond_3_sigma"] for p in points),
                    "assumptions": {"n": checks["n"], "skew": num(checks["skew"], 3), "lag1": num(checks["lag1"], 3)},
                    "before_median_min": num(b["minutes"].median()) if len(b) else None,
                    "after_median_min": num(t["minutes"].median()) if len(t) else None},
                   r.get("messages", []) + checks["messages"]
                   + ["secondary chart: only test 1 (a call beyond 3 sigma on the log scale) is marked; "
                      "other Nelson rules are not used because their false-alarm rate was not validated"])


@app.get("/api/replay")
def replay(day: str | None = None, limit: int = Query(25, ge=1, le=200), c: Ctx = Depends(common)):
    """Read-only simulated stream: the calls the synthetic file holds for one day, newest first."""
    try:
        d = data.parse_date(day) if day else c.to
        rows = data.day_events(c.df, c.level, c.id, c.groups, d)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    timed = split_timed(rows)
    names = data.lookups()["county_names"]
    recent = rows.iloc[::-1].head(limit)
    events = [{"incident_id": r.incident_id, "t_received": r.t_received.isoformat(), "zcta": str(r.zcta),
               "county": names.get(str(r.county_fips), ""), "urgency_group": str(r.urgency_group),
               "disposition": r.disposition, "valid": bool(r.timed),
               "total_s": num(r.total_s, 0) if r.timed else None, "late": bool(r.late),
               "held": bool(r.held)} for r in recent.itertuples()]
    return c.reply({"source": SOURCE, "day": d.isoformat(), "received": len(rows), "valid": len(timed),
                    "late": int(timed["late"].sum()), "cancelled": int((rows["disposition"] == "CANCELLED").sum()),
                    "events": events})


# ---------------------------------------------------------------- errors, static files

@app.exception_handler(ValueError)
async def value_error_handler(request, exc):
    return JSONResponse({"detail": str(exc)}, status_code=400)


if GEO_DIR.is_dir():
    app.mount("/geo", StaticFiles(directory=GEO_DIR), name="geo")

if DIST_DIR.is_dir():
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="frontend")
else:
    @app.get("/")
    def root():
        return {"message": "EMS Response Monitor API. Try /api/health, /api/meta, /docs."}
