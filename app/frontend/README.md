# EMS Response Monitor: the page (React + Vite)

Draws the five sections of the mockup from the JSON in `docs/api.md` section B. It computes no statistics; it only formats and draws what `/api/*` returns.

- Run (dev): `npm install && npm run dev` (proxies `/api` and `/geo` to `http://localhost:8000`).
- Build: `npm run build` (writes `dist/`, which FastAPI serves at `/`). Test: `npm test`.
- No API yet? Open the page with `?fixtures=1`: it shows invented numbers from `src/fixtures/`, labelled FIXTURE DATA.
- All requests go through `src/api.js`; the API address is in `src/config.js` (`""` = same origin).
