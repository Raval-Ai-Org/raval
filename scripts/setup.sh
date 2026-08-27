#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RavalAI — first-time developer setup
# ─────────────────────────────────────────────────────────────────────────────
# Run this once after `git pull` to make sure your local environment is ready.
# Idempotent: safe to run multiple times. Skips steps that are already done.
#
# What it does:
#   1. Copies .env.example → .env (if .env is missing)
#   2. Checks that .env has real values (not placeholders)
#   3. Runs `npm install` if node_modules is missing
#   4. Prints a one-screen status report
#
# Usage:
#   ./scripts/setup.sh
#
# Exit codes:
#   0 = all good, run `npm run dev`
#   1 = missing required env values (need to be set manually)
#   2 = npm install failed
# ─────────────────────────────────────────────────────────────────────────────

set -e

# Resolve the repo root regardless of where the script is run from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# Colors for the status output (no color if not a TTY).
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  YELLOW='\033[0;33m'
  RED='\033[0;31m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; CYAN=''; BOLD=''; RESET=''
fi

step() { echo -e "${CYAN}▶ $*${RESET}"; }
ok()   { echo -e "${GREEN}✓ $*${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $*${RESET}"; }
fail() { echo -e "${RED}✗ $*${RESET}"; }

EXIT_CODE=0

# ─── 1. .env file ────────────────────────────────────────────────────────────
step "Step 1/4: Checking .env file"
if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    cp .env.example .env
    warn ".env was missing — created from .env.example with PLACEHOLDER values"
    warn "You MUST edit .env and replace the placeholders with real values, otherwise:"
    warn "  - /login will appear to work but auth will silently fail (404-style behavior)"
    warn "  - Supabase calls will hit a non-existent project"
    warn "Get the real values from a teammate (Junaid) or from 1Password."
    EXIT_CODE=1
  else
    fail ".env AND .env.example are both missing — something is wrong with your clone"
    exit 1
  fi
else
  ok ".env exists"
fi

# ─── 2. Check .env has real values, not placeholders ─────────────────────────
step "Step 2/4: Verifying .env has real values"
if [ -f .env ]; then
  # grep -c returns a number followed by a newline. Strip the newline so the
  # integer comparison below works on all shells.
  PLACEHOLDER_COUNT=$(grep -cE "YOUR_PROJECT_REF|YOUR_PUBLISHABLE|YOUR_SERVICE_ROLE|your-openrouter|placeholder" .env 2>/dev/null | tr -d '[:space:]' || echo "0")
  if [ -n "$PLACEHOLDER_COUNT" ] && [ "$PLACEHOLDER_COUNT" -gt 0 ] 2>/dev/null; then
    fail ".env contains $PLACEHOLDER_COUNT placeholder value(s)"
    warn "Open .env in your editor and replace the placeholders with real credentials."
    warn "Lines containing placeholders:"
    grep -nE "YOUR_|your-" .env | head -5 | sed 's/^/    /'
    EXIT_CODE=1
  else
    ok ".env has real values (no placeholders detected)"
  fi
fi

# ─── 3. node_modules ─────────────────────────────────────────────────────────
step "Step 3/4: Checking node_modules"
if [ ! -d node_modules ]; then
  warn "node_modules missing — running npm install (this may take 2-3 minutes)"
  if npm install; then
    ok "npm install completed"
  else
    fail "npm install failed — check your internet connection and try again"
    exit 2
  fi
else
  ok "node_modules exists (skipping npm install — run it manually if you have dependency issues)"
fi

# ─── 4. Final report ─────────────────────────────────────────────────────────
step "Step 4/4: Final report"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}  RavalAI local setup status${RESET}"
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
echo ""

if [ -f .env ]; then
  echo -e "  .env file:          ${GREEN}present${RESET}"
  if [ -n "$PLACEHOLDER_COUNT" ] && [ "$PLACEHOLDER_COUNT" -gt 0 ] 2>/dev/null; then
    echo -e "  .env values:        ${RED}placeholders detected${RESET}"
  else
    echo -e "  .env values:        ${GREEN}looks real${RESET}"
  fi
else
  echo -e "  .env file:          ${RED}missing${RESET}"
fi

if [ -d node_modules ]; then
  echo -e "  node_modules:       ${GREEN}installed${RESET}"
else
  echo -e "  node_modules:       ${RED}missing${RESET}"
fi

echo ""
echo -e "${BOLD}Next steps:${RESET}"
echo ""
if [ $EXIT_CODE -eq 0 ]; then
  echo -e "  ${GREEN}→ npm run dev${RESET}    (start the dev server on http://localhost:8080)"
  echo ""
  echo "  Then open http://localhost:8080/login in your browser."
  echo "  Test login: junaidsajjad2298@gmail.com / Junaid@1234"
else
  echo -e "  ${YELLOW}→ Edit .env${RESET}       (replace placeholder values with real ones)"
  echo -e "  ${YELLOW}→ Re-run this script${RESET}  (./scripts/setup.sh)"
  echo ""
  echo "  Get the real values from a teammate or 1Password."
fi
echo ""
echo -e "${BOLD}Common 404 / blank-page fixes:${RESET}"
echo "  - Hard-refresh the page (Ctrl+Shift+R or Cmd+Shift+R) to clear browser cache"
echo "  - Check the browser console (F12) for errors"
echo "  - Check the dev server terminal for errors"
echo "  - Verify .env has real values (not YOUR_PROJECT_REF etc.)"
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"

exit $EXIT_CODE
