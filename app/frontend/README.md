# EMS Response Monitor: the page (React + Vite)

Draws the read-only dashboard from the JSON in `docs/api.md` section B. It computes no statistics, has no incident-entry form and no what-if card.

- **Call urgency** (Key Metrics): one choice of 1 Most urgent, 2 Urgent or 3 Less urgent (the API's `red`, `yellow`, `green`), shown as numbered chips with a hint that they filter the analysis. Never drawn in red / amber / green: those colours mean map status.
- **Date range** (`DatePicker.jsx`): a small calendar that only offers usable dates. From runs from `earliest_from` (`/api/meta`: the first day with the 60-day baseline before it, Dec 15, 2025) to the chosen To; To runs from the chosen From to the last day of data. The month menu lists only those months, so no out-of-range years appear.
- **Replay bar** (Simulation / Replay): requires an explicit date range; fixed start and baseline at the selected From date, stopping at To or the dataset end; the end date advances one simulated day every 3 s (`/api/replay`).
- **Summary** (`/api/summary`): places needing review split into recent signal (Act now + Recent change) and ongoing gap, with the number expected Below target by chance; on-time k of n with CI; median and P95 with intervals; calls, cancelled, invalid, cancel %, calls per day.
- **(1) Map + ranked areas**: the map is coloured by `mapTier` (Critical, Watch, Near goal, Stable, gray only under 30 valid calls) or, with the legend's Status / Late % switch, by late share (sparse areas faded); separate Target and Control badges, a "watch" chip for one unconfirmed signal, queue label ("Meets goal; no change signal" for meets + in control), rows ranked within a label by excess late calls vs the goal, baseline stability.
- **(2) Are more calls missing their response target?** (`/api/pchart`, `/api/stages`, `/api/signal_calls`): finding first, then a selectable blue trend with a shaded control range and orange unusual-period markers beside a detail card, matching Part 4. Click/tap a point, use left/right arrows, or choose a period to see late calls, the historical rate and the upper limit. Review calls opens the read-only records; switching periods closes them. Both limits are labeled directly (orange upper, green lower), with green outlined points below the lower limit indicating possible improvement; orange outlined points show crossings, and a visible explanation, crossing count and next-period button help locate them. The detail card compares the observed rate with that period’s limit. The Flagged periods table includes every upper/lower crossing and exact-test signal, with direction and statistical-signal status shown separately. Its count matches all highlighted points; the overall control judgment still follows the existing confirmation rule. One tabbed workspace shows Flagged periods, Calls, Stage times or Method; only the active view is rendered. Review calls opens the Calls tab for that period, and selecting another chart point updates that view. There are no nested disclosures. The visible legend, guidance and selected-period card avoid repeated explanations. A watch stays distinct from a confirmed increase; inadequate baselines withhold the chart.
- **(3) Investigation list**: flagged places of the current view plus the statewide flagged-ZIP list (`/api/flagged`).
- **(4) Geographic comparison** (secondary, `/api/anom`): above / below the call-weighted average, descriptive only.
- **Footer**: the response-clock-start caveat (`t_received` meaning is provisional) and that the targets are NFPA 1720-based placeholders.

Commands:

- Run (dev): `npm install && npm run dev` (proxies `/api` and `/geo` to `http://localhost:8000`).
- Build: `npm run build` (writes `dist/`, which FastAPI serves at `/`). Test: `npm test`.
- No API yet? Open the page with `?fixtures=1`: it shows saved, trimmed API replies from `src/fixtures/`, labelled FIXTURE DATA.
- All requests go through `src/api.js`; the API address is in `src/config.js` (`""` = same origin).

Date selection: From and To start blank. Until both dates form a valid range, all four sections show No date selected, KPI numbers and previous analysis are hidden, analytical API requests are skipped, and Start replay is disabled. Clearing either date restores this state immediately. Direct API consumers retain the documented 90-day default.

Visible copy is kept short: concise header and chart guidance, direct control-limit labels, and detailed statistical explanations in the Method tab.

Chart periods use only calls inside the inclusive selected dates. Partial weeks/months show their clipped ranges consistently in tooltips, selectors, cards, flagged rows and call requests. A one-point chart still draws both control limits. Replies for an older date range are discarded.
