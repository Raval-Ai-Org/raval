# ─────────────────────────────────────────────────────────────────────────────
# RavalAI — predev sanity check (Windows PowerShell)
# ─────────────────────────────────────────────────────────────────────────────
# Automatically runs before `npm run dev` (via the "predev" npm script).
# Does NOT block the dev server - just prints a loud warning if something is
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

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path "$ScriptDir\..").Path
Set-Location $RootDir

function Warn { param($msg) Write-Host "[!] $msg" -ForegroundColor Yellow; $script:Warnings++ }
function Fail { param($msg) Write-Host "[X] $msg" -ForegroundColor Red;    $script:Errors++ }
function Ok   { param($msg) Write-Host "[OK] $msg" -ForegroundColor Green }

$Warnings = 0
$Errors = 0

Write-Host ">> Predev check (raval)" -ForegroundColor Cyan

# ── 1. .env file ─────────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
  Fail ".env is MISSING - auth will fail silently"
  Write-Host "    Fix:  Copy-Item .env.example .env; then edit .env with real values"
  Write-Host "    Or run: npm run setup"
} else {
  Ok ".env exists"
  $placeholderPattern = "YOUR_PROJECT_REF|YOUR_PUBLISHABLE|YOUR_SERVICE_ROLE|your-openrouter"
  $placeholderMatches = Select-String -Path ".env" -Pattern $placeholderPattern -ErrorAction SilentlyContinue
  if ($placeholderMatches -and $placeholderMatches.Count -gt 0) {
    Fail ".env contains $($placeholderMatches.Count) placeholder value(s) - auth will fail"
    Write-Host "    Fix:  Edit .env and replace YOUR_* with real credentials"
    Write-Host "    Get real values from a teammate or 1Password"
  }
}

# ── 2. node_modules ──────────────────────────────────────────────────────────
if (-not (Test-Path "node_modules")) {
  Fail "node_modules is MISSING - the dev server will not start"
  Write-Host "    Fix:  npm install"
} else {
  Ok "node_modules installed"
}

# ── 3. SDR reachability (non-blocking) ──────────────────────────────────────
if (Test-Path ".env") {
  $sdrLine = Select-String -Path ".env" -Pattern "^SDR_BASE_URL=" -ErrorAction SilentlyContinue
  if ($sdrLine) {
    $sdrUrl = ($sdrLine.Line -split "=", 2)[1].Trim().Trim('"').Trim("'")
    if ($sdrUrl -and $sdrUrl -ne "https://YOUR_PROJECT_REF.supabase.co") {
      try {
        $response = Invoke-WebRequest -Uri "$sdrUrl/health" -Method Head -TimeoutSec 5 -ErrorAction Stop
        $code = $response.StatusCode
        if ($code -eq 200) {
          Ok "SDR reachable at $sdrUrl"
        } else {
          Warn "SDR at $sdrUrl returned HTTP $code"
        }
      } catch {
        Warn "SDR not reachable at $sdrUrl (network/timeout) - proxy calls will fail"
      }
    }
  }
}

# ── Summary ──────────────────────────────────────────────────────────────────
Write-Host ""
if ($Errors -gt 0) {
  Write-Host "===================================================================" -ForegroundColor Red
  Write-Host "  $Errors critical issue(s) found - fix before continuing" -ForegroundColor Red
  Write-Host "===================================================================" -ForegroundColor Red
  Write-Host ""
  Write-Host "  Quick fix:  npm run setup" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  If you see '404' on /login:"
  Write-Host "  The page actually loads, but the Supabase client is misconfigured"
  Write-Host "  (placeholder values in .env). The form will submit but the auth"
  Write-Host "  request fails silently and the app redirects you in a loop."
  Write-Host ""
} elseif ($Warnings -gt 0) {
  Write-Host "  $Warnings warning(s) - non-blocking, but worth fixing" -ForegroundColor Yellow
  Write-Host ""
}

# Always allow dev to start; warnings are advisory
exit 0
