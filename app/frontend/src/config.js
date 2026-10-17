// Use paths relative to the app mount. Posit Connect serves content under
// /content/<id>/, so root-absolute /api and /geo requests escape the app and 404.
// Vite proxies these relative paths to FastAPI during local development.
export const API_BASE = '.'
