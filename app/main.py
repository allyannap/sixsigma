"""FastAPI app for the EMS Response Monitor (task H-04, role 3).

Thin layer: parse the filters, get the calls from app/data.py, hand numbers to app/qc.py,
return the JSON shapes of docs/api.md section B. No statistic is computed here; every
p chart, I-MR, Cpk, P95, ANOM, fault tree and what-if comes from app.qc.

If app/qc.py is missing, health, meta and POST /api/calls still work and the statistics
routes answer HTTP 503 instead of crashing the server.
"""
from __future__ import annotations

import importlib
import math
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app import data

ROOT = Path(__file__).resolve().parent.parent
GEO_DIR = ROOT / "geo"
DIST_DIR = ROOT / "app" / "frontend" / "dist"
FIXES = ("closer", "add_ambulance", "center_faster", "crew_faster")


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
        return {"dataset": self.dataset, "level": self.level, "id": self.id, "name": self.name,
                "from": self.from_.isoformat(), "to": self.to.isoformat(), "urgency": self.groups,
                "baseline_from": self.info["from"].isoformat(), "baseline_to": self.info["to"].isoformat()}

    def reply(self, body: dict, extra_messages=()) -> dict:
        msgs = list(self.messages) + [m for m in extra_messages if m]
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


def place_card(qc, sel_timed, n_calls, base_timed, base_info) -> dict:
    """Run the statistics for ONE place and return the fields of a summary row.

    Needs only capability + changed_recently + p95_boot (no I-MR chart per place).
    """
    n_sel, n_base = len(sel_timed), len(base_timed)
    card = {"calls": n_calls, "timed": n_sel, "late": int(sel_timed["late"].sum()),
            "very_late": very_late_count(sel_timed)}
    card["pct_late"] = pct(card["late"], n_sel)
    card.update(p95_min=None, p95_ci=[None, None], spread_min=None, cpk=None, cpk_upper=None,
                too_slow=False, z_loc=None, z_p=None, changed=False, reasons=[])
    if n_sel:
        boot = qc.p95_boot(sel_timed["minutes"].tolist())
        card["p95_min"], card["p95_ci"], card["spread_min"] = num(boot["p95"]), minutes_list(boot["ci"]), num(boot["spread"])
    if n_sel < data.MIN_CALLS or n_base < data.MIN_CALLS:
        card["status"] = qc.status(False, False, n_sel, n_base)   # not_enough
        return card
    sel_x, base_x = sel_timed["ln_min"].tolist(), base_timed["ln_min"].tolist()
    ch = qc.changed_recently(sel_x, base_x, card["late"], n_sel, int(base_timed["late"].sum()), n_base)
    # Cpk on each call's log ratio to its own target, USL 0, goal = this place's call-weighted goal
    cap = qc.capability(sel_timed["ln_ratio"].tolist(), USL_LN_RATIO, data.weighted_goal(sel_timed))
    card["cpk"], card["cpk_upper"] = num(cap["cpk"], 3), num(cap["upper"], 3)
    card["too_slow"] = bool(cap["too_slow"])
    card["z_loc"], card["z_p"] = num(ch["z_loc"]), num(ch["z_p"])
    card["changed"], card["reasons"] = bool(ch["changed"]), ch["reasons"]
    card["status"] = qc.status(card["too_slow"], card["changed"], n_sel, n_base)
    return card


# ---------------------------------------------------------------- health, meta, live calls

@app.get("/api/health")
def health():
    names = list(data.DATASETS)
    rows = {d: len(data.load(d)) for d in names}
    if data.live_count():
        rows[data.LIVE] = data.live_count()
    return {"status": "ok", "datasets": names, "rows": rows}


@app.get("/api/meta")
def meta():
    lk = data.lookups()
    ranges = [data.date_range(data.load(d)) for d in data.DATASETS]
    counties = lk["counties"].sort_values("county_name")
    return {
        "datasets": list(data.DATASETS),
        "date_min": min(r[0] for r in ranges).isoformat(),
        "date_max": max(r[1] for r in ranges).isoformat(),
        "counties": [{"county_fips": f, "county_name": n}
                     for f, n in zip(counties["county_fips"], counties["county_name"])],
        "targets": records(lk["targets"], list(lk["targets"].columns)),
    }


class Call(BaseModel):
    """One incidents.csv row (SPEC section 3). t_onscene is empty for a cancelled call."""
    incident_id: str
    zcta: str
    urgency_code: int
    t_received: str
    t_assigned: str
    t_enroute: str
    t_onscene: str | None = None
    disposition: str
    valid_time: str
    eta_google_s: int | None = None
    held: str | None = None


@app.post("/api/calls")
def post_call(call: Call):
    try:
        n = data.add_live(call.model_dump())
    except (ValueError, KeyError) as e:
        raise HTTPException(400, str(e)) from None
    return {"ok": True, "incident_id": call.incident_id, "rows": n}


# ---------------------------------------------------------------- statistics routes

