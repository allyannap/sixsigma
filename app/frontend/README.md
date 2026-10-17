# EMS Response Monitor: the page (React + Vite)

Draws the read-only dashboard from the JSON in `docs/api.md` section B. It computes no statistics, has no incident-entry form and no what-if card.

- **Replay bar** (Simulation / Replay): fixed start and baseline (Aug 25, or Jun 25 for `summer_surge`, unless a From date is set); the end date advances one simulated day every 3 s (`/api/replay`).
- **Summary** (`/api/summary`): places needing review split into recent signal (Act now + Recent change) and ongoing gap, with the number expected Below target by chance; on-time k of n with CI; median and P95 with intervals; calls, cancelled, invalid, cancel %, calls per day.
- **(1) Map + ranked areas**: separate Target and Control badges, a "watch" chip for one unconfirmed signal, queue label ("Meets goal; no change signal" for meets + in control), rows ranked within a label by excess late calls vs the goal, baseline stability.
- **(2) Has the process changed?** (`/api/pchart`, `/api/stages`, `/api/signal_calls`, optional `/api/imr`): p chart with exact p-values, the calls behind a signal, a descriptive stage-median table (period vs baseline, % held).
- **(3) Investigation list**: flagged places of the current view plus the statewide flagged-ZIP list (`/api/flagged`).
- **(4) Geographic comparison** (secondary, `/api/anom`): above / below the call-weighted average, descriptive only.
- **Footer**: the response-clock-start caveat (`t_received` meaning is provisional) and that the targets are NFPA 1720-based placeholders.

Commands:

- Run (dev): `npm install && npm run dev` (proxies `/api` and `/geo` to `http://localhost:8000`).
- Build: `npm run build` (writes `dist/`, which FastAPI serves at `/`). Test: `npm test`.
- No API yet? Open the page with `?fixtures=1`: it shows saved, trimmed API replies from `src/fixtures/`, labelled FIXTURE DATA.
- All requests go through `src/api.js`; the API address is in `src/config.js` (`""` = same origin).
