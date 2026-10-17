# OnScene page design (Open Design "Sentinel EMS" prototype)

- **Source:** an Open Design export sent to the team as `newest_prototype.zip`, plus the team's logo file
  `onscene-logo.html` (the OnScene siren; rings on hover). Pulled Oct 17, 2026 for task H-15.
- **What the screen is for:** the one-page dashboard for the quality supervisor: New York map with search,
  drill-down and a ranked table on the left; selected place, date range, Key Metrics and two chart cards on the right.
- **Numbers in the prototype are invented** by `assets/app.js`. The implementation in `app/frontend/` takes only the
  layout, tokens and interactions and reads every number from `/api/*`.
- Open `index.html` through any static server to view it; `prototype-1440.png` is a screenshot at 1440 x 900.
- Left out of the export on purpose: an older nested zip and three third-party inspiration screenshots.

Team decisions (Oct 17; `docs/plan.md`): name OnScene with the siren logo; map Critical = Act now, Watch = Ongoing gap +
Recent change, Stable = Meets goal (no change signal), gray = Needs more data; Priority = urgency red/yellow/green; no
"on-scene wait >=" filter; dataset picker and replay in the top bar; Key Metrics shows real on-time, median and P95 numbers
and a plain (not AI) summary; chart card 1 "Are calls arriving on time?" = the geographic comparison; chart card 2 "Are late
calls being unusually frequent?" = the existing p chart section as a stand-in until the team designs it.
