#!/usr/bin/env bash
set -e

command -v python3 >/dev/null 2>&1 || {
    echo "Python 3 is required. Install it from https://www.python.org/downloads/"
    exit 1
}

PYTHON_VERSION=$(python3 -c 'import sys; print(sys.version_info.major * 10 + sys.version_info.minor)')
if [ "$PYTHON_VERSION" -lt 38 ]; then
    echo "Python 3.8 or newer is required."
    exit 1
fi

echo "==> Installing dependencies..."
python3 -m pip install -r requirements.txt -q

echo "==> Starting Career Positioning Studio on http://127.0.0.1:8000"
echo "    Press Ctrl+C to stop."

# Open browser after a short delay to let the server start
(sleep 1.5 && python3 -m webbrowser "http://127.0.0.1:8000") &

# Bind to loopback only — not exposed on the network
python3 -m uvicorn server:app --host 127.0.0.1 --port 8000
