(function () {
  "use strict";

  var GEO = window.NY_GEO;
  if (!GEO) {
    return;
  }

  /* ------------------------------------------------------------------ *
   * Constants and helpers
   * ------------------------------------------------------------------ */

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DATA_START_YEAR = 2023;
  var DATA_START_MONTH = 9; /* October, zero based */
  var DATA_START_DATE = "2023-10-01";
  var DATA_END_DATE = "2026-09-30";
  var MONTH_COUNT = 36;
  var STATE_NAME = "New York State";

  var PRIORITY = {
    all: { label: "All priorities", scale: 0.32 * 0.88 + 0.46 * 1 + 0.22 * 1.18 },
    high: { label: "High priority", scale: 0.88 },
    medium: { label: "Medium priority", scale: 1 },
    low: { label: "Low priority", scale: 1.18 }
  };

  var STAGES = [
    { key: "intake", name: "Call intake", short: "Intake" },
    { key: "dispatch", name: "Unit dispatch", short: "Dispatch" },
    { key: "travel", name: "Travel to scene", short: "Travel" },
    { key: "handoff", name: "Scene handoff", short: "Handoff" }
  ];

  var PATTERN_COPY = {
    persistent: "Persistent: recent months show no recovery.",
    isolated: "Isolated: outliers drive the tail, not the median.",
    stable: "Stable: no sustained deterioration in the period."
  };

  var PATTERN_ORDER = { persistent: 0, emerging: 1, isolated: 2, stable: 3 };
  var TIER_ORDER = { critical: 0, watch: 1, stable: 2 };

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var nf1 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var nfInt = new Intl.NumberFormat("en-US");

  function f1(n) {
    return nf1.format(n);
  }

  function pct(n) {
    var v = n * 100;
    var sign = v > 0 ? "+" : "";
    return sign + v.toFixed(1) + "%";
  }

  function signed(n) {
    return (n > 0 ? "+" : "") + n.toFixed(1);
  }

  function cap(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function icon(name, cls) {
    return '<svg class="od-icon icon ' + (cls || "") + '" aria-hidden="true"><use href="#i-' + name + '"/></svg>';
  }

  function monthInfo(index) {
    var abs = DATA_START_MONTH + index;
    var year = DATA_START_YEAR + Math.floor(abs / 12);
    var month = abs % 12;
    return { year: year, month: month, name: MONTH_NAMES[month], short: MONTH_NAMES[month] + " '" + String(year).slice(2) };
  }

  function rangeLabel(fromIdx, toIdx) {
    var a = monthInfo(fromIdx);
    var b = monthInfo(toIdx);
    return a.name + " " + a.year + " – " + b.name + " " + b.year;
  }

  function hashString(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normCdf(z) {
    var t = 1 / (1 + 0.2316419 * Math.abs(z));
    var d = 0.3989423 * Math.exp((-z * z) / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  function tail15(avg, p90) {
    var sd = Math.max(1.9, (p90 - avg) / 1.2816);
    return Math.min(0.92, Math.max(0.01, 1 - normCdf((15 - avg) / sd)));
  }

  function meanRange(series, a, b) {
    var sum = 0;
    for (var i = a; i <= b; i++) sum += series[i];
    return sum / (b - a + 1);
  }

  /* ------------------------------------------------------------------ *
   * Synthetic service model
   * ------------------------------------------------------------------ */

  var COUNTY_BASE = {
    "36001": 10.9, "36003": 14.6, "36005": 14.9, "36007": 12.6, "36009": 14.3,
    "36011": 13.4, "36013": 13.8, "36015": 12.9, "36017": 14.9, "36019": 13.6,
    "36021": 12.9, "36023": 13.5, "36025": 14.8, "36027": 10.8, "36029": 11.9,
    "36031": 15.2, "36033": 15.0, "36035": 14.2, "36037": 13.7, "36039": 13.9,
    "36041": 16.3, "36043": 14.4, "36045": 13.8, "36047": 13.6, "36049": 15.2,
    "36051": 13.4, "36053": 13.9, "36055": 11.2, "36057": 14.1, "36059": 10.4,
    "36061": 14.2, "36063": 12.4, "36065": 12.7, "36067": 10.6, "36069": 12.9,
    "36071": 11.5, "36073": 13.6, "36075": 13.8, "36077": 14.3, "36079": 11.4,
    "36081": 13.2, "36083": 11.8, "36085": 12.6, "36087": 11.0, "36089": 14.9,
    "36091": 11.3, "36093": 11.9, "36095": 14.5, "36097": 13.9, "36099": 13.2,
    "36101": 14.1, "36103": 10.0, "36105": 13.5, "36107": 13.2, "36109": 12.0,
    "36111": 12.1, "36113": 13.7, "36115": 13.3, "36117": 13.1, "36119": 10.8,
    "36121": 14.4, "36123": 13.7
  };

  var DENSITY = {
    "36005": 5.4, "36047": 5.1, "36061": 5.6, "36081": 4.9, "36085": 3.9,
    "36059": 2.7, "36103": 2.4, "36119": 2.5, "36087": 2.2, "36079": 1.7,
    "36029": 1.9, "36055": 1.8, "36067": 1.6, "36001": 1.7, "36063": 1.5,
    "36065": 1.3, "36007": 1.2, "36071": 1.3, "36027": 1.2, "36091": 1.1,
    "36093": 1.0, "36083": 1.0
  };

  var countyByFips = {};
  GEO.counties.forEach(function (c) {
    countyByFips[c.f] = c;
  });

  var BOROUGH_FIPS = ["36005", "36047", "36061", "36081", "36085"];
  var CONTEXT_CAMERA = [-100, -95, 1230, 1230];

  function isBorough(fips) {
    return BOROUGH_FIPS.indexOf(fips) !== -1;
  }

  var zipModels = GEO.zips.map(function (z) {
    var countyName = countyByFips[z.c] ? countyByFips[z.c].n : "New York";
    var seed = hashString(z.z + ":" + z.c);
    var rand = mulberry32(seed);
    var base = (COUNTY_BASE[z.c] || 13.4) * (0.88 + rand() * 0.26);
    var p90f = 1.44 + rand() * 0.42;
    var density = DENSITY[z.c] || 0.75;
    var volume = (30 + rand() * 60) * density;
    var slope = -0.05 + rand() * 0.24;
    var phase = rand() * Math.PI * 2;
    var emerging = seed % 8 === 0;
    var spikeMonth = 24 + (seed % 9);
    var intake = 0.1 + rand() * 0.06;
    var dispatch = 0.14 + rand() * 0.08;
    var travel = 0.44 + rand() * 0.16;
    var handoff = 0.08 + rand() * 0.05;
    var stageSum = intake + dispatch + travel + handoff;
    var shares = [intake / stageSum, dispatch / stageSum, travel / stageSum, handoff / stageSum];
    var series = [];
    var meanAll = 0;
    for (var m = 0; m < MONTH_COUNT; m++) {
      var v = base * (1 + slope * (m / (MONTH_COUNT - 1)));
      v *= 1 + 0.045 * Math.sin((m / 12) * Math.PI * 2 + phase - 1.1);
      v *= 1 + (rand() - 0.5) * 0.08;
      if (emerging && m >= 29) v *= 1 + 0.027 * (m - 28);
      if (m === spikeMonth) v *= 1.2 + (seed % 4) * 0.035;
      series.push(v);
      meanAll += v;
    }
    return {
      zip: z.z,
      c: z.c,
      d: z.d,
      county: countyName,
      base: base,
      p90f: p90f,
      volume: volume,
      series: series,
      meanAll: meanAll / MONTH_COUNT,
      stages: shares
    };
  });

  var modelByZip = {};
  var modelsByCounty = {};
  zipModels.forEach(function (m) {
    modelByZip[m.zip] = m;
    if (!modelsByCounty[m.c]) modelsByCounty[m.c] = [];
    modelsByCounty[m.c].push(m);
  });

  /* ------------------------------------------------------------------ *
   * State
   * ------------------------------------------------------------------ */

  var state = {
    priority: "all",
    wait: null,
    fromIdx: 0,
    toIdx: 35,
    view: "state",
    countyFips: null,
    zip: null,
    tableOpen: false,
    sortKey: "score",
    sortDir: -1,
    zMetrics: null,
    countyAgg: null,
    stateAgg: null,
    scopeModels: [],
    scopeMetrics: null,
    monthly: [],
    scopeTotal: 0,
    scopeEmpty: false,
    followups: {},
    followupKey: null,
    searchItems: [],
    searchIndex: -1,
    camera: CONTEXT_CAMERA.slice()
  };

  var els = {
    clock: document.getElementById("clockText"),
    placeName: document.getElementById("placeName"),
    placeSite: document.getElementById("placeSite"),
    placeMeta: document.getElementById("placeMeta"),
    metricsMeta: document.getElementById("metricsMeta"),
    filterState: document.getElementById("filterState"),
    priority: document.getElementById("prioritySelect"),
    wait: document.getElementById("waitInput"),
    resetFilters: document.getElementById("resetFilters"),
    rangeForm: document.getElementById("rangeForm"),
    dateFrom: document.getElementById("dateFrom"),
    dateTo: document.getElementById("dateTo"),
    rangeError: document.getElementById("rangeError"),
    metric1Value: document.getElementById("metric1Value"),
    metric1Foot: document.getElementById("metric1Foot"),
    metric2Value: document.getElementById("metric2Value"),
    metric2Foot: document.getElementById("metric2Foot"),
    metric3Value: document.getElementById("metric3Value"),
    metric3Foot: document.getElementById("metric3Foot"),
    summaryChip: document.getElementById("summaryChip"),
    summaryText: document.getElementById("summaryText"),
    summaryNext: document.getElementById("summaryNext"),
    summaryNextText: document.getElementById("summaryNextText"),
    followupBtn: document.getElementById("followupBtn"),
    followupLabel: document.getElementById("followupLabel"),
    followupStatus: document.getElementById("followupStatus"),
    insightsTitle: document.getElementById("insightsTitle"),
    insightsNote: document.getElementById("insightsNote"),
    trendChart: document.getElementById("trendChart"),
    trendTip: document.getElementById("trendTip"),
    trendSub: document.getElementById("trendSub"),
    stageChart: document.getElementById("stageChart"),
    tableToggle: document.getElementById("tableToggle"),
    tableWrap: document.getElementById("tableWrap"),
    tableHead: document.getElementById("tableHead"),
    tableBody: document.getElementById("tableBody"),
    tableSub: document.getElementById("tableSub"),
    tableCount: document.getElementById("tableCount"),
    map: document.getElementById("map"),
    countyLayer: document.getElementById("countyLayer"),
    zipLayer: document.getElementById("zipLayer"),
    outlineLayer: document.getElementById("outlineLayer"),
    countyClipPath: document.getElementById("countyClipPath"),
    cityLayer: document.getElementById("cityLayer"),
    backBtn: document.getElementById("backBtn"),
    resetBtn: document.getElementById("resetBtn"),
    breadcrumb: document.getElementById("breadcrumb"),
    insetWrap: document.getElementById("insetWrap"),
    insetMap: document.getElementById("insetMap"),
    insetHint: document.getElementById("insetHint"),
    insetBack: document.getElementById("insetBack"),
    legendCritical: document.getElementById("legendCritical"),
    legendWatch: document.getElementById("legendWatch"),
    legendStable: document.getElementById("legendStable"),
    mapTip: document.getElementById("mapTip"),
    searchInput: document.getElementById("placeSearch"),
    searchResults: document.getElementById("searchResults"),
    liveScope: document.getElementById("liveScope")
  };

  /* ------------------------------------------------------------------ *
   * Metrics
   * ------------------------------------------------------------------ */

  function patternFor(avg, p90, recent, prior) {
    var growth = prior > 0 ? recent / prior : 1;
    if (growth > 1.13 && recent > 11.5) return "emerging";
    if (avg > 12.4 && growth > 0.985) return "persistent";
    if (p90 / Math.max(avg, 0.1) > 1.92) return "isolated";
    return "stable";
  }

  function scopePattern(avg, p90, recent, prior) {
    var growth = prior > 0 ? recent / prior : 1;
    if (growth > 1.1 && recent > 12) return "emerging";
    if (avg > 12.6 && growth > 0.985) return "persistent";
    if (p90 / Math.max(avg, 0.1) > 1.9) return "isolated";
    return "stable";
  }

  function tierFor(avg, p90, pattern) {
    if (p90 >= 26.4 || (avg >= 15.0 && pattern !== "stable")) return "critical";
    if (avg >= 14.1 || p90 >= 24.5 || pattern === "emerging") return "watch";
    return "stable";
  }

  function computeZipMetric(model, fromIdx, toIdx) {
    var scale = PRIORITY[state.priority].scale;
    var sum = 0;
    for (var i = fromIdx; i <= toIdx; i++) sum += model.series[i];
    var avg = (sum / (toIdx - fromIdx + 1)) * scale;
    var p90 = model.base * model.p90f * scale;
    var share15 = tail15(avg, p90);
    var recent = meanRange(model.series, 30, 35) * scale;
    var prior = meanRange(model.series, 0, 29) * scale;
    var pattern = patternFor(avg, p90, recent, prior);
    return {
      avg: avg,
      p90: p90,
      share15: share15,
      recent: recent,
      prior: prior,
      growth: prior > 0 ? recent / prior : 1,
      pattern: pattern,
      tier: tierFor(avg, p90, pattern),
      delta: avg / (model.meanAll * scale) - 1,
      stageMinutes: model.stages.map(function (s) { return s * avg; }),
      volume: model.volume
    };
  }

  function aggregateMetrics(models, scale) {
    var weight = 0;
    var avg = 0;
    var p90 = 0;
    var share15 = 0;
    var recent = 0;
    var prior = 0;
    var baseline = 0;
    var stages = [0, 0, 0, 0];
    var flagged = 0;
    var maxP90 = 0;

    models.forEach(function (model) {
      var x = state.zMetrics[model.zip];
      var w = model.volume;
      weight += w;
      avg += x.avg * w;
      p90 += x.p90 * w;
      share15 += x.share15 * w;
      recent += x.recent * w;
      prior += x.prior * w;
      baseline += model.meanAll * scale * w;
      maxP90 = Math.max(maxP90, x.p90);
      if (x.tier === "critical") flagged++;
      for (var s = 0; s < 4; s++) stages[s] += x.stageMinutes[s] * w;
    });

    if (!weight) {
      return { avg: 0, p90: 0, share15: 0, recent: 0, prior: 0, growth: 1, baselineAvg: 0, baseline15: 0, d15: 0, delta: 0, stageMinutes: [0, 0, 0, 0], pattern: "stable", tier: "stable", flagged: 0, zones: 0, volume: 0, maxP90: 0 };
    }

    avg /= weight;
    p90 /= weight;
    share15 /= weight;
    recent /= weight;
    prior /= weight;
    baseline /= weight;
    for (var i = 0; i < 4; i++) stages[i] /= weight;

    var pattern = models.length === 1 ? state.zMetrics[models[0].zip].pattern : scopePattern(avg, p90, recent, prior);
    var base15 = tail15(baseline, p90);
    return {
      avg: avg,
      p90: p90,
      share15: share15,
      recent: recent,
      prior: prior,
      growth: prior > 0 ? recent / prior : 1,
      baselineAvg: baseline,
      baseline15: base15,
      d15: share15 - base15,
      delta: baseline > 0 ? avg / baseline - 1 : 0,
      stageMinutes: stages,
      pattern: pattern,
      tier: tierFor(avg, p90, pattern),
      flagged: flagged,
      zones: models.length,
      volume: weight,
      maxP90: maxP90
    };
  }

  function computeAll() {
    var scale = PRIORITY[state.priority].scale;
    var metrics = {};
    zipModels.forEach(function (m) {
      metrics[m.zip] = computeZipMetric(m, state.fromIdx, state.toIdx);
    });
    state.zMetrics = metrics;

    var countyAgg = {};
    GEO.counties.forEach(function (c) {
      var models = modelsByCounty[c.f];
      if (models && models.length) countyAgg[c.f] = aggregateMetrics(models, scale);
    });
    state.countyAgg = countyAgg;
    state.stateAgg = aggregateMetrics(zipModels, scale);

    var models;
    if (state.zip && modelByZip[state.zip]) models = [modelByZip[state.zip]];
    else if (state.countyFips && modelsByCounty[state.countyFips]) models = modelsByCounty[state.countyFips];
    else models = zipModels;

    state.scopeTotal = models.length;
    var filtered = state.wait ? models.filter(function (m) {
      return metrics[m.zip] && metrics[m.zip].avg >= state.wait;
    }) : models;

    state.scopeModels = filtered;
    state.scopeEmpty = filtered.length === 0;
    state.scopeMetrics = aggregateMetrics(filtered, scale);

    if (!filtered.length) {
      state.monthly = [];
      return;
    }

    var monthly = new Array(MONTH_COUNT).fill(0);
    var weights = new Array(MONTH_COUNT).fill(0);
    filtered.forEach(function (m) {
      for (var i = 0; i < MONTH_COUNT; i++) {
        monthly[i] += m.series[i] * scale * m.volume;
        weights[i] += m.volume;
      }
    });
    state.monthly = monthly.map(function (v, i) { return v / weights[i]; });
  }

  /* ------------------------------------------------------------------ *
   * Header and metrics UI
   * ------------------------------------------------------------------ */

  function scopeTitle() {
    if (state.zip) return "ZIP " + state.zip;
    if (state.countyFips) return countyByFips[state.countyFips].n + " County";
    return STATE_NAME;
  }

  function updateHeader() {
    var scope = state.scopeMetrics;
    els.placeName.textContent = scopeTitle();

    if (state.view === "state") {
      els.placeSite.textContent = "Statewide";
      els.placeMeta.textContent = state.wait
        ? scope.zones + " of " + nfInt.format(state.scopeTotal) + " ZIPs meet ≥ " + state.wait + " min"
        : "62 counties · " + nfInt.format(GEO.zips.length) + " ZIP codes";
    } else if (state.zip) {
      var county = countyByFips[state.countyFips];
      els.placeSite.textContent = county.n + " County";
      els.placeMeta.textContent = state.scopeEmpty
        ? "Below the " + state.wait + " min wait filter"
        : (modelsByCounty[state.countyFips] || []).length + " ZIPs in county · P90 " + f1(scope.p90) + " min";
    } else {
      els.placeSite.textContent = "New York State";
      els.placeMeta.textContent = state.wait && !state.scopeEmpty
        ? scope.zones + " of " + state.scopeTotal + " ZIPs meet ≥ " + state.wait + " min"
        : scope.zones + " ZIP codes · " + scope.flagged + " critical";
    }

    var months = state.toIdx - state.fromIdx + 1;
    var meta = rangeLabel(state.fromIdx, state.toIdx) + " · " + PRIORITY[state.priority].label;
    els.metricsMeta.textContent = meta;

    var filter = PRIORITY[state.priority].label + " · " + months + (months === 1 ? " month" : " months");
    if (state.wait) filter += " · " + scope.zones + " of " + state.scopeTotal + " zones ≥ " + state.wait + " min";
    els.filterState.textContent = filter;

    els.insightsNote.textContent = scopeTitle() + " · vs 36-month baseline";
    els.trendSub.textContent = rangeLabel(state.fromIdx, state.toIdx) + " · median minutes";
    els.insightsTitle.textContent = "State Wait Time Insights";
  }

  function deltaMarkup(value, suffix, label) {
    var abs = Math.abs(value);
    var cls = abs < 0.5 ? "flat" : value > 0 ? "bad" : "good";
    var arrow = cls === "bad" ? "up" : cls === "good" ? "down" : "";
    var glyph = arrow ? icon(arrow) : "";
    return '<span class="delta ' + cls + '">' + glyph + (value > 0 ? "+" : value < 0 ? "-" : "") + abs.toFixed(1) + suffix + "</span><span>" + label + "</span>";
  }

  function updateMetrics() {
    var m = state.scopeMetrics;
    if (state.scopeEmpty) {
      els.metric1Value.textContent = "—";
      els.metric1Foot.innerHTML = '<span class="delta flat">No zones ≥ ' + state.wait + " min</span>";
      els.metric2Value.textContent = "—";
      els.metric2Foot.innerHTML = '<span class="delta flat">No matching calls</span>';
      els.metric3Value.textContent = "—";
      els.metric3Foot.innerHTML = '<span class="delta flat">Adjust the wait filter</span>';
      return;
    }
    els.metric1Value.textContent = f1(m.avg);
    els.metric1Foot.innerHTML = deltaMarkup(m.delta * 100, "%", "vs 36-mo");
    els.metric2Value.textContent = f1(m.p90);
    els.metric2Foot.innerHTML = '<span class="delta flat">Worst 1 in 10 calls</span>';
    els.metric3Value.textContent = (m.share15 * 100).toFixed(1);
    els.metric3Foot.innerHTML = deltaMarkup(m.d15 * 100, " pts", "vs 36-mo");
  }

  function topStage(m) {
    var idx = 0;
    for (var i = 1; i < m.stageMinutes.length; i++) {
      if (m.stageMinutes[i] > m.stageMinutes[idx]) idx = i;
    }
    var total = m.stageMinutes.reduce(function (a, b) { return a + b; }, 0) || 1;
    return { index: idx, share: m.stageMinutes[idx] / total, minutes: m.stageMinutes[idx], total: total };
  }

  function topCounty() {
    var best = null;
    GEO.counties.forEach(function (c) {
      var agg = state.countyAgg[c.f];
      if (!agg) return;
      if (state.wait && agg.avg < state.wait) return;
      var score = agg.avg * 0.7 + agg.p90 * 0.3;
      if (!best || score > best.score) best = { c: c, agg: agg, score: score };
    });
    return best;
  }

  function topZipInModels(models) {
    var best = null;
    models.forEach(function (model) {
      var x = state.zMetrics[model.zip];
      var score = x.avg + x.p90 * 0.4 + Math.max(x.delta, 0) * 12;
      if (!best || score > best.score) best = { model: model, metric: x, score: score };
    });
    return best;
  }

  function followupKeyForScope() {
    if (state.zip) return "zip:" + state.zip;
    if (state.countyFips) return "county:" + state.countyFips;
    return "state";
  }

  function syncFollowup() {
    state.followupKey = followupKeyForScope();
    var flagged = !!state.followups[state.followupKey];
    els.followupBtn.disabled = state.scopeEmpty;
    els.followupBtn.setAttribute("aria-pressed", flagged ? "true" : "false");
    els.followupLabel.textContent = flagged ? "Flagged" : "Flag";
    els.followupBtn.title = flagged
      ? "Remove this area from the follow-up list"
      : "Add this area to the follow-up list";
  }

  function updateSummary() {
    var m = state.scopeMetrics;
    state.summaryTarget = null;

    if (state.scopeEmpty) {
      var where = state.view === "state"
        ? "Statewide"
        : state.zip
          ? "ZIP " + state.zip
          : countyByFips[state.countyFips].n + " County";
      els.summaryChip.className = "pattern-chip pattern-void";
      els.summaryChip.textContent = "Filtered";
      els.summaryText.textContent = where + " has no zone with a median on-scene time of " + state.wait +
        " minutes or more in " + rangeLabel(state.fromIdx, state.toIdx) + ". Lower the threshold or clear the wait filter to restore this scope.";
      els.summaryNextText.innerHTML = "Clear the wait filter to restore this view.";
      els.summaryNext.disabled = false;
      syncFollowup();
      return;
    }

    var st = topStage(m);
    var stageName = STAGES[st.index].name.toLowerCase();
    var stagePct = Math.round(st.share * 100);
    var pattern = m.pattern;
    var deltaCopy = Math.abs(m.delta) < 0.0005 ? "" : " (" + pct(m.delta) + " vs baseline)";

    els.summaryChip.className = "pattern-chip pattern-" + pattern;
    els.summaryChip.textContent = cap(pattern);

    var patternSentence;
    if (pattern === "emerging") {
      patternSentence = "New: the last 6 months run " + Math.max(1, Math.round((m.growth - 1) * 100)) + "% slower.";
    } else {
      patternSentence = PATTERN_COPY[pattern];
    }

    var text;
    var nextHtml;

    if (state.view === "state") {
      var lead = topCounty();
      var countyCritical = 0;
      GEO.counties.forEach(function (c) {
        var ca = state.countyAgg[c.f];
        if (!ca || (state.wait && ca.avg < state.wait)) return;
        if (ca.tier === "critical") countyCritical++;
      });
      text = "Statewide median " + f1(m.avg) + " min" + deltaCopy + ". " +
        countyCritical + " of 62 counties are critical" +
        (lead ? "; " + lead.c.n + " County leads at " + f1(lead.agg.avg) + " min" : "") + ". " +
        patternSentence + " " + cap(stageName) + " holds " + stagePct + "% of the clock.";
      nextHtml = lead
        ? "Start with <strong>" + lead.c.n + " County</strong> · " + f1(lead.agg.avg) + " min median"
        : "No county is currently ranked critical.";
      state.summaryTarget = lead ? { type: "county", id: lead.c.f } : null;
    } else if (state.zip) {
      var countyAgg = state.countyAgg[state.countyFips];
      var diff = m.avg - countyAgg.avg;
      text = "ZIP " + state.zip + " runs " + f1(m.avg) + " min" + deltaCopy + ", " +
        Math.abs(diff).toFixed(1) + " min " + (diff >= 0 ? "above" : "below") + " " + countyByFips[state.countyFips].n + " County. " +
        patternSentence + " " + cap(stageName) + " holds " + stagePct + "%; P90 is " + f1(m.p90) + " min.";
      var siblings = (modelsByCounty[state.countyFips] || []).filter(function (model) {
        if (model.zip === state.zip) return false;
        return !state.wait || state.zMetrics[model.zip].avg >= state.wait;
      });
      var next = topZipInModels(siblings);
      nextHtml = next
        ? "Compare with <strong>ZIP " + next.model.zip + "</strong> · P90 " + f1(next.metric.p90) + " min"
        : "This is the only ZIP in the county.";
      state.summaryTarget = next ? { type: "zip", id: next.model.zip } : null;
    } else {
      var stateAvg = state.stateAgg ? state.stateAgg.avg : m.avg;
      var diffState = m.avg - stateAvg;
      text = countyByFips[state.countyFips].n + " County median " + f1(m.avg) + " min" + deltaCopy + ", " +
        Math.abs(diffState).toFixed(1) + " min " + (diffState >= 0 ? "above" : "below") + " the state. " +
        patternSentence + " " + cap(stageName) + " holds " + stagePct + "%; " + m.flagged + " of " + m.zones + " ZIPs are critical.";
      var countyNext = topZipInModels(state.scopeModels);
      nextHtml = countyNext
        ? "Start with <strong>ZIP " + countyNext.model.zip + "</strong> · P90 " + f1(countyNext.metric.p90) + " min"
        : "No ZIP code is currently ranked critical.";
      state.summaryTarget = countyNext ? { type: "zip", id: countyNext.model.zip } : null;
    }

    els.summaryText.textContent = text;
    els.summaryNextText.innerHTML = nextHtml;
    els.summaryNext.disabled = !state.summaryTarget;
    syncFollowup();
  }

  /* ------------------------------------------------------------------ *
   * Charts
   * ------------------------------------------------------------------ */

  var trendLayout = null;

  function drawTrend() {
    var el = els.trendChart;
    if (!el || !state.scopeMetrics) return;
    if (state.scopeEmpty || !state.monthly.length) {
      trendLayout = null;
      var oldSvg = el.querySelector("svg");
      if (oldSvg) oldSvg.remove();
      var oldEmpty = el.querySelector(".chart-empty");
      if (oldEmpty) oldEmpty.remove();
      el.insertAdjacentHTML("afterbegin", '<div class="chart-empty">No zones match the current wait filter.</div>');
      return;
    }
    var w = el.clientWidth;
    var h = el.clientHeight;
    if (w < 80 || h < 80) return;

    var from = state.fromIdx;
    var to = state.toIdx;
    var values = state.monthly.slice(from, to + 1);
    var n = values.length;
    var baseline = state.scopeMetrics.baselineAvg;

    var min = Math.min.apply(null, values.concat([baseline]));
    var max = Math.max.apply(null, values.concat([baseline]));
    if (max - min < 1) {
      max += 0.8;
      min -= 0.8;
    }
    var padV = (max - min) * 0.16;
    min -= padV;
    max += padV;

    var pad = { l: 29, r: 7, t: 9, b: 19 };
    var innerW = Math.max(10, w - pad.l - pad.r);
    var innerH = Math.max(10, h - pad.t - pad.b);

    function xAt(i) {
      return n === 1 ? pad.l + innerW / 2 : pad.l + (i / (n - 1)) * innerW;
    }
    function yAt(v) {
      return pad.t + ((max - v) / (max - min)) * innerH;
    }

    var points = values.map(function (v, i) {
      var info = monthInfo(from + i);
      return { x: xAt(i), y: yAt(v), value: v, label: info.name + " " + info.year };
    });

    var line = points.map(function (p, i) { return (i === 0 ? "M" : "L") + p.x.toFixed(2) + " " + p.y.toFixed(2); }).join(" ");
    var area = line + " L" + points[points.length - 1].x.toFixed(2) + " " + (pad.t + innerH) + " L" + points[0].x.toFixed(2) + " " + (pad.t + innerH) + " Z";

    var ticks = [min, (min + max) / 2, max];
    var grid = ticks.map(function (v) {
      var y = yAt(v);
      return '<line x1="' + pad.l + '" y1="' + y.toFixed(2) + '" x2="' + (w - pad.r) + '" y2="' + y.toFixed(2) + '" stroke="#e8eff6" stroke-width="1"/>' +
        '<text x="' + (pad.l - 5) + '" y="' + (y + 3).toFixed(2) + '" text-anchor="end" font-size="9" font-weight="600" fill="#5f748e">' + f1(v) + "</text>";
    }).join("");

    var labelIdx = [];
    if (n <= 4) {
      for (var i = 0; i < n; i++) labelIdx.push(i);
    } else {
      [0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1].forEach(function (i) {
        if (labelIdx.indexOf(i) === -1) labelIdx.push(i);
      });
    }
    var xLabels = labelIdx.map(function (i) {
      return '<text x="' + points[i].x.toFixed(2) + '" y="' + (h - 4) + '" text-anchor="' + (i === 0 ? "start" : i === n - 1 ? "end" : "middle") + '" font-size="9" font-weight="600" fill="#5f748e">' + monthInfo(from + i).short + "</text>";
    }).join("");

    var baselineY = yAt(baseline);
    var last = points[points.length - 1];

    var svg = '<svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" role="img" aria-label="On-scene time trend, ' + rangeLabel(from, to) + '">' +
      '<defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1f6fb8" stop-opacity="0.16"/><stop offset="100%" stop-color="#1f6fb8" stop-opacity="0.01"/></linearGradient></defs>' +
      grid +
      '<line x1="' + pad.l + '" y1="' + baselineY.toFixed(2) + '" x2="' + (w - pad.r) + '" y2="' + baselineY.toFixed(2) + '" stroke="#8fa3b8" stroke-width="1.2" stroke-dasharray="3 4"/>' +
      '<path d="' + area + '" fill="url(#trendFill)"/>' +
      '<path d="' + line + '" fill="none" stroke="#1f6fb8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last.x.toFixed(2) + '" cy="' + last.y.toFixed(2) + '" r="3.2" fill="#fff" stroke="#1f6fb8" stroke-width="2"/>' +
      '<line id="trendHoverLine" x1="0" y1="' + pad.t + '" x2="0" y2="' + (pad.t + innerH) + '" stroke="#1f6fb8" stroke-width="1" stroke-dasharray="2 3" opacity="0"/>' +
      '<circle id="trendHoverDot" cx="0" cy="0" r="3.4" fill="#1f6fb8" opacity="0"/>' +
      xLabels +
      "</svg>";

    var old = el.querySelector("svg");
    if (old) old.remove();
    var empty = el.querySelector(".chart-empty");
    if (empty) empty.remove();
    el.insertAdjacentHTML("afterbegin", svg);
    trendLayout = { points: points, pad: pad, w: w, h: h };
  }

  function drawStages() {
    var m = state.scopeMetrics;
    var total = m.stageMinutes.reduce(function (a, b) { return a + b; }, 0);
    if (!total) {
      els.stageChart.innerHTML = '<p class="stage-empty">No service records match this filter.</p>';
      return;
    }

    var idx = 0;
    for (var i = 1; i < m.stageMinutes.length; i++) {
      if (m.stageMinutes[i] > m.stageMinutes[idx]) idx = i;
    }
    var max = Math.max.apply(null, m.stageMinutes);
    var share = Math.round((m.stageMinutes[idx] / total) * 100);

    var rows = STAGES.map(function (stage, i) {
      var mins = m.stageMinutes[i];
      var width = max > 0 ? Math.max(3, (mins / max) * 100) : 3;
      return '<div class="stage-row' + (i === idx ? " is-top" : "") + '">' +
        '<span class="stage-name">' + stage.short + "</span>" +
        '<span class="stage-track"><span class="stage-fill" style="width:' + width.toFixed(1) + '%"></span></span>' +
        '<span class="stage-min">' + f1(mins) + " <em>min</em></span>" +
        "</div>";
    }).join("");

    els.stageChart.innerHTML =
      '<p class="stage-caption"><strong>' + share + "%</strong><span>of the " + f1(total) + " min clock sits in <b>" + STAGES[idx].name.toLowerCase() + "</b></span></p>" +
      '<div class="stage-rows">' + rows + "</div>" +
      '<div class="stage-foot"><span>Total on-scene clock</span><span>' + f1(total) + " min</span></div>";
  }

  /* ------------------------------------------------------------------ *
   * Map
   * ------------------------------------------------------------------ */

  function tierClass(t) {
    return t === "critical" ? "t-critical" : t === "watch" ? "t-watch" : "";
  }

  function countyCamera(fips) {
    var c = countyByFips[fips];
    if (!c) return state.camera;
    var b = c.b;
    var w = b[2] - b[0];
    var h = b[3] - b[1];
    var pad = Math.max(9, Math.min(w, h) * 0.16);
    return [b[0] - pad, b[1] - pad, w + pad * 2, h + pad * 2];
  }

  function setCamera(box, animate) {
    state.camera = box;
    var target = box.map(function (v) { return +v.toFixed(1); }).join(" ");
    if (!animate || reducedMotion) {
      els.map.setAttribute("viewBox", target);
      return;
    }
    var vb = els.map.viewBox.baseVal;
    var from = [vb.x, vb.y, vb.width, vb.height];
    var start = performance.now();
    var duration = 340;
    if (setCamera.frame) cancelAnimationFrame(setCamera.frame);

    function tick(now) {
      var t = Math.min(1, (now - start) / duration);
      var e = 1 - Math.pow(1 - t, 3);
      var boxNow = from.map(function (f, i) { return f + (box[i] - f) * e; });
      els.map.setAttribute("viewBox", boxNow.join(" "));
      if (t < 1) setCamera.frame = requestAnimationFrame(tick);
    }
    setCamera.frame = requestAnimationFrame(tick);
  }

  function cityMarkup() {
    return GEO.cities.map(function (c) {
      return '<g class="city"><circle cx="' + c.x + '" cy="' + c.y + '" r="2.2"/>' +
        '<text x="' + (c.x + 5) + '" y="' + (c.y + 3) + '">' + c.n + "</text></g>";
    }).join("");
  }

  function currentActiveKey() {
    var el = document.activeElement;
    if (!el || !el.dataset) return null;
    if (el.dataset.f) return { type: "f", value: el.dataset.f };
    if (el.dataset.z) return { type: "z", value: el.dataset.z };
    return null;
  }

  function renderMap() {
    var focusKey = currentActiveKey();
    var countyView = state.view === "county";
    var wait = state.wait;

    els.countyLayer.innerHTML = GEO.counties.map(function (c) {
      var agg = state.countyAgg[c.f];
      var tier = agg ? agg.tier : "stable";
      var ghost = countyView && c.f !== state.countyFips;
      var dim = wait && agg && agg.avg < wait;
      var cls = ["county", tierClass(tier), ghost ? "ghost" : "", dim ? "dimmed" : ""].filter(Boolean).join(" ");
      var label = c.n + " County. " + (agg ? "Median " + f1(agg.avg) + " minutes. " + cap(tier) + " urgency." : "No service records.") +
        (countyView ? " Switch to this county." : " Open ZIP codes.");
      return '<path class="' + cls + '" d="' + c.d + '" data-f="' + c.f + '" tabindex="' + (countyView ? "-1" : "0") + '" role="button" aria-label="' + escapeHtml(label) + '"/>';
    }).join("");

    if (countyView && modelsByCounty[state.countyFips]) {
      els.zipLayer.innerHTML = modelsByCounty[state.countyFips].map(function (model) {
        var x = state.zMetrics[model.zip];
        var dim = wait && x.avg < wait;
        var cls = ["zip", tierClass(x.tier), dim ? "dimmed" : "", model.zip === state.zip ? "is-selected" : ""].filter(Boolean).join(" ");
        var label = "ZIP " + model.zip + ", " + model.county + " County. Median " + f1(x.avg) + " minutes. " + cap(x.pattern) + " pattern. " + cap(x.tier) + " urgency.";
        return '<path class="' + cls + '" d="' + model.d + '" data-z="' + model.zip + '" tabindex="0" role="button" aria-label="' + escapeHtml(label) + '"/>';
      }).join("");
    } else {
      els.zipLayer.innerHTML = "";
    }

    var county = countyView ? countyByFips[state.countyFips] : null;
    els.outlineLayer.innerHTML = county ? '<path class="county-outline" d="' + county.d + '"/>' : "";
    els.countyClipPath.setAttribute("d", county ? county.d : "");
    els.cityLayer.innerHTML = countyView ? "" : cityMarkup();

    if (focusKey) {
      var selector = focusKey.type === "f" ? '[data-f="' + focusKey.value + '"]' : '[data-z="' + focusKey.value + '"]';
      var again = els.map.querySelector(selector);
      if (again) again.focus({ preventScroll: true });
    }

    els.backBtn.hidden = state.view === "state";
    els.backBtn.title = state.zip ? "Back to " + countyByFips[state.countyFips].n + " County" : "Back to New York State";
    els.backBtn.setAttribute("aria-label", els.backBtn.title);

    renderBreadcrumb();
  }

  function renderBreadcrumb() {
    var html = "";
    if (state.view === "state") {
      html = '<span class="crumb-now">New York State</span>';
    } else if (state.zip) {
      html = '<button type="button" data-crumb="state">New York State</button>' + icon("chev-right") +
        '<button type="button" data-crumb="county">' + escapeHtml(countyByFips[state.countyFips].n) + " County</button>" + icon("chev-right") +
        '<span class="crumb-now">ZIP ' + state.zip + "</span>";
    } else {
      html = '<button type="button" data-crumb="state">New York State</button>' + icon("chev-right") +
        '<span class="crumb-now">' + escapeHtml(countyByFips[state.countyFips].n) + " County</span>";
    }
    els.breadcrumb.innerHTML = html;
  }

  function insetViewBox() {
    var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    BOROUGH_FIPS.forEach(function (fips) {
      var b = countyByFips[fips].b;
      x1 = Math.min(x1, b[0]); y1 = Math.min(y1, b[1]);
      x2 = Math.max(x2, b[2]); y2 = Math.max(y2, b[3]);
    });
    var cx = (x1 + x2) / 2;
    var cy = (y1 + y2) / 2;
    var side = Math.max(x2 - x1, y2 - y1) * 1.16;
    return [cx - side / 2, cy - side / 2, side, side].map(function (v) { return +v.toFixed(1); }).join(" ");
  }

  function renderInset() {
    var boroughView = state.view === "county" && isBorough(state.countyFips);
    var show = state.view === "state" || boroughView;
    els.insetWrap.hidden = !show;
    if (!show) return;
    els.insetMap.setAttribute("viewBox", insetViewBox());
    els.insetHint.textContent = boroughView ? countyByFips[state.countyFips].n : "Select a borough";
    els.insetBack.hidden = !boroughView;
    var paths = BOROUGH_FIPS.map(function (fips) {
      var c = countyByFips[fips];
      var agg = state.countyAgg[fips];
      var tier = agg ? agg.tier : "stable";
      var selected = fips === state.countyFips;
      var cls = ["zip", tierClass(tier), selected ? "is-selected" : ""].filter(Boolean).join(" ");
      var label = c.n + " County. " + (agg ? "Median " + f1(agg.avg) + " minutes. " + cap(agg.tier) + " urgency." : "No service records.") + " Select to open ZIP codes.";
      return '<path class="' + cls + '" d="' + c.d + '" data-f="' + fips + '" tabindex="0" role="button" aria-label="' + escapeHtml(label) + '"/>';
    }).join("");
    els.insetMap.innerHTML = paths;
  }

  function renderLegend() {
    var counts = { critical: 0, watch: 0, stable: 0 };
    if (state.view === "state") {
      GEO.counties.forEach(function (c) {
        var a = state.countyAgg[c.f];
        counts[a ? a.tier : "stable"]++;
      });
    } else {
      (modelsByCounty[state.countyFips] || []).forEach(function (m) {
        counts[state.zMetrics[m.zip].tier]++;
      });
    }
    els.legendCritical.textContent = counts.critical;
    els.legendWatch.textContent = counts.watch;
    els.legendStable.textContent = counts.stable;
  }

  function hideMapTip() {
    els.mapTip.classList.remove("is-visible");
  }

  function showMapTip(target, event) {
    var html = "";
    if (target.dataset.f) {
      var c = countyByFips[target.dataset.f];
      var agg = state.countyAgg[target.dataset.f];
      if (!c || !agg) return;
      var dim = state.wait && agg.avg < state.wait;
      html = "<strong>" + escapeHtml(c.n) + " County</strong><span>Median " + f1(agg.avg) + " min · " + cap(agg.tier) + " urgency</span>" +
        (dim ? '<span>Below the ' + state.wait + " min filter</span>" : "");
    } else if (target.dataset.z) {
      var model = modelByZip[target.dataset.z];
      var x = state.zMetrics[target.dataset.z];
      if (!model || !x) return;
      html = "<strong>ZIP " + model.zip + "</strong><span>" + escapeHtml(model.county) + " County · Median " + f1(x.avg) + " min</span>" +
        "<span>" + cap(x.pattern) + " pattern · " + cap(x.tier) + " urgency</span>";
    }
    if (!html) return;
    var card = els.map.getBoundingClientRect();
    var px = event.clientX - card.left;
    var py = event.clientY - card.top;
    var half = 118;
    px = Math.min(Math.max(px, half), card.width - half);
    els.mapTip.innerHTML = html;
    els.mapTip.style.left = px + "px";
    els.mapTip.style.top = Math.max(18, py) + "px";
    els.mapTip.style.transform = py < 78 ? "translate(-50%, 14px)" : "translate(-50%, calc(-100% - 12px))";
    els.mapTip.classList.add("is-visible");
  }

  /* ------------------------------------------------------------------ *
   * Table
   * ------------------------------------------------------------------ */

  var TABLE_COLUMNS = [
    { key: "zip", label: "Zone" },
    { key: "avg", label: "Median" },
    { key: "p90", label: "P90" },
    { key: "delta", label: "Trend", cls: "col-hide-sm" },
    { key: "pattern", label: "Pattern" },
    { key: "stage", label: "Top stage", cls: "col-hide-sm" },
    { key: "tier", label: "Urgency" }
  ];

  function attentionScore(x) {
    return x.avg + x.p90 * 0.38 + Math.max(x.growth - 1, 0) * 14 + (x.pattern === "emerging" ? 2.2 : x.pattern === "persistent" ? 1.1 : 0);
  }

  function tableRows() {
    var models = state.view === "state" ? zipModels : (modelsByCounty[state.countyFips] || []);
    if (state.wait) {
      models = models.filter(function (model) {
        var x = state.zMetrics[model.zip];
        return x && x.avg >= state.wait;
      });
    }
    return models.map(function (model) {
      var x = state.zMetrics[model.zip];
      var total = x.stageMinutes.reduce(function (a, b) { return a + b; }, 0) || 1;
      var top = 0;
      for (var i = 1; i < 4; i++) if (x.stageMinutes[i] > x.stageMinutes[top]) top = i;
      return {
        model: model,
        metric: x,
        zip: model.zip,
        avg: x.avg,
        p90: x.p90,
        delta: x.growth - 1,
        pattern: x.pattern,
        stage: STAGES[top].short,
        stageShare: x.stageMinutes[top] / total,
        tier: x.tier,
        score: attentionScore(x)
      };
    });
  }

  function sortValue(row, key) {
    if (key === "tier") return TIER_ORDER[row.tier];
    if (key === "pattern") return PATTERN_ORDER[row.pattern];
    if (key === "zip") return parseInt(row.zip, 10);
    return row[key];
  }

  function renderTable() {
    var rows = tableRows();
    var key = state.sortKey;
    var dir = state.sortDir;
    rows.sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av === bv) return a.zip.localeCompare(b.zip);
      return av > bv ? dir : -dir;
    });

    var list = state.view === "state" ? rows.slice(0, 250) : rows;
    var totalCount = rows.length;

    if (state.view === "state") {
      els.tableSub.textContent = state.wait
        ? "Zones meeting the " + state.wait + " min wait filter"
        : "Zones ranked by attention need";
      els.tableCount.textContent = "Top " + list.length + " of " + nfInt.format(totalCount) + (state.wait ? " match" : "");
    } else if (state.zip) {
      els.tableSub.textContent = countyByFips[state.countyFips].n + " County · selected ZIP highlighted";
      els.tableCount.textContent = rows.length + (state.wait ? " match" : " ZIPs");
    } else {
      els.tableSub.textContent = countyByFips[state.countyFips].n + " County · " + (state.wait ? "filtered" : "all") + " ZIP codes";
      els.tableCount.textContent = rows.length + (state.wait ? " match" : " ZIPs");
    }

    els.tableHead.innerHTML = "<tr>" + TABLE_COLUMNS.map(function (col) {
      var active = state.sortKey === col.key;
      return '<th' + (col.cls ? ' class="' + col.cls + '"' : "") + (active ? ' aria-sort="' + (state.sortDir > 0 ? "ascending" : "descending") + '"' : "") + ">" +
        '<button type="button" data-sort="' + col.key + '">' + col.label + icon("chev") + "</button></th>";
    }).join("") + "</tr>";

    if (!list.length) {
      els.tableBody.innerHTML = '<tr><td colspan="7"><div class="table-empty">No zones match the current selection.</div></td></tr>';
      return;
    }

    els.tableBody.innerHTML = list.map(function (row) {
      var deltaCls = row.delta > 0.005 ? "bad" : row.delta < -0.005 ? "good" : "flat";
      return '<tr tabindex="0" data-zip="' + row.zip + '"' + (row.zip === state.zip ? ' class="is-selected" aria-current="true"' : "") + ">" +
        '<td><span class="cell-zone">' + row.zip + "<span>" + escapeHtml(row.model.county) + " County</span></span></td>" +
        '<td class="num">' + f1(row.avg) + ' <span class="num-sub">min</span></td>' +
        '<td class="num">' + f1(row.p90) + ' <span class="num-sub">min</span></td>' +
        '<td class="delta-cell ' + deltaCls + ' col-hide-sm">' + pct(row.delta) + "</td>" +
        '<td><span class="pattern-chip pattern-' + row.pattern + '">' + cap(row.pattern) + "</span></td>" +
        '<td class="stage-cell col-hide-sm">' + row.stage + " · " + Math.round(row.stageShare * 100) + "%</td>" +
        '<td><span class="urgency-cell ' + row.tier + '"><i aria-hidden="true"></i>' + cap(row.tier) + "</span></td>" +
        "</tr>";
    }).join("");
  }

  /* ------------------------------------------------------------------ *
   * Search
   * ------------------------------------------------------------------ */

  function closeSearch() {
    els.searchResults.hidden = true;
    els.searchResults.innerHTML = "";
    els.searchInput.setAttribute("aria-expanded", "false");
    els.searchInput.removeAttribute("aria-activedescendant");
    state.searchIndex = -1;
    state.searchItems = [];
  }

  function buildSearch(query) {
    var q = query.trim().toLowerCase();
    state.searchItems = [];
    state.searchIndex = -1;
    if (!q) {
      closeSearch();
      return;
    }

    var items = [];
    if (/^\d+$/.test(q)) {
      GEO.zips.forEach(function (z) {
        if (z.z.indexOf(q) === 0) {
          var metric = state.zMetrics[z.z];
          items.push({
            type: "zip",
            zip: z.z,
            title: "ZIP " + z.z,
            sub: z.c && countyByFips[z.c] ? countyByFips[z.c].n + " County" : "",
            value: metric ? f1(metric.avg) + " min" : ""
          });
        }
      });
      items.sort(function (a, b) { return a.zip.localeCompare(b.zip); });
    } else {
      var norm = q.replace(/[^a-z0-9]/g, "").replace(/county$/, "");
      var matches = GEO.counties.filter(function (c) {
        var name = c.n.toLowerCase();
        var compact = name.replace(/[^a-z0-9]/g, "");
        return name.indexOf(q) !== -1 || (norm && compact.indexOf(norm) === 0);
      });
      matches.sort(function (a, b) {
        var as = a.n.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        var bs = b.n.toLowerCase().indexOf(q) === 0 ? 0 : 1;
        return as - bs || a.n.localeCompare(b.n);
      });
      matches.slice(0, 7).forEach(function (c) {
        var agg = state.countyAgg[c.f];
        items.push({
          type: "county",
          fips: c.f,
          title: c.n + " County",
          sub: (modelsByCounty[c.f] || []).length + " ZIPs",
          value: agg ? f1(agg.avg) + " min" : ""
        });
      });
    }

    items = items.slice(0, 8);
    if (!items.length) {
      els.searchResults.innerHTML = '<div class="search-empty">No New York ZIP or county matches “' + escapeHtml(query.trim()) + "”.</div>";
      els.searchResults.hidden = false;
      els.searchInput.setAttribute("aria-expanded", "true");
      return;
    }

    state.searchItems = items;
    els.searchResults.innerHTML = items.map(function (item, i) {
      return '<button type="button" class="search-option" role="option" id="sr-opt-' + i + '" data-result="' + i + '" aria-selected="false">' +
        '<span><span class="opt-main">' + escapeHtml(item.title) + '</span><span class="opt-sub">' + escapeHtml(item.sub) + "</span></span>" +
        '<span class="opt-val">' + escapeHtml(item.value) + "</span></button>";
    }).join("");
    els.searchResults.hidden = false;
    els.searchInput.setAttribute("aria-expanded", "true");
  }

  function highlightSearch(index) {
    var options = els.searchResults.querySelectorAll(".search-option");
    if (!options.length) return;
    if (index < 0) index = state.searchItems.length - 1;
    if (index >= options.length) index = 0;
    state.searchIndex = index;
    options.forEach(function (opt, i) {
      var active = i === index;
      opt.classList.toggle("is-active", active);
      opt.setAttribute("aria-selected", active ? "true" : "false");
    });
    els.searchInput.setAttribute("aria-activedescendant", "sr-opt-" + index);
    options[index].scrollIntoView({ block: "nearest" });
  }

  function chooseSearch(index) {
    var item = state.searchItems[index];
    if (!item) return;
    els.searchInput.value = "";
    closeSearch();
    if (item.type === "county") {
      selectCounty(item.fips);
    } else {
      selectZip(item.zip);
    }
    els.searchInput.blur();
  }

  /* ------------------------------------------------------------------ *
   * Selection and updates
   * ------------------------------------------------------------------ */

  function updateCharts() {
    hideTrendTip();
    drawTrend();
    drawStages();
  }

  function updateAll() {
    computeAll();
    updateHeader();
    updateMetrics();
    updateSummary();
    updateCharts();
    renderMap();
    renderInset();
    renderLegend();
    renderTable();
    updateLiveRegion();
  }

  function updateLiveRegion() {
    if (state.scopeEmpty) {
      els.liveScope.textContent = scopeTitle() + " has no zones with a median on-scene time of " + state.wait + " minutes or more.";
      return;
    }
    var m = state.scopeMetrics;
    var t = topStage(m);
    els.liveScope.textContent = scopeTitle() + " selected. Median on-scene " + f1(m.avg) + " minutes. " +
      cap(m.pattern) + " pattern. Delay concentrates in " + STAGES[t.index].name.toLowerCase() + ". " +
      m.flagged + " of " + m.zones + " zones are critical.";
  }

  function selectCounty(fips) {
    if (!countyByFips[fips]) return;
    state.view = "county";
    state.countyFips = fips;
    state.zip = null;
    updateAll();
    setCamera(countyCamera(fips), true);
    hideMapTip();
  }

  function selectBoroughFromInset(fips) {
    selectCounty(fips);
    if (els.insetBack && !els.insetBack.hidden) els.insetBack.focus({ preventScroll: true });
  }

  function selectZip(zip) {
    var model = modelByZip[zip];
    if (!model) return;
    var countyChanged = state.countyFips !== model.c;
    state.view = "county";
    state.countyFips = model.c;
    state.zip = model.zip;
    updateAll();
    if (countyChanged) {
      setCamera(countyCamera(model.c), true);
    }
    hideMapTip();
  }

  function backOneLevel() {
    if (state.zip) {
      state.zip = null;
      updateAll();
    } else if (state.countyFips) {
      state.countyFips = null;
      state.view = "state";
      updateAll();
      setCamera(CONTEXT_CAMERA, true);
    }
    hideMapTip();
  }

  function resetMap() {
    state.view = "state";
    state.countyFips = null;
    state.zip = null;
    updateAll();
    setCamera(CONTEXT_CAMERA, true);
    hideMapTip();
  }

  function clearFilters() {
    state.priority = "all";
    state.wait = null;
    els.priority.value = "all";
    els.wait.value = "";
    els.wait.removeAttribute("aria-invalid");
    els.wait.title = "0 = no minimum";
    els.resetFilters.hidden = true;
    updateAll();
  }

  /* ------------------------------------------------------------------ *
   * Clock
   * ------------------------------------------------------------------ */

  function updateClock() {
    try {
      var now = new Date();
      var day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" }).format(now);
      var time = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      els.clock.textContent = "New York · " + day + " · " + time;
    } catch (e) {
      els.clock.textContent = "New York State";
    }
  }

  /* ------------------------------------------------------------------ *
   * Events
   * ------------------------------------------------------------------ */

  function bindEvents() {
    els.summaryNext.addEventListener("click", function () {
      if (state.scopeEmpty) {
        clearFilters();
        return;
      }
      var target = state.summaryTarget;
      if (!target) return;
      if (target.type === "county") selectCounty(target.id);
      else if (target.type === "zip") selectZip(target.id);
    });

    els.followupBtn.addEventListener("click", function () {
      if (state.scopeEmpty || !state.followupKey) return;
      var key = state.followupKey;
      var next = !state.followups[key];
      if (next) state.followups[key] = true;
      else delete state.followups[key];
      syncFollowup();
      els.followupStatus.textContent = (next ? "Flagged " : "Removed the flag for ") + scopeTitle() + " for follow-up.";
    });

    els.map.addEventListener("click", function (event) {
      var path = event.target.closest("path[data-f], path[data-z]");
      if (!path) return;
      if (path.dataset.f) selectCounty(path.dataset.f);
      else if (path.dataset.z) selectZip(path.dataset.z);
    });

    els.map.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var path = event.target.closest("path[data-f], path[data-z]");
      if (!path) return;
      event.preventDefault();
      if (path.dataset.f) selectCounty(path.dataset.f);
      else if (path.dataset.z) selectZip(path.dataset.z);
    });

    els.map.addEventListener("pointermove", function (event) {
      var path = event.target.closest("path[data-f], path[data-z]");
      if (!path) {
        hideMapTip();
        return;
      }
      showMapTip(path, event);
    });
    els.map.addEventListener("pointerleave", hideMapTip);

    els.insetMap.addEventListener("click", function (event) {
      var path = event.target.closest("path[data-f]");
      if (path) selectBoroughFromInset(path.dataset.f);
    });
    els.insetMap.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var path = event.target.closest("path[data-f]");
      if (!path) return;
      event.preventDefault();
      selectBoroughFromInset(path.dataset.f);
    });
    els.insetBack.addEventListener("click", function () {
      resetMap();
      var first = els.insetMap.querySelector("path[data-f]");
      if (first) first.focus({ preventScroll: true });
    });

    els.backBtn.addEventListener("click", backOneLevel);
    els.resetBtn.addEventListener("click", resetMap);

    els.breadcrumb.addEventListener("click", function (event) {
      var btn = event.target.closest("button[data-crumb]");
      if (!btn) return;
      if (btn.dataset.crumb === "state") {
        resetMap();
      } else if (btn.dataset.crumb === "county") {
        state.zip = null;
        updateAll();
      }
    });

    els.searchInput.addEventListener("input", function () {
      buildSearch(els.searchInput.value);
    });
    els.searchInput.addEventListener("focus", function () {
      if (els.searchInput.value.trim()) buildSearch(els.searchInput.value);
    });
    els.searchInput.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (els.searchResults.hidden) buildSearch(els.searchInput.value);
        highlightSearch(state.searchIndex + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        highlightSearch(state.searchIndex - 1);
      } else if (event.key === "Enter") {
        if (!els.searchResults.hidden) {
          event.preventDefault();
          chooseSearch(state.searchIndex >= 0 ? state.searchIndex : 0);
        }
      } else if (event.key === "Escape") {
        closeSearch();
      }
    });
    els.searchResults.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-result]");
      if (!btn) return;
      chooseSearch(Number(btn.dataset.result));
    });
    document.addEventListener("click", function (event) {
      if (!event.target.closest(".map-search")) closeSearch();
    });

    els.priority.addEventListener("change", function () {
      state.priority = els.priority.value;
      els.resetFilters.hidden = !(state.wait || state.priority !== "all");
      updateAll();
    });

    var waitTimer = null;
    els.wait.addEventListener("input", function () {
      var raw = els.wait.value.trim();
      var val = raw === "" ? null : Number(raw);
      var invalid = val !== null && (isNaN(val) || val < 0 || val > 40);
      if (invalid) val = null;
      els.wait.setAttribute("aria-invalid", invalid ? "true" : "false");
      els.wait.title = invalid ? "Enter a wait threshold between 0 and 40 minutes." : "0 = no minimum";
      state.wait = val && val > 0 ? Math.round(val) : null;
      els.resetFilters.hidden = !(state.wait || state.priority !== "all");
      clearTimeout(waitTimer);
      waitTimer = setTimeout(function () {
        updateAll();
      }, 110);
    });

    els.resetFilters.addEventListener("click", clearFilters);

    els.rangeForm.addEventListener("submit", function (event) {
      event.preventDefault();
      var fromValue = els.dateFrom.value;
      var toValue = els.dateTo.value;
      els.rangeError.hidden = true;
      if (!fromValue || !toValue) {
        els.rangeError.textContent = "Choose both a start and an end date.";
        els.rangeError.hidden = false;
        return;
      }
      if (fromValue < DATA_START_DATE || toValue > DATA_END_DATE) {
        els.rangeError.textContent = "Sample data covers Oct 2023 – Sep 2026.";
        els.rangeError.hidden = false;
        return;
      }
      var from = new Date(fromValue + "T00:00:00Z");
      var to = new Date(toValue + "T00:00:00Z");
      if (from > to) {
        els.rangeError.textContent = "The start date must come before the end date.";
        els.rangeError.hidden = false;
        return;
      }
      var fromIdx = (from.getUTCFullYear() - DATA_START_YEAR) * 12 + (from.getUTCMonth() - DATA_START_MONTH);
      var toIdx = (to.getUTCFullYear() - DATA_START_YEAR) * 12 + (to.getUTCMonth() - DATA_START_MONTH);
      state.fromIdx = Math.max(0, Math.min(35, fromIdx));
      state.toIdx = Math.max(0, Math.min(35, toIdx));
      els.rangeError.hidden = true;
      updateAll();
    });

    els.tableToggle.addEventListener("click", function () {
      state.tableOpen = !state.tableOpen;
      els.tableToggle.setAttribute("aria-expanded", state.tableOpen ? "true" : "false");
      els.tableWrap.hidden = !state.tableOpen;
      if (state.tableOpen) {
        requestAnimationFrame(function () {
          els.tableWrap.scrollTop = 0;
        });
      }
    });

    els.tableHead.addEventListener("click", function (event) {
      var btn = event.target.closest("[data-sort]");
      if (!btn) return;
      var key = btn.dataset.sort;
      if (state.sortKey === key) {
        state.sortDir *= -1;
      } else {
        state.sortKey = key;
        state.sortDir = key === "zip" ? 1 : -1;
      }
      renderTable();
    });

    els.tableBody.addEventListener("click", function (event) {
      var row = event.target.closest("tr[data-zip]");
      if (row) selectZip(row.dataset.zip);
    });
    els.tableBody.addEventListener("keydown", function (event) {
      if (event.key !== "Enter" && event.key !== " ") return;
      var row = event.target.closest("tr[data-zip]");
      if (!row) return;
      event.preventDefault();
      selectZip(row.dataset.zip);
    });

    els.trendChart.addEventListener("pointermove", function (event) {
      if (!trendLayout || !trendLayout.points.length) return;
      var rect = els.trendChart.getBoundingClientRect();
      var x = event.clientX - rect.left;
      var pad = trendLayout.pad;
      if (x < pad.l - 8 || x > trendLayout.w - pad.r + 8) {
        hideTrendTip();
        return;
      }
      var best = trendLayout.points[0];
      trendLayout.points.forEach(function (p) {
        if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
      });
      els.trendTip.innerHTML = "<strong>" + best.label + "</strong> · " + f1(best.value) + " min";
      var left = Math.min(Math.max(best.x, 54), trendLayout.w - 54);
      els.trendTip.style.left = left + "px";
      els.trendTip.style.top = Math.max(best.y, 34) + "px";
      els.trendTip.classList.add("is-visible");
      var line = document.getElementById("trendHoverLine");
      var dot = document.getElementById("trendHoverDot");
      if (line) {
        line.setAttribute("x1", best.x);
        line.setAttribute("x2", best.x);
        line.setAttribute("opacity", "0.55");
      }
      if (dot) {
        dot.setAttribute("cx", best.x);
        dot.setAttribute("cy", best.y);
        dot.setAttribute("opacity", "1");
      }
    });
    els.trendChart.addEventListener("pointerleave", hideTrendTip);

    window.addEventListener("resize", function () {
      drawTrend();
    });

    if (window.ResizeObserver) {
      var ro = new ResizeObserver(function () {
        if (state.scopeMetrics) drawTrend();
      });
      ro.observe(els.trendChart);
    }
  }

  function hideTrendTip() {
    els.trendTip.classList.remove("is-visible");
    var line = document.getElementById("trendHoverLine");
    var dot = document.getElementById("trendHoverDot");
    if (line) line.setAttribute("opacity", "0");
    if (dot) dot.setAttribute("opacity", "0");
  }

  /* ------------------------------------------------------------------ *
   * Init
   * ------------------------------------------------------------------ */

  function init() {
    updateClock();
    setInterval(updateClock, 30000);
    bindEvents();
    state.camera = CONTEXT_CAMERA.slice();
    els.map.setAttribute("viewBox", CONTEXT_CAMERA.join(" "));
    updateAll();
    drawTrend();
  }

  init();
})();
