#!/bin/bash
# testme.sh - run OnScene (the EMS response-quality dashboard) locally. One command, no arguments:
#   bash app/testme.sh        (from anywhere; the script finds the repo root itself)
# Then open http://localhost:8000/ (dashboard) or http://localhost:8000/docs (API).
#
# On a fresh clone it first does the one-time setup, so nothing else is needed:
#   1. a Python virtual environment in .venv with app/requirements.txt installed
#   2. the dashboard page built into app/frontend/dist (needs Node.js 18+ and npm)
# Later runs skip both steps and start in a few seconds.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# 1. Python environment (once).
if [ ! -x ".venv/bin/python" ]; then
  PYTHON_BIN="$(command -v python3 || command -v python || true)"
  if [ -z "$PYTHON_BIN" ]; then
    echo "testme: Python 3 is not installed. Install Python 3.11 or newer, then run this again." >&2
    exit 1
  fi
  echo "testme: first run - creating .venv and installing app/requirements.txt (a few minutes, once)..."
  "$PYTHON_BIN" -m venv .venv
  .venv/bin/python -m pip install --quiet --upgrade pip
  .venv/bin/python -m pip install --quiet -r app/requirements.txt
fi
PY=".venv/bin/python"

# 2. Dashboard page (once, or whenever it is missing). The API still runs without it, so a missing Node.js only warns.
if [ ! -f "app/frontend/dist/index.html" ]; then
  if command -v npm >/dev/null 2>&1; then
    echo "testme: building the dashboard page (once)..."
    (cd app/frontend && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run build)
  else
    echo "testme: Node.js/npm not found, so the dashboard page was not built." >&2
    echo "        The API still starts at http://localhost:8000/docs; install Node.js 18+ and run this again for the page." >&2
  fi
fi

PORT="${PORT:-8000}"   # optional: PORT=8001 bash app/testme.sh if 8000 is taken
echo "testme: starting OnScene at http://localhost:${PORT}/  (API docs: http://localhost:${PORT}/docs; stop with Ctrl+C)"
# Absolute imports (from app.qc import ...) need the repo root as the working directory.
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
