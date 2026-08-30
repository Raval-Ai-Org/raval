#!/usr/bin/env node
/**
 * Validate the generated sitemap.xml.
 *
 * Fetches /sitemap.xml from a running server (SITEMAP_BASE_URL, defaults to
 * http://localhost:8080), then for every <loc> URL asserts:
 *
 *   1. The URL is on the canonical host (https://raval6.lovable.app).
 *   2. The URL is reachable (HTTP 2xx after following redirects).
 *   3. The rendered page does NOT contain a `noindex` robots directive.
 *   4. The rendered page's <link rel="canonical"> self-references the same URL
 *      (ignoring trailing slash differences).
 *   5. Every <lastmod> value is a valid W3C Datetime / ISO-8601 date, is not
 *      in the future, and remains stable across builds — compared against
 *      the checked-in baseline at scripts/sitemap-lastmod.baseline.json.
 *      Set UPDATE_SITEMAP_LASTMOD_BASELINE=1 to intentionally refresh it.
 *      A URL missing from the sitemap that was in the baseline is a churn
 *      failure; a new URL is allowed and gets recorded on next update.
 *
 * Exits non-zero on any violation so CI blocks merges.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CANONICAL_HOST = process.env.APP_URL || "https://raval.ai";
const SERVER = process.env.SITEMAP_BASE_URL ?? "http://localhost:8080";
const BASELINE_PATH = resolve(process.cwd(), "scripts/sitemap-lastmod.baseline.json");
const UPDATE_BASELINE = process.env.UPDATE_SITEMAP_LASTMOD_BASELINE === "1";

// Paths that must NEVER appear in the sitemap — auth-gated, private, or
// otherwise non-public. Matched as exact path OR prefix ("/app" also blocks
// "/app/analytics", "/app/content", etc.).
const PRIVATE_PATH_PREFIXES = [
  "/app",
  "/onboarding",
  "/projects",
  "/agency",
  "/login",
  "/signup",
  "/auth",
  "/reset-password",
  "/api",
];

function isPrivatePath(pathname) {
  for (const p of PRIVATE_PATH_PREFIXES) {
    if (pathname === p || pathname.startsWith(p + "/")) return true;
  }
  return false;
}

const stripTrailingSlash = (u) => (u.endsWith("/") && u.length > 1 ? u.slice(0, -1) : u);

// W3C Datetime subset accepted by sitemaps.org: YYYY, YYYY-MM, YYYY-MM-DD,
// or full ISO-8601 with time + timezone (Z or ±HH:MM).
const ISO_DATE_RE =
  /^(\d{4})(-\d{2}(-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

function isValidLastmod(value) {
  if (!ISO_DATE_RE.test(value)) return false;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  // Reject dates more than 24h in the future (allow small clock skew).
  if (d.getTime() > Date.now() + 24 * 60 * 60 * 1000) return false;
  return true;
}

function extractUrlEntries(xml) {
  // Returns [{ loc, lastmod|null }, ...] preserving <url> block grouping.
  const out = [];
  const re = /<url>([\s\S]*?)<\/url>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const locM = block.match(/<loc>([^<]+)<\/loc>/);
    const lmM = block.match(/<lastmod>([^<]+)<\/lastmod>/);
    if (locM) out.push({ loc: locM[1].trim(), lastmod: lmM ? lmM[1].trim() : null });
  }
  return out;
}

function extractLocs(xml) {
  return extractUrlEntries(xml).map((e) => e.loc);
}

function extractRobots(html) {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].toLowerCase() : null;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

async function main() {
  const sitemapUrl = `${SERVER}/sitemap.xml`;
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  const res = await fetch(sitemapUrl);
  if (!res.ok) {
    console.error(`Failed to fetch sitemap: HTTP ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  const entries = extractUrlEntries(xml);
  const locs = entries.map((e) => e.loc);
  if (locs.length === 0) {
    console.error("Sitemap contains no <loc> entries.");
    process.exit(1);
  }
  console.log(`Found ${locs.length} URL(s) in sitemap.`);

  const errors = [];
  const lastmodByLoc = new Map(entries.map((e) => [e.loc, e.lastmod]));

  for (const loc of locs) {
    const problems = [];

    // 1. Canonical host check
    if (!loc.startsWith(`${CANONICAL_HOST}/`) && loc !== CANONICAL_HOST) {
      problems.push(`not on canonical host ${CANONICAL_HOST}`);
    }

    // Fetch against the running dev server, rewriting host.
    let path;
    try {
      path = new URL(loc).pathname;
    } catch {
      problems.push("malformed URL");
      errors.push({ loc, problems });
      continue;
    }

    // 2. Private / auth-gated path check — sitemap must only list fully
    //    public URLs. /app/*, /onboarding, /reset-password, /auth/*, etc.
    //    are gated and must never be advertised for crawling.
    if (isPrivatePath(path)) {
      problems.push(`private/auth-gated path is not eligible for the sitemap`);
    }

    const fetchUrl = `${SERVER}${path}`;

    let pageRes;
    try {
      pageRes = await fetch(fetchUrl, { redirect: "follow" });
    } catch (err) {
      problems.push(`fetch failed: ${err.message}`);
      errors.push({ loc, problems });
      continue;
    }

    // 3. Must return 200 on the canonical host (redirects are followed;
    //    a guard redirect that lands elsewhere also fails the path check).
    if (pageRes.status !== 200) {
      problems.push(`did not return 200 on canonical host (HTTP ${pageRes.status})`);
    }
    try {
      const finalPath = new URL(pageRes.url).pathname;
      if (finalPath !== path) {
        problems.push(`redirected away from canonical path: ${path} → ${finalPath}`);
      }
    } catch {
      /* ignore */
    }

    const html = await pageRes.text();

    // 3. Non-indexable check
    const robots = extractRobots(html);
    if (robots && /\bnoindex\b/.test(robots)) {
      problems.push(`page is non-indexable (robots="${robots}")`);
    }

    // 4. Self-referential canonical
    const canonical = extractCanonical(html);
    if (!canonical) {
      problems.push('missing <link rel="canonical">');
    } else if (stripTrailingSlash(canonical) !== stripTrailingSlash(loc)) {
      problems.push(`canonical mismatch: page canonical="${canonical}" vs sitemap loc="${loc}"`);
    }

    if (problems.length > 0) errors.push({ loc, problems });
    else console.log(`  ok  ${loc}`);
  }

  // 5. lastmod validity + stability
  const currentLastmods = {};
  for (const { loc, lastmod } of entries) {
    if (lastmod == null) continue;
    currentLastmods[loc] = lastmod;
    if (!isValidLastmod(lastmod)) {
      errors.push({
        loc,
        problems: [
          `invalid <lastmod> "${lastmod}" — must be W3C Datetime / ISO-8601 and not in the future`,
        ],
      });
    }
  }

  const hasBaseline = existsSync(BASELINE_PATH);
  if (UPDATE_BASELINE) {
    writeFileSync(BASELINE_PATH, JSON.stringify(currentLastmods, null, 2) + "\n");
    console.log(`\nUpdated lastmod baseline: ${BASELINE_PATH}`);
  } else if (hasBaseline) {
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
    for (const [loc, expected] of Object.entries(baseline)) {
      if (!lastmodByLoc.has(loc)) {
        errors.push({
          loc,
          problems: [`URL present in baseline but missing from current sitemap (churn)`],
        });
        continue;
      }
      const current = currentLastmods[loc];
      if (current !== expected) {
        errors.push({
          loc,
          problems: [
            `lastmod churn: baseline="${expected}" vs current="${current ?? "<none>"}" — if intentional, re-run with UPDATE_SITEMAP_LASTMOD_BASELINE=1`,
          ],
        });
      }
    }
  } else {
    // First run — seed the baseline so future builds detect churn.
    writeFileSync(BASELINE_PATH, JSON.stringify(currentLastmods, null, 2) + "\n");
    console.log(`\nSeeded lastmod baseline (no prior file): ${BASELINE_PATH}`);
  }

  if (errors.length > 0) {
    console.error("\nSitemap validation FAILED:\n");
    for (const { loc, problems } of errors) {
      console.error(`  ✗ ${loc}`);
      for (const p of problems) console.error(`      - ${p}`);
    }
    process.exit(1);
  }

  console.log("\nSitemap validation passed: canonical, indexable, and lastmod stable.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
