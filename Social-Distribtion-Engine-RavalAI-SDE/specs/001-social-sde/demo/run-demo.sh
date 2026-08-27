#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════
# RavalAI SDE — Automated Demo Script
#
# This script demonstrates the core functionality of the Social
# Distribution Engine end-to-end without requiring real API access.
#
# Prerequisites:
#   - Docker Compose stack running
#   - Python venv activated
#   - Python dependencies installed (httpx)
#
# Usage:
#   bash specs/001-social-sde/demo/run-demo.sh
# ═══════════════════════════════════════════════════════════════════════

API_URL="${SDE_URL:-http://localhost:8000}"
TOKEN="${SDE_API_TOKEN}"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check() {
    local name="$1"
    local result="$2"
    if [[ "$result" == "0" ]]; then
        echo -e "  ${GREEN}✓${NC} $name"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${NC} $name"
        FAIL=$((FAIL + 1))
    fi
}

run_check() {
    local name="$1"
    shift
    if "$@" > /dev/null 2>&1; then
        check "$name" 0
    else
        check "$name" 1
    fi
}

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  RavalAI SDE — End-to-End Demo"
echo "  $(date -u)"
echo "══════════════════════════════════════════════════════════"
echo ""

# Verify API is running
if ! curl -sf "$API_URL/healthz" > /dev/null 2>&1; then
    echo -e "${RED}API not reachable at $API_URL${NC}"
    echo "Start stack: docker-compose up -d"
    exit 1
fi
echo -e "${YELLOW}API reachable at $API_URL${NC}"
echo ""

# ─── 1. Health Check ────────────────────────────────────────────────
echo -e "${YELLOW}[1/8] Health Check${NC}"
# Capture the health body, then parse it (the previous `run_check ... | python3`
# pipe fed run_check's /dev/null-redirected output into python → empty stdin →
# JSONDecodeError → `set -o pipefail` aborted the whole demo. This form is safe.)
HEALTH_BODY=$(curl -sf "$API_URL/healthz" 2>/dev/null || true)
if echo "$HEALTH_BODY" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='healthy'" 2>/dev/null; then
  check "Health endpoint" 0
else
  check "Health endpoint" 1
fi
echo ""

# ─── 2. Publish Immediately ─────────────────────────────────────────
echo -e "${YELLOW}[2/8] Publishing Immediately${NC}"
JOB_ID=$(curl -sf -X POST "$API_URL/api/v1/publish" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "idempotency_key": "demo-immediate-1",
        "targets": [
            {"account_id": "test-account-1", "content": {"text": "Hello from RavalAI demo!"}}
        ]
    }' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
check "Publish returns job_id" $([ -n "$JOB_ID" ]; echo $?)
echo "  Job ID: $JOB_ID"
echo ""

# ─── 3. Get Job Status ──────────────────────────────────────────────
echo -e "${YELLOW}[3/8] Getting Job Status${NC}"
STATUS=$(curl -sf "$API_URL/api/v1/jobs/$JOB_ID" \
    -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
check "Job status is published" $([ "$STATUS" == "published" ]; echo $?)
echo "  Status: $STATUS"
echo ""

# ─── 4. Idempotency ─────────────────────────────────────────────────
echo -e "${YELLOW}[4/8] Testing Idempotency${NC}"
DUP_ID=$(curl -sf -X POST "$API_URL/api/v1/publish" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "idempotency_key": "demo-immediate-1",
        "targets": [
            {"account_id": "test-account-1", "content": {"text": "Hello from RavalAI demo!"}}
        ]
    }' | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
check "Idempotency returns same job_id" $([ "$DUP_ID" == "$JOB_ID" ]; echo $?)
echo ""

# ─── 5. Schedule ────────────────────────────────────────────────────
echo -e "${YELLOW}[5/8] Scheduling a Post${NC}"
FUTURE=$(python3 -c "from datetime import datetime,timedelta,timezone; print((datetime.now(timezone.utc)+timedelta(hours=2)).isoformat())")
SCHED_ID=$(curl -sf -X POST "$API_URL/api/v1/schedule" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"idempotency_key\": \"demo-schedule-1\",
        \"scheduled_at\": \"$FUTURE\",
        \"targets\": [
            {\"account_id\": \"test-account-1\", \"content\": {\"text\": \"Scheduled demo post!\"}}
        ]
    }" | python3 -c "import sys,json; print(json.load(sys.stdin)['job_id'])")
check "Schedule creates job" $([ -n "$SCHED_ID" ]; echo $?)
echo ""

# ─── 6. Cancel Scheduled Post ───────────────────────────────────────
echo -e "${YELLOW}[6/8] Cancelling Scheduled Post${NC}"
cancel_code=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API_URL/api/v1/jobs/$SCHED_ID" \
    -H "Authorization: Bearer $TOKEN")
check "Cancel returns 204" $([ "$cancel_code" == "204" ]; echo $?)
echo ""

# ─── 7. Error Handling (Auth Rejection) ─────────────────────────────
echo -e "${YELLOW}[7/8] Testing Error Handling${NC}"
auth_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/api/v1/publish" \
    -H "Content-Type: application/json" \
    -d '{"idempotency_key":"demo-bad-auth","targets":[{"account_id":"test","content":{"text":"test"}}]}')
check "Auth rejection returns 401" $([ "$auth_code" == "401" ]; echo $?)
echo ""

# ─── 8. Multi-Target Publish ────────────────────────────────────────
echo -e "${YELLOW}[8/8] Multi-Target Publish${NC}"
TARGET_COUNT=$(curl -sf -X POST "$API_URL/api/v1/publish" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "idempotency_key": "demo-multi-1",
        "targets": [
            {"account_id": "acc-1", "content": {"text": "Post to platform 1"}},
            {"account_id": "acc-2", "content": {"text": "Post to platform 2"}},
            {"account_id": "acc-3", "content": {"text": "Post to platform 3"}}
        ]
    }' | python3 -c "import sys,json; print(len(json.load(sys.stdin)['targets']))")
check "Multi-target creates $TARGET_COUNT targets" $([ "$TARGET_COUNT" == "3" ]; echo $?)
echo ""

# ─── Summary ────────────────────────────────────────────────────────
TOTAL=$((PASS + FAIL))
echo "══════════════════════════════════════════════════════════"
echo -e "  Results: ${GREEN}$PASS passed${NC} / ${RED}$FAIL failed${NC} / $TOTAL total"
if [ "$FAIL" -eq 0 ]; then
    echo -e "  ${GREEN}✓ DEMO COMPLETE — ALL CHECKS PASSED${NC}"
else
    echo -e "  ${RED}✗ DEMO INCOMPLETE — $FAIL CHECKS FAILED${NC}"
    exit 1
fi
echo "══════════════════════════════════════════════════════════"
