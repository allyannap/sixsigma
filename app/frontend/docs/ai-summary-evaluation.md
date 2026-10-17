# AI investigation briefing evaluation

Nine cases: seven held-out invented fixtures (different locations and numbers from the prompt examples), plus two real queries over this repo’s synthetic incident files. No patient data. This is prompt/example refinement, not model-weight training.

Rubric: case-specific finding and key evidence, <=110 words, no listed unsupported fatality/operational-command terms. Automated pattern checks are limited; the outputs below must also be read for factual and causal errors.

## Held-out: gap and deterioration

Automated rubric: PASS.

Cedar ZIP area shows a performance gap and recent deterioration. Only 72.5% of 160 valid calls met their targets, and 7 calls exceeded twice their configured target. Review the flagged periods and call records.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 160,
    "on_time_pct": 72.5,
    "spec": "below",
    "control": "out_of_control",
    "queue": "act_now",
    "very_late": 7,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: ongoing gap

Automated rubric: PASS.

Cedar ZIP area has an ongoing performance gap without confirmed recent deterioration. Only 78.3% of 240 valid calls met their targets, and 5 calls exceeded twice their configured target. Review response-stage timing records, such as the dispatch median increase from 60 to 80 seconds, as clues for review.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 240,
    "on_time_pct": 78.3,
    "spec": "below",
    "control": "in_control",
    "queue": "ongoing_gap",
    "very_late": 5,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: recent change, uncertain target

Automated rubric: PASS.

Cedar ZIP area shows recent deterioration, though whether it meets the service goal remains uncertain. Of 90 valid calls, 91.1% were on time, but 3 calls exceeded twice their configured target. Review the flagged periods and call records.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 90,
    "on_time_pct": 91.1,
    "spec": "inconclusive",
    "control": "out_of_control",
    "queue": "recent_change",
    "very_late": 3,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: meets goal without change

Automated rubric: PASS.

Cedar ZIP area meets the service goal with no confirmed recent deterioration. On-time performance was 97.5% for 600 valid calls. Continue monitoring the response-time distribution for emerging delays.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 600,
    "on_time_pct": 97.5,
    "spec": "meets",
    "control": "in_control",
    "queue": "meets_stable",
    "very_late": 0,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: insufficient evidence

Automated rubric: PASS.

Cedar ZIP area has insufficient data to judge goal attainment or recent change. All 17 valid calls arrived within target, but the sample size is too small for a definitive verdict. Review a wider date range or the parent area for additional evidence.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 17,
    "on_time_pct": 100,
    "spec": "inconclusive",
    "control": "insufficient_baseline",
    "queue": "needs_data",
    "very_late": 0,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: confirmed gap, baseline unavailable

Automated rubric: PASS.

Cedar ZIP area has a performance gap, though there is insufficient baseline data to assess recent deterioration. Only 70% of 120 valid calls met their targets, and 9 calls exceeded twice their configured target. Review response-stage timing records, such as the dispatch median increase from 60 to 80 seconds, as clues for review.

Evidence:

