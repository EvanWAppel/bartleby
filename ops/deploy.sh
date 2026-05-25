#!/usr/bin/env bash
# Deploy Bartleby to the VPS via SSH.
#
# Usage:
#   BARTLEBY_DEPLOY_HOST=youruser@bartleby.example.com ops/deploy.sh
#
# Idempotent: re-running on an up-to-date repo is a no-op (compose
# detects no rebuild needed). Safe to run repeatedly.

set -euo pipefail

: "${BARTLEBY_DEPLOY_HOST:?BARTLEBY_DEPLOY_HOST must be set (e.g. user@host)}"

REPO_DIR="${BARTLEBY_DEPLOY_DIR:-bartleby}"
BRANCH="${BARTLEBY_DEPLOY_BRANCH:-main}"

ssh -o StrictHostKeyChecking=accept-new "${BARTLEBY_DEPLOY_HOST}" bash -se <<EOF
set -euo pipefail

cd "${REPO_DIR}"

echo "▸ git fetch && checkout ${BRANCH}"
git fetch --quiet origin
git checkout "${BRANCH}"
before=\$(git rev-parse HEAD)
git pull --ff-only --quiet origin "${BRANCH}"
after=\$(git rev-parse HEAD)

if [ "\${before}" = "\${after}" ]; then
  echo "↳ repo already up to date at \${after}"
else
  echo "▸ updated \${before} → \${after}"
fi

echo "▸ docker compose up -d --build"
docker compose -f ops/docker-compose.yml up -d --build

echo "▸ healthcheck"
# Give the stack ~60s to settle, then verify both services.
for i in \$(seq 1 12); do
  status=\$(docker compose -f ops/docker-compose.yml ps --format json bartleby 2>/dev/null | head -1)
  if echo "\${status}" | grep -q '"Health":"healthy"'; then
    echo "↳ bartleby healthy after \${i} attempt(s)"
    break
  fi
  sleep 5
done

if ! echo "\${status}" | grep -q '"Health":"healthy"'; then
  echo "✗ bartleby did not become healthy. Last status: \${status}"
  docker compose -f ops/docker-compose.yml logs --tail 30 bartleby
  exit 1
fi

echo "✓ deploy complete"
EOF
