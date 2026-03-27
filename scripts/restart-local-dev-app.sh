#!/bin/sh
set -eu

APP_PATH="${1:-src-tauri/target/release/bundle/macos/Codex Monitor Dev.app}"
APP_NAME="${2:-Codex Monitor Dev}"
APP_EXEC="$APP_PATH/Contents/MacOS/codex-monitor"
QUIT_TIMEOUT_SECONDS="${QUIT_TIMEOUT_SECONDS:-15}"
LAUNCH_TIMEOUT_SECONDS="${LAUNCH_TIMEOUT_SECONDS:-15}"

if [ ! -x "$APP_EXEC" ]; then
  echo "App executable not found: $APP_EXEC" >&2
  exit 1
fi

osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true

quit_waited=0
while pgrep -f "$APP_EXEC" >/dev/null 2>&1; do
  quit_waited=$((quit_waited + 1))
  if [ "$quit_waited" -ge "$QUIT_TIMEOUT_SECONDS" ]; then
    pkill -f "$APP_EXEC" >/dev/null 2>&1 || true
    break
  fi
  sleep 1
done

open -n "$APP_PATH"

launch_waited=0
while ! pgrep -f "$APP_EXEC" >/dev/null 2>&1; do
  launch_waited=$((launch_waited + 1))
  if [ "$launch_waited" -ge "$LAUNCH_TIMEOUT_SECONDS" ]; then
    echo "Failed to relaunch $APP_NAME from $APP_PATH" >&2
    exit 1
  fi
  sleep 1
done

echo "Relaunched $APP_NAME from $APP_PATH"