@app.get("/api/summary")
def summary(c: Ctx = Depends(common)):
    qc = get_qc()
    sel_t, base_t = c.timed, c.base_timed
    goal = data.weighted_goal(sel_t)

    totals = {"calls": len(c.sel), "timed": len(sel_t), "late": int(sel_t["late"].sum()),
              "very_late": very_late_count(sel_t)}
    totals["pct_late"] = pct(totals["late"], totals["timed"])
    totals["median_min"] = num(sel_t["minutes"].median()) if len(sel_t) else None
    totals["median_dispatch_to_scene_min"] = (num(sel_t["dispatch_to_scene_s"].median() / 60)
                                              if len(sel_t) else None)
    boot = qc.p95_boot(sel_t["minutes"].tolist())
    totals["p95_min"], totals["p95_ci"] = num(boot["p95"]), minutes_list(boot["ci"])
    d2s = qc.p95_boot((sel_t["dispatch_to_scene_s"] / 60.0).tolist())
    totals["p95_dispatch_to_scene_min"] = num(d2s["p95"])
    totals["p95_dispatch_to_scene_ci"] = minutes_list(d2s["ci"])
    totals["spread_min"] = num(boot["spread"])
    totals["goal_pct"] = goal

    key = data.child_key(c.level)
    kids = data.children(c.level, c.id)
    sel_groups = {k: g for k, g in c.sel.groupby(key, observed=True)}
    base_groups = data.child_baselines(c.df, c.level, c.id, c.groups, c.from_, c.baseline_days)
    places = []
    for kid in kids:
        rows = sel_groups.get(kid["id"], c.sel.iloc[:0])
        timed = rows[rows["timed"].to_numpy()]
        b_rows, b_info = base_groups[kid["id"]]
        card = place_card(qc, timed, len(rows), b_rows[b_rows["timed"].to_numpy()], b_info)
        places.append({"id": kid["id"], "name": kid["name"], **card})

    per_county = data.select(c.df, "state", None, c.groups, c.from_, c.to)["county_fips"].value_counts()
    names = data.lookups()["county_names"]
    urgent_by_county = [{"county_fips": f, "name": names[f], "calls": int(per_county.get(f, 0))}
                        for f in sorted(names)]
    attention = sum(p["status"] in ("act_now", "recent_change", "ongoing_gap") for p in places)
    msgs = boot["messages"]
    return c.reply({"totals": totals, "needs_attention": int(attention), "places": places,
                    "urgent_by_county": urgent_by_county}, msgs)


@app.get("/api/anom")
def anom(c: Ctx = Depends(common)):
    qc = get_qc()
    key = data.child_key(c.level)
    names = {k["id"]: k["name"] for k in data.children(c.level, c.id)}
    all_groups = {k: g["ln_min"].tolist() for k, g in c.timed.groupby(key, observed=True)}
    groups = {k: v for k, v in all_groups.items() if len(v) >= data.MIN_CALLS}
    msgs = [f"{names.get(k, k)}: only {len(v)} timed calls (under {data.MIN_CALLS}), left out of ANOM"
            for k, v in all_groups.items() if len(v) < data.MIN_CALLS]
    if len(groups) < 2:
        return c.reply({"grand_mean_min": None, "h": None, "k": len(groups), "N": None, "F": None,
                        "df1": None, "df2": None, "places": []},
                       msgs + ["ANOM needs at least 2 places with 30 or more timed calls"])
    r = qc.anom(groups)
    places = []
    for pid, g in r["groups"].items():
        places.append({"id": pid, "name": names.get(pid, pid), "n": g["n"],
                       "mean_min": num(math.exp(g["mean"])),
                       "ci_min": [num(math.exp(v)) for v in g["ci"]],
                       "lower_min": num(math.exp(g["lower"])), "upper_min": num(math.exp(g["upper"])),
                       "verdict": g["verdict"]})
    return c.reply({"grand_mean_min": num(math.exp(r["grand_mean"])), "h": num(r["h"], 4), "k": r["k"],
                    "N": r["N"], "F": num(r["F"], 3), "df1": r["df1"], "df2": r["df2"],
                    "places": places}, r.get("messages", []) + msgs)


@app.get("/api/pchart")
def pchart(c: Ctx = Depends(common)):
    qc = get_qc()
    base_t = c.base_timed
    base_n, base_late = len(base_t), int(base_t["late"].sum())
    p_bar = base_late / base_n if base_n else None
    unit = qc.subgroup_unit(data.calls_per_day(c.info), p_bar)
    if unit is None:   # low volume: no marks, but p_bar is still shown
        return c.reply({"unit": None, "p_bar": num(p_bar, 4), "base_n": base_n, "points": [],
                        "run_signal": False}, ["low volume: too few late calls per month in the baseline, no chart marks"])
    sg = data.subgroups(c.timed, unit)
    r = qc.p_chart(sg["n"], sg["late"], base_n, base_late)
    points = [{"start": s, **{k: p[k] for k in ("n", "late", "p", "ucl", "lcl", "signal")}}
              for s, p in zip(sg["start"], r["points"])]
    return c.reply({"unit": unit, "p_bar": r["p_bar"], "base_n": len(base_t), "points": points,
                    "run_signal": r["run_signal"]}, r.get("messages", []))


