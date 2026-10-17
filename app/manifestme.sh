#!/bin/bash
# manifestme.sh - write manifest.json for Posit Connect.
# The app imports "app.main", so the bundle root is the REPO ROOT (not app/):
# the manifest is written there and lists app/, config/, data/, geo/.
# NOTE for H-06: rsconnect reads dependencies from a requirements.txt in the bundle root;
# copy app/requirements.txt there before deploying (this task does not own root files).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

python -m pip install rsconnect-python

echo "Writing manifest.json for the FastAPI app..."
rsconnect write-manifest fastapi \
  --entrypoint app.main:app \
  --exclude "demos/*" --exclude "ref/*" --exclude "docs/*" --exclude ".venv/*" \
  --exclude "tests/*" --exclude "app/frontend/node_modules/*" --exclude "app/frontend/src/*" \
  .

echo "Done. manifest.json written in: $REPO_ROOT"
