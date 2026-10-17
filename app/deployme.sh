#!/bin/bash
# deployme.sh - publish to the course Posit Connect server.
# The server address and publisher key come from ENVIRONMENT VARIABLES only; they are
# never read from a file in the repo. Set them in your shell first:
#   export CONNECT_SERVER="<server url handed out at the event>"
#   export CONNECT_API_KEY="<publisher key handed out at the event>"
# Bundle root is the repo root (see manifestme.sh).

set -euo pipefail

: "${CONNECT_SERVER:?Set CONNECT_SERVER in your environment first}"
: "${CONNECT_API_KEY:?Set CONNECT_API_KEY in your environment first}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

python -m pip install rsconnect-python

rsconnect deploy fastapi \
  --server "$CONNECT_SERVER" \
  --api-key "$CONNECT_API_KEY" \
  --entrypoint app.main:app \
  --exclude "demos/*" --exclude "ref/*" --exclude "docs/*" --exclude ".venv/*" \
  --exclude "tests/*" --exclude "app/frontend/node_modules/*" --exclude "app/frontend/src/*" \
  .
