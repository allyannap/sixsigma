// The ONE place the API address lives. "" means same origin: the FastAPI app serves
// this page and /api/* and /geo/* from one URL. In dev, vite.config.js proxies them to port 8000.
export const API_BASE = ''