@app.get("/api/imr")
def imr(c: Ctx = Depends(common)):
    qc = get_qc()
    t, b = c.timed, c.base_timed
    r = qc.imr(t["ln_min"].tolist(), b["ln_min"].tolist())
    ids, rec = t["incident_id"].tolist(), [ts.isoformat() for ts in t["t_received"]]
    mins, lns = t["minutes"].tolist(), t["ln_min"].tolist()
    points = [{"incident_id": ids[i], "t_received": rec[i], "minutes": num(mins[i]), "ln_min": num(lns[i], 4),
               "mr": p.get("mr"), "tests": p.get("tests", [])} for i, p in enumerate(r["points"])]
    ex = lambda v: num(math.exp(v)) if v is not None and math.isfinite(v) else None
    return c.reply({"cl_min": ex(r["cl"]), "ucl_min": ex(r["ucl"]), "lcl_min": ex(r["lcl"]),
                    "mr_ucl": r["mr_ucl"], "points": points, "tests": r["tests"],
                    "before_median_min": num(b["minutes"].median()) if len(b) else None,
                    "after_median_min": num(t["minutes"].median()) if len(t) else None},
                   r.get("messages", []))


def step_row(timed: pd.DataFrame) -> dict:
    return {k: (num(timed[k].median()) if len(timed) else None)
            for k in ("dispatch_s", "turnout_s", "drive_s", "total_s")}


@app.get("/api/delays")
def delays(c: Ctx = Depends(common)):
    qc = get_qc()
    t, b = c.timed, c.base_timed
    late = t[t["late"].to_numpy()]
    cols = ["dispatch_s", "turnout_s", "eta_google_s", "drive_s", "held"]
    r = qc.fault_tree(records(late, cols), records(b, cols))
    worst = None
    if len(late):
        w = late.loc[late["total_s"].idxmax()]
        worst = {"incident_id": w["incident_id"], "t_received": w["t_received"].isoformat(),
                 "dispatch_s": num(w["dispatch_s"], 0), "turnout_s": num(w["turnout_s"], 0),
                 "eta_google_s": num(w["eta_google_s"], 0), "drive_s": num(w["drive_s"], 0),
                 "total_s": num(w["total_s"], 0)}
    return c.reply({"late_calls": len(late), "steps": {"now": step_row(t), "baseline": step_row(b)},
                    "causes": r["counts"], "worst_call": worst}, r.get("messages", []))


@app.get("/api/google")
def google(c: Ctx = Depends(common)):
    t, b = c.timed, c.base_timed
    available = bool(len(t) and t["eta_google_s"].notna().any())
    if not available:
        return c.reply({"available": False, "now": None, "baseline": None,
                        "pct_slower_than_google": None, "hist": None},
                       ["no eta_google_s in the selected calls: Google comparison hidden"])

    def meds(x):
        return {"eta_med_s": num(x["eta_google_s"].median(), 0), "drive_med_s": num(x["drive_s"].median(), 0)}

    # Histogram of (drive - Google estimate), 30 s bins from -300 s to +600 s; the end bins hold the tails.
    edges = np.arange(-300, 631, 30)

    def hist(x):
        v = np.clip(x["vs_google_s"].dropna().to_numpy(), edges[0], edges[-1] - 1)
        return np.histogram(v, bins=edges)[0].tolist()

    slower = pct(int((t["vs_google_s"] > 0).sum()), int(t["vs_google_s"].notna().sum()))
    return c.reply({"available": True, "now": meds(t), "baseline": meds(b), "pct_slower_than_google": slower,
                    "hist": {"edges_s": edges.tolist(), "now": hist(t), "baseline": hist(b)}})


@app.get("/api/whatif")
def whatif(fix: str = "closer", pct_: float = Query(20, alias="pct"), c: Ctx = Depends(common)):
    if fix not in FIXES:
        raise HTTPException(400, f"unknown fix '{fix}'; use one of {list(FIXES)}")
    if not 0 <= pct_ <= 100:
        raise HTTPException(400, "pct must be between 0 and 100")
    qc = get_qc()
    t = c.timed
    cols = ["dispatch_s", "turnout_s", "drive_s", "eta_google_s", "total_s", "held", "target_s"]
    b = c.base_timed
    nonheld = b.loc[~b["held"].to_numpy(), "dispatch_s"]
    base_median = float(nonheld.median()) if len(nonheld) else None
    r = qc.whatif(records(t, cols), fix, pct_, base_median)
    return c.reply({"fix": fix, "pct": pct_, "now": r["now"], "with_fix": r["with_fix"],
                    "avoided": r["avoided"], "n": len(t)}, r.get("messages", []))


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
