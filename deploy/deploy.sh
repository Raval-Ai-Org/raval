#!/usr/bin/env bash
# Build and roll out the app with automatic rollback (proposal workstream A).
#
#   deploy/deploy.sh            # deploy the current branch HEAD
#   deploy/deploy.sh <git-ref>  # deploy a specific commit/tag
#
# Each build is tagged mellox-app:<short-sha>. The previous tag is kept in
# .deploy/current; if the new container isn't healthy within the timeout the
# previous image is started again and the script exits non-zero.
set -euo pipefail

cd "$(dirname "$0")/.."
REF="${1:-}"
STATE_DIR=".deploy"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
mkdir -p "$STATE_DIR"

if [[ ! -f .env ]]; then
  echo ".env is missing (see docs/DEPLOYMENT.md)." >&2
  exit 1
fi
if [[ "$(stat -c %a .env)" != "600" ]]; then
  echo "Tightening .env permissions to 600."
  chmod 600 .env
fi

git fetch --tags --prune origin
if [[ -n "$REF" ]]; then
  git checkout --detach "$REF"
else
  git pull --ff-only
fi

NEW_TAG="$(git rev-parse --short HEAD)"
PREV_TAG="$(cat "$STATE_DIR/current" 2>/dev/null || true)"

echo "Building mellox-app:$NEW_TAG (previous: ${PREV_TAG:-none})"
APP_IMAGE_TAG="$NEW_TAG" docker compose build app

echo "Starting redis + caddy (no-op if already running)"
docker compose up -d redis caddy

echo "Rolling app to $NEW_TAG"
APP_IMAGE_TAG="$NEW_TAG" docker compose up -d --no-deps app

healthy() {
  local cid status
  cid="$(docker compose ps -q app)"
  [[ -n "$cid" ]] || return 1
  status="$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || echo unknown)"
  [[ "$status" == "healthy" ]]
}

deadline=$((SECONDS + HEALTH_TIMEOUT))
until healthy; do
  if ((SECONDS >= deadline)); then
    echo "New release did not become healthy in ${HEALTH_TIMEOUT}s." >&2
    docker compose logs --tail 80 app >&2 || true
    if [[ -n "$PREV_TAG" ]]; then
      echo "Rolling back to $PREV_TAG" >&2
      APP_IMAGE_TAG="$PREV_TAG" docker compose up -d --no-deps app
    fi
    exit 1
  fi
  sleep 3
done

# Readiness (Supabase, Redis, cron heartbeats) is informative, not a gate:
# a stale heartbeat should alert, not block a fix from shipping.
docker compose exec -T app node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(async r => console.log('ready:', r.status, await r.text())).catch(e => console.log('ready check failed:', e.message))" || true

echo "$NEW_TAG" >"$STATE_DIR/current"
[[ -n "$PREV_TAG" && "$PREV_TAG" != "$NEW_TAG" ]] && echo "$PREV_TAG" >"$STATE_DIR/previous"

# Keep the last 3 app images.
docker image ls mellox-app --format '{{.Tag}}' | grep -vx -e latest -e "$NEW_TAG" -e "${PREV_TAG:-__none__}" | tail -n +2 |
  xargs -r -I{} docker image rm "mellox-app:{}" >/dev/null 2>&1 || true

echo "Deployed mellox-app:$NEW_TAG"
