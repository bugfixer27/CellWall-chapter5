#!/bin/zsh
# Double-click to run MEMBRANE locally. Close this window (or press Ctrl-C)
# to stop the server; nothing keeps running in the background.
cd "$(dirname "$0")"
if [ ! -d node_modules ]; then
  echo "Installing dependencies (first run only)…"
  npm install || exit 1
fi
PORT=5179
OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null)
[ -n "$OLD" ] && kill $OLD 2>/dev/null
( sleep 1.5; open -a "Google Chrome" "http://localhost:$PORT" 2>/dev/null || open "http://localhost:$PORT" ) &
trap 'kill 0' EXIT INT TERM
npx vite --port $PORT --strictPort
