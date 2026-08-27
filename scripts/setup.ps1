# ─────────────────────────────────────────────────────────────────────────────
# RavalAI — first-time developer setup (Windows PowerShell)
# ─────────────────────────────────────────────────────────────────────────────
# Run this once after `git pull` to make sure your local environment is ready.
# Idempotent: safe to run multiple times. Skips steps that are already done.
#
# What it does:
#   1. Copies .env.example -> .env (if .env is missing)
#   2. Checks that .env has real values (not placeholders)
#   3. Runs `npm install` if node_modules is missing
#   4. Prints a one-screen status report
#
# Usage (from PowerShell):
#   .\scripts\setup.ps1
#   OR (cross-shell):
#   npm run setup
#
# Exit codes:
#   0 = all good, run `npm run dev`
#   1 = missing required env values (need to be set manually)
#   2 = npm install failed
# ─────────────────────────────────────────────────────────────────────────────

# Stop on errors (equivalent to `set -e` in bash)
$ErrorActionPreference = "Stop"

# Resolve the repo root regardless of where the script is run from.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RootDir

# Colors for the status output. PowerShell handles ANSI via `$Host.UI.RawUI`
# but for cross-version compatibility we just use plain text.
function Step($msg) { Write-Host ">> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }
function Fail($msg) { Write-Host "[X] $msg" -ForegroundColor Red }

$ExitCode = 0

# ─── 1. .env file ────────────────────────────────────────────────────────────
Step "Step 1/4: Checking .env file"
if (-not (Test-Path ".env")) {
  if (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env"
    Warn ".env was missing - created from .env.example with PLACEHOLDER values"
    Warn "You MUST edit .env and replace the placeholders with real values, otherwise:"
    Warn "  - /login will appear to work but auth will silently fail (404-style behavior)"
    Warn "  - Supabase calls will hit a non-existent project"
    Warn "Get the real values from a teammate (Junaid) or from 1Password."
    $ExitCode = 1
  } else {
    Fail ".env AND .env.example are both missing - something is wrong with your clone"
    exit 1
  }
} else {
  Ok ".env exists"
}

# ─── 2. Check .env has real values, not placeholders ─────────────────────────
Step "Step 2/4: Verifying .env has real values"
if (Test-Path ".env") {
  $placeholderPattern = "YOUR_PROJECT_REF|YOUR_PUBLISHABLE|YOUR_SERVICE_ROLE|your-openrouter|placeholder"
  $placeholderMatches = Select-String -Path ".env" -Pattern $placeholderPattern -ErrorAction SilentlyContinue
  if ($placeholderMatches.Count -gt 0) {
    Fail ".env contains $($placeholderMatches.Count) placeholder value(s)"
    Warn "Open .env in your editor (e.g. 'code .env') and replace the placeholders with real credentials."
    Warn "Lines containing placeholders:"
    $placeholderMatches | Select-Object -First 5 | ForEach-Object { Write-Host "    $($_.LineNumber): $($_.Line)" -ForegroundColor Yellow }
    $ExitCode = 1
  } else {
    Ok ".env has real values (no placeholders detected)"
  }
}

# ─── 3. node_modules ─────────────────────────────────────────────────────────
Step "Step 3/4: Checking node_modules"
if (-not (Test-Path "node_modules")) {
  Warn "node_modules missing - running npm install (this may take 2-3 minutes)"
  try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install returned exit code $LASTEXITCODE" }
    Ok "npm install completed"
  } catch {
    Fail "npm install failed - check your internet connection and try again"
    exit 2
  }
} else {
  Ok "node_modules exists (skipping npm install - run it manually if you have dependency issues)"
}

# ─── 4. Final report ─────────────────────────────────────────────────────────
Step "Step 4/4: Final report"
Write-Host ""
Write-Host "==================================================================="
Write-Host "  RavalAI local setup status"
Write-Host "==================================================================="
Write-Host ""

if (Test-Path ".env") {
  Write-Host "  .env file:          present"
  if ($placeholderMatches -and $placeholderMatches.Count -gt 0) {
    Write-Host "  .env values:        PLACEHOLDERS DETECTED" -ForegroundColor Red
  } else {
    Write-Host "  .env values:        looks real" -ForegroundColor Green
  }
} else {
  Write-Host "  .env file:          MISSING" -ForegroundColor Red
}

if (Test-Path "node_modules") {
  Write-Host "  node_modules:       installed" -ForegroundColor Green
} else {
  Write-Host "  node_modules:       MISSING" -ForegroundColor Red
}

Write-Host ""
Write-Host "Next steps:"
Write-Host ""

if ($ExitCode -eq 0) {
  Write-Host "  -> npm run dev    (start the dev server on http://localhost:8080)" -ForegroundColor Green
  Write-Host ""
  Write-Host "  Then open http://localhost:8080/login in your browser."
  Write-Host "  Test login: junaidsajjad2298@gmail.com / Junaid@1234"
} else {
  Write-Host "  -> Edit .env       (replace placeholder values with real ones)" -ForegroundColor Yellow
  Write-Host "  -> Re-run this script  (.\scripts\setup.ps1)" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "  How to get the real values safely:" -ForegroundColor Cyan
  Write-Host "  1. Ask Junaid to share the 'RavalAI local dev .env' item in 1Password"
  Write-Host "  2. Copy each line from 1Password into your .env"
  Write-Host "  3. See docs/TEAM-CREDENTIALS.md for details on each value"
  Write-Host ""
  Write-Host "  DO NOT:" -ForegroundColor Red
  Write-Host "  - Commit .env to git (it holds production secrets)"
  Write-Host "  - Share .env via email or Slack (use 1Password)"
  Write-Host "  - Reuse these credentials for other projects"
}
Write-Host ""
Write-Host "Common 404 / blank-page fixes:"
Write-Host "  - Hard-refresh the page (Ctrl+Shift+R or Ctrl+F5) to clear browser cache"
Write-Host "  - Check the browser console (F12) for errors"
Write-Host "  - Check the dev server terminal for errors"
Write-Host "  - Verify .env has real values (not YOUR_PROJECT_REF etc.)"
Write-Host ""
Write-Host "==================================================================="

exit $ExitCode
