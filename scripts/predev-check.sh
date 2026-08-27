#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RavalAI — predev sanity check
# ─────────────────────────────────────────────────────────────────────────────
# Automatically runs before `npm run dev` (via the "predev" npm script).
# Does NOT block the dev server — just prints a loud warning if something is
# misconfigured, so the developer sees the issue immediately instead of
# wondering why /login "doesn't work" (it actually loads, but auth silently
# fails because the Supabase client is using placeholder values).
#
# Checks:
#   1. .env exists
#   2. .env has real values (no YOUR_PROJECT_REF etc.)
#   3. node_modules exists
#   4. The SDR tunnel (if configured) is reachable
# ─────────────────────────────────────────────────────────────────────────────

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Colors
if [ -t 1 ]; then
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  YELLOW=''; RED=''; GREEN=''; CYAN=''; BOLD=''; RESET=''
fi

WARNINGS=0
ERRORS=0

warn() { echo -e "${YELLOW}⚠ $*${RESET}"; WARNINGS=$((WARNINGS + 1)); }
fail() { echo -e "${RED}✗ $*${RESET}"; ERRORS=$((ERRORS + 1)); }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }

echo -e "${CYAN}▶ Predev check (raval)${RESET}"

# ── 1. .env file ─────────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  fail ".env is MISSING — auth will fail silently"
  echo -e "    ${BOLD}Fix:${RESET}  cp .env.example .env && edit .env with real values"
  echo -e "    Or run: ${CYAN}npm run setup${RESET}"
else
  ok ".env exists"
  # Check for placeholders
  PLACEHOLDER_COUNT=$(grep -cE "YOUR_PROJECT_REF|YOUR_PUBLISHABLE|YOUR_SERVICE_ROLE|your-openrouter" .env 2>/dev/null || echo 0)
  if [ "$PLACEHOLDER_COUNT" -gt 0 ]; then
    fail ".env contains $PLACEHOLDER_COUNT placeholder value(s) — auth will fail"
    echo -e "    ${BOLD}Fix:${RESET}  Edit .env and replace YOUR_* with real credentials"
    echo -e "    Get real values from a teammate or 1Password"
  fi
fi

# ── 2. node_modules ──────────────────────────────────────────────────────────
if [ ! -d node_modules ]; then
  fail "node_modules is MISSING — vite will not start"
  echo -e "    ${BOLD}Fix:${RESET}  npm install"
else
  ok "node_modules installed"
fi

# ── 3. SDR reachability (non-blocking) ──────────────────────────────────────
if [ -f .env ]; then
  SDR_URL=$(grep -E "^SDR_BASE_URL=" .env | cut -d'=' -f2- | tr -d '"' | tr -d "'" || echo "")
  if [ -n "$SDR_URL" ] && [ "$SDR_URL" != "https://YOUR_PROJECT_REF.supabase.co" ]; then
    # Quick HEAD check with short timeout
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$SDR_URL/health" 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
      ok "SDR reachable at $SDR_URL"
    elif [ "$HTTP_CODE" = "000" ]; then
      warn "SDR not reachable at $SDR_URL (network/timeout) — proxy calls will fail"
    else
      warn "SDR at $SDR_URL returned HTTP $HTTP_CODE"
    fi
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}═══════════════════════════════════════════════════════════${RESET}"
  echo -e "${RED}  $ERRORS critical issue(s) found — fix before continuing${RESET}"
  echo -e "${RED}═══════════════════════════════════════════════════════════${RESET}"
  echo ""
  echo -e "  ${BOLD}Quick fix:${RESET}  ${CYAN}npm run setup${RESET}"
  echo ""
  echo -e "  ${BOLD}If you see '404' on /login:${RESET}"
  echo -e "  The page actually loads, but the Supabase client is misconfigured"
  echo -e "  (placeholder values in .env). The form will submit but the auth"
  echo -e "  request fails silently and the app redirects you in a loop."
  echo ""
  # Don't exit non-zero — let vite start so the dev can see the 404 themselves
  # and read the warning. Returning 0 is the right call here.
fi

if [ $WARNINGS -gt 0 ] && [ $ERRORS -eq 0 ]; then
  echo -e "${YELLOW}  $WARNINGS warning(s) — non-blocking, but worth fixing${RESET}"
  echo ""
fi

exit 0  # Always allow dev to start; warnings are advisory