```json
{
  "selection": {
    "name": "Cedar ZIP area",
    "level": "zcta",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 120,
    "on_time_pct": 70,
    "spec": "below",
    "control": "insufficient_baseline",
    "queue": "needs_data",
    "very_late": 9,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [],
    "areas_needing_review": 0
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Held-out: local deterioration hidden by county total

Automated rubric: PASS.

Bay ZIP area shows a performance gap and recent deterioration, despite Harbor County meeting its overall goal. In the county, 96.5% of 800 valid calls met targets, but 11 calls exceeded twice their configured target. Review Bay ZIP area's flagged periods and call records.

Evidence:

```json
{
  "selection": {
    "name": "Harbor County",
    "level": "county",
    "id": "test",
    "from": "2026-04-01",
    "to": "2026-04-30",
    "urgency": [
      "red"
    ],
    "source": "Synthetic test fixture"
  },
  "place": {
    "valid": 800,
    "on_time_pct": 96.5,
    "spec": "meets",
    "control": "in_control",
    "queue": "meets_stable",
    "very_late": 11,
    "p95_min": 21.3,
    "baseline": {
      "checked": true,
      "stable": true
    }
  },
  "geography": {
    "top_areas": [
      {
        "id": "test-local",
        "name": "Bay ZIP area",
        "valid": 100,
        "on_time_pct": 65,
        "spec": "below",
        "control": "out_of_control",
        "queue": "act_now",
        "very_late": 6
      }
    ],
    "areas_needing_review": 1
  },
  "stages": {
    "now": {
      "dispatch_s": 80,
      "turnout_s": 100,
      "drive_s": 400,
      "held_pct": 10,
      "n": 160
    },
    "base": {
      "dispatch_s": 60,
      "turnout_s": 90,
      "drive_s": 360,
      "held_pct": 8,
      "n": 200
    }
  },
  "messages": []
}
```

## Real synthetic ZIP: August

Automated rubric: PASS.

Goal attainment for ZIP 11368 remains uncertain, though there is no confirmed recent deterioration. Of 83 valid calls, 96.4% arrived within their response targets. Continue monitoring the response-time distribution for emerging delays.

Evidence:

```json
{
  "selection": {
    "dataset": "station_closure",
    "source": "Synthetic - simulated replay",
    "level": "zcta",
    "id": "11368",
    "name": "11368",
    "from": "2026-08-01",
    "to": "2026-08-31",
    "urgency": [
      "red"
    ],
    "baseline_from": "2026-06-02",
    "baseline_to": "2026-07-31",
    "baseline_days": 60
  },
  "place": {
    "valid": 83,
    "on_time": 80,
    "late": 3,
    "on_time_pct": 96.4,
    "on_time_ci": [
      89.9,
      98.8
    ],
    "goal_pct": 90.0,
    "spec": "inconclusive",
    "spec_reason": "the 95% interval includes the goal",
    "control": "in_control",
    "control_reason": "no month above the upper control limit",
    "queue": "needs_data",
    "watch": false,
    "median_min": 4.53,
    "p95_min": 7.4,
    "p95_ci": [
      6.73,
      14.02
    ],
    "unit": "month",
    "signals": [],
    "baseline": {
      "from": "2026-06-02",
      "to": "2026-07-31",
      "days": 60,
      "valid": 142,
      "stretched": false,
      "enough": true,
      "p_bar": 0.1056,
      "checked": false,
      "stable": true,
      "reasons": [],
      "removed": 0,
      "removed_starts": [],
      "dispersion": {
        "ratio": null,
        "p_value": null,
        "overdispersed": false
      }
    },
    "very_late": 0,
    "excess_late": -5.3
  },
  "messages": [],
  "stages": {
    "selection": {
      "dataset": "station_closure",
      "source": "Synthetic - simulated replay",
      "level": "zcta",
      "id": "11368",
      "name": "11368",
      "from": "2026-08-01",
      "to": "2026-08-31",
      "urgency": [
        "red"
      ],
      "baseline_from": "2026-06-02",
      "baseline_to": "2026-07-31",
      "baseline_days": 60
    },
    "now": {
      "dispatch_s": 38.0,
      "turnout_s": 51.0,
      "drive_s": 173.0,
      "held_pct": 1.2,
      "n": 83
    },
    "base": {
      "dispatch_s": 41.0,
      "turnout_s": 52.0,
      "drive_s": 174.0,
      "held_pct": 2.8,
      "n": 142
    },
    "messages": []
  },
  "geography": {
    "unit": "ZIP area",
    "queue_counts": {
      "act_now": 0,
      "ongoing_gap": 0,
      "recent_change": 0,
      "meets_stable": 0,
      "needs_data": 1
    },
    "chance_below": {
      "expected": 0.04,
      "n_places": 1,
      "observed_below": 0,
      "messages": []
    },
    "areas_needing_review": 0,
    "top_areas": [],
    "ranking": "queue label, then confirmed below target, then excess late calls descending",
    "coverage": "Top three review areas in the selected scope; omitted areas are not necessarily satisfactory."
  }
}
```

## Real synthetic ZIP: September–October

Automated rubric: PASS.

ZIP area 11368 needs review for both a performance gap and recent deterioration. Only 69.1% of 68 valid calls met their targets, and 1 call exceeded twice its configured target. Review the flagged periods and call records for this area.

Evidence:

```json
{
  "selection": {
    "dataset": "station_closure",
    "source": "Synthetic - simulated replay",
    "level": "zcta",
    "id": "11368",
    "name": "11368",
    "from": "2026-09-01",
    "to": "2026-10-15",
    "urgency": [
      "red"
    ],
    "baseline_from": "2026-07-03",
    "baseline_to": "2026-08-31",
    "baseline_days": 60
  },
  "place": {
    "valid": 68,
    "on_time": 47,
    "late": 21,
    "on_time_pct": 69.1,
    "on_time_ci": [
      57.4,
      78.8
    ],
    "goal_pct": 90.0,
    "spec": "below",
    "spec_reason": "upper 95% bound is below the goal",
    "control": "out_of_control",
    "control_reason": "2 month(s) above the upper control limit",
    "queue": "act_now",
    "watch": false,
    "median_min": 6.57,
    "p95_min": 11.19,
    "p95_ci": [
      10.18,
      16.92
    ],
    "unit": "month",
    "signals": [
      {
        "start": "2026-09-01",
        "n": 48,
        "late": 13,
        "p": 0.2708333333333333,
        "ucl": 0.188259834929196,
        "lcl": 0.0,
        "p_value": 3.5e-05
      },
      {
        "start": "2026-10-01",
        "n": 20,
        "late": 8,
        "p": 0.4,
        "ucl": 0.2507172171961165,
        "lcl": 0.0,
        "p_value": 5.29e-05
      }
    ],
    "baseline": {
      "from": "2026-07-03",
      "to": "2026-08-31",
      "days": 60,
      "valid": 161,
      "stretched": false,
      "enough": true,
      "p_bar": 0.0745,
      "checked": false,
      "stable": true,
      "reasons": [],
      "removed": 0,
      "removed_starts": [],
      "dispersion": {
        "ratio": null,
        "p_value": null,
        "overdispersed": false
      }
    },
    "very_late": 1,
    "excess_late": 14.2
  },
  "messages": [],
  "stages": {
    "selection": {
      "dataset": "station_closure",
      "source": "Synthetic - simulated replay",
      "level": "zcta",
      "id": "11368",
      "name": "11368",
      "from": "2026-09-01",
      "to": "2026-10-15",
      "urgency": [
        "red"
      ],
      "baseline_from": "2026-07-03",
      "baseline_to": "2026-08-31",
      "baseline_days": 60
    },
    "now": {
      "dispatch_s": 46.0,
      "turnout_s": 53.0,
      "drive_s": 296.0,
      "held_pct": 0.0,
      "n": 68
    },
    "base": {
      "dispatch_s": 41.0,
      "turnout_s": 51.0,
      "drive_s": 163.0,
      "held_pct": 1.9,
      "n": 161
    },
    "messages": []
  },
  "geography": {
    "unit": "ZIP area",
    "queue_counts": {
      "act_now": 1,
      "ongoing_gap": 0,
      "recent_change": 0,
      "meets_stable": 0,
      "needs_data": 0
    },
    "chance_below": {
      "expected": 0.04,
      "n_places": 1,
      "observed_below": 1,
      "messages": []
    },
    "areas_needing_review": 1,
    "top_areas": [],
    "ranking": "queue label, then confirmed below target, then excess late calls descending",
    "coverage": "Top three review areas in the selected scope; omitted areas are not necessarily satisfactory."
  }
}
```
