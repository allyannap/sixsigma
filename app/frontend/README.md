# EMS Response Monitor: the page (React + Vite)

Draws the read-only dashboard from the JSON in `docs/api.md` section B: a replay bar (Simulation / Replay: fixed start and baseline, end date advances one day per tick), (1) map + ranked areas with separate Target and Control badges, (2) p chart with an optional I chart, (3) investigation list, (4) secondary geographic comparison (ANOM). It computes no statistics, has no incident-entry form and no what-if card.

- Run (dev): `npm install && npm run dev` (proxies `/api` and `/geo` to `http://localhost:8000`).
- Build: `npm run build` (writes `dist/`, which FastAPI serves at `/`). Test: `npm test`.
- No API yet? Open the page with `?fixtures=1`: it shows saved, trimmed API replies from `src/fixtures/`, labelled FIXTURE DATA.
- All requests go through `src/api.js`; the API address is in `src/config.js` (`""` = same origin).
