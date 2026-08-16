#!/usr/bin/env bash

set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DATA_DIR="$ROOT/.dev-data"
COOKIE_JAR=$(mktemp "${TMPDIR:-/tmp}/bartleby-demo-cookie.XXXXXX")
SERVER_LOG="$DATA_DIR/demo-server.log"
WEB_LOG="$DATA_DIR/demo-web.log"
SERVER_PID=""
WEB_PID=""

DEMO_EMAIL="demo@bartleby.local"
DEMO_TITLE="Web + TUI live demo"
SESSION_SECRET="dev-local-session-secret-change-me-0123456789"
HTTP_URL="http://127.0.0.1:3000"
WEB_URL="http://127.0.0.1:5173"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
  fi
  wait "$WEB_PID" 2>/dev/null || true
  wait "$SERVER_PID" 2>/dev/null || true
  rm -f "$COOKIE_JAR"
  exit "$status"
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url=$1
  local pid=$2
  local log_file=$3
  local label=$4

  for _ in {1..120}; do
    if curl --silent --show-error --output /dev/null "$url" 2>/dev/null; then
      return
    fi
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '%s failed to start. Log follows:\n' "$label" >&2
      cat "$log_file" >&2
      wait "$pid"
    fi
    sleep 0.25
  done

  printf '%s did not become ready within 30 seconds. Log follows:\n' "$label" >&2
  cat "$log_file" >&2
  return 1
}

mkdir -p "$DATA_DIR"

(
  cd "$ROOT/server"
  exec env \
    PORT=1234 \
    HTTP_PORT=3000 \
    BARTLEBY_BIND_ADDRESS=127.0.0.1 \
    BARTLEBY_DB_PATH=../.dev-data/bartleby.db \
    PUBLIC_BASE_URL="$WEB_URL" \
    SESSION_SECRET="$SESSION_SECRET" \
    BARTLEBY_ALLOWED_EMAILS="$DEMO_EMAIL" \
    GOOGLE_CLIENT_ID=dev-placeholder-client-id \
    GOOGLE_CLIENT_SECRET=dev-placeholder-client-secret \
    ALLOW_TEST_SIGN_IN=true \
    ./node_modules/.bin/tsx src/index.ts
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

(
  cd "$ROOT/web"
  exec env \
    BARTLEBY_HTTP_PORT=3000 \
    SESSION_SECRET="$SESSION_SECRET" \
    BARTLEBY_ALLOWED_EMAILS="$DEMO_EMAIL" \
    ALLOW_TEST_SIGN_IN=true \
    ./node_modules/.bin/vite dev --host 127.0.0.1
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

wait_for_url "$HTTP_URL/" "$SERVER_PID" "$SERVER_LOG" "server"
wait_for_url "$WEB_URL/login" "$WEB_PID" "$WEB_LOG" "web client"

curl --fail --silent --show-error \
  --cookie-jar "$COOKIE_JAR" \
  --header 'content-type: application/json' \
  --data "{\"email\":\"$DEMO_EMAIL\",\"displayName\":\"Demo User\"}" \
  "$HTTP_URL/auth/dev/sign-in" >/dev/null

notes=$(curl --fail --silent --show-error --cookie "$COOKIE_JAR" "$HTTP_URL/notes")
note_id=$(jq --raw-output --arg title "$DEMO_TITLE" \
  '[.notes[] | select(.title == $title)][0].id // empty' <<<"$notes")

if [[ -z "$note_id" ]]; then
  created=$(curl --fail --silent --show-error \
    --cookie "$COOKIE_JAR" \
    --header 'content-type: application/json' \
    --data "{\"title\":\"$DEMO_TITLE\"}" \
    "$HTTP_URL/notes")
  note_id=$(jq --exit-status --raw-output '.id | select(type == "string" and length > 0)' \
    <<<"$created")
fi

device=$(curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data '{}' \
  "$HTTP_URL/auth/device/start")
device_code=$(jq --exit-status --raw-output \
  '.device_code | select(type == "string" and length > 0)' <<<"$device")
user_code=$(jq --exit-status --raw-output \
  '.user_code | select(type == "string" and length > 0)' <<<"$device")

curl --fail --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --header 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode "user_code=$user_code" \
  "$HTTP_URL/device/approve" >/dev/null

tokens=$(curl --fail --silent --show-error \
  --header 'content-type: application/json' \
  --data "{\"device_code\":\"$device_code\"}" \
  "$HTTP_URL/auth/device/poll")
access_token=$(jq --exit-status --raw-output \
  '.access_token | select(type == "string" and length > 0)' <<<"$tokens")

cat <<EOF

Bartleby demo is ready.

1. Open $WEB_URL/n/$note_id
2. Use the prefilled "Dev sign in" form.

Both clients are opening: $DEMO_TITLE
Exit the TUI with Ctrl+Q to stop the demo stack.

EOF

export BARTLEBY_HTTP_URL="$HTTP_URL"
export BARTLEBY_NOTE_ID="$note_id"
export BARTLEBY_ACCESS_TOKEN="$access_token"
cd "$ROOT/tui"
uv run bartleby-tui
