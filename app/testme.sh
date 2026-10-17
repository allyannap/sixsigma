#!/bin/bash
# testme.sh - run the EMS Response Monitor locally. One command, no arguments:
#   bash app/testme.sh        (from the repo root; the script finds the root itself)
# Then open http://localhost:8000/docs (API) or http://localhost:8000/ (page, once built).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PY=python
if [ -x ".venv/bin/python" ]; then PY=".venv/bin/python"; fi

# Absolute imports (from app.qc import ...) need the repo root as the working directory.
"$PY" -m uvicorn app.main:app --host 0.0.0.0 --port 8000
