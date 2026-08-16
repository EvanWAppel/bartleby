#!/usr/bin/env bash
set -Eeuo pipefail

readonly gateway_port="${PORT:-8080}"
readonly database_path="${BARTLEBY_DB_PATH:-/data/bartleby.db}"

mkdir -p "$(dirname "${database_path}")" /tmp/caddy-config /tmp/caddy-data
chown -R node:node "$(dirname "${database_path}")" /tmp/caddy-config /tmp/caddy-data

declare -a child_pids=()
declare -a child_names=()

start_child() {
  local name="$1"
  shift
  "$@" &
  child_pids+=("$!")
  child_names+=("${name}")
  printf 'started %s (pid %s)\n' "${name}" "$!"
}

shutdown() {
  trap - EXIT INT TERM
  if ((${#child_pids[@]} > 0)); then
    kill -TERM "${child_pids[@]}" 2>/dev/null || true
    wait "${child_pids[@]}" 2>/dev/null || true
  fi
}
trap shutdown EXIT INT TERM

start_child \
  server \
  gosu node env \
  PORT=1234 \
  HTTP_PORT=3000 \
  BARTLEBY_BIND_ADDRESS=127.0.0.1 \
  BARTLEBY_DB_PATH="${database_path}" \
  node /app/server/dist/index.js

start_child \
  web \
  gosu node env \
  PORT=3001 \
  HOST=127.0.0.1 \
  ORIGIN="${PUBLIC_BASE_URL:-http://127.0.0.1:${gateway_port}}" \
  BARTLEBY_HTTP_URL=http://127.0.0.1:3000 \
  node /app/web/build

start_child \
  gateway \
  gosu node env \
  PORT="${gateway_port}" \
  XDG_CONFIG_HOME=/tmp/caddy-config \
  XDG_DATA_HOME=/tmp/caddy-data \
  caddy run --config /app/ops/Caddyfile.railway --adapter caddyfile

set +e
wait -n "${child_pids[@]}"
status=$?
set -e

for index in "${!child_pids[@]}"; do
  pid="${child_pids[$index]}"
  if ! kill -0 "${pid}" 2>/dev/null; then
    printf '%s exited with status %s; stopping service\n' "${child_names[$index]}" "${status}" >&2
    break
  fi
done

exit "${status}"
