# ADR-0012: AI Visibility fixes as approved pull requests, resolved only by verification

- Status: Accepted
- Date: 2026-09-16
- Builds on: ADR-0010 (AI Visibility), ADR-0011 (GitHub website connector)

## Context

AI Visibility found real problems but could only show copy-paste recipes, and a
person could mark a finding "resolved" without anything checking it. The GitHub
connector was deliberately read-only. Client-rendered sites were judged on empty
server HTML. GitHub lived in a standalone Integrations dialog disconnected from
the findings that need it.

## Decision

1. **Fixes are pull requests, never pushes.** From a finding, "Fix this" plans the
   exact repository files (`targets.ts`, a narrow support matrix of framework ×
   rule), reads them through the GitHub App, and produces a change:
   - discovery files (robots.txt, llms.txt, sitemap.xml) deterministically from
     scan data (`text-artifacts.ts`), no model;
   - source edits (titles, descriptions, canonicals, `lang`, viewport, charset,
     Organization/WebSite JSON-LD, H1) as model-proposed exact find/replace edits
     through the metered Anthropic gateway, applied only when each match is unique.
2. **Validation before approval** (`validate.ts`): writable-path allowlist, size
   and changed-line caps, secret patterns, no scripts/network/eval/new imports,
   syntax parsing (TypeScript parser, JSON/XML), and a re-evaluation of the rule
   against the proposed file when crawlers read that file directly. Nothing
   proposed is executed.
3. **Exact-content approval.** Approval sends the content hash the user reviewed;
   the server refuses if it differs, if validation failed, or if the base branch
   moved. Mellox creates `mellox/geo-…` branches only, commits with the base
   commit as parent, and opens a PR. It never merges.
4. **Only verification resolves a finding.** A merged PR (webhook or polling)
   schedules targeted rescans of the affected pages (default +5/+15/+45 min for
   deploys). A finding is resolved only when its rule explicitly passes on a page
   that was fetched and analysed; failures, N/A and unfetched pages are not fixes.
   RLS refuses browser writes of `resolved`; resolved findings that reappear in a
   later scan are reopened. The same verification backs manual "Verify fix".
5. **Rendering fallback.** HTTP first. A page is rendered in headless Chromium only
   when its server HTML is a client-side shell (`rendering.ts`). Chromium resolves
   no hostnames; every request is fulfilled through the SSRF-guarded fetcher, GET
   only, bounded requests/bytes/time. Content rules use the rendered DOM; the
   raw-HTML rendering checks still apply, plus `perf.js_dependent_content`.
6. **Connections live in Settings.** The standalone Integrations dialog and sidebar
   entry are removed; GitHub is managed in Settings → Connections and connected
   contextually from a finding when a fix needs it.

7. **"Fix all automatically" is one pull request with one approval**
   (`batch.server.ts`, migration `20260916100000_add_geo_fix_batches.sql`):
   - Up to 15 open, fixable findings of a scan (highest priority first) are
     generated in the background.
   - Fixes that touch the same file are applied on a shared working tree, so they
     stack instead of conflicting.
   - Each fix is validated on its own; a fix that fails its checks or can't be made
     is skipped with its reason.
   - The combined change (≤ 12 files, ≤ 1,500 changed lines) is re-validated, bound
     to a content hash, approved once, and committed to one `mellox/` branch → one PR.
     Mellox never merges it.
   - After merge, one verification rescans every affected page. Each finding is
     resolved only when its own check passes; the others stay open and are marked
     not verified after the last attempt.

## Consequences

- New tables `geo_fix_proposals`, `geo_verifications` (members read, service role
  writes), verification columns on `geo_finding_states`, `targeted` scan mode.
- The GitHub App should additionally grant Checks: read and Commit statuses: read
  and subscribe to pull_request, check_suite and check_run; without them CI status
  shows "unavailable" and PR state is polled.
- Unsupported frameworks, dynamic routes and content/trust rules stay manual with
  an explicit reason. Multi-page rules (duplicates, broken links) verify only via
  a full rescan.
- Proposed file contents are kept 30 days after a proposal ends.
