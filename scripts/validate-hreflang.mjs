#!/usr/bin/env node
/**
 * Validate hreflang + canonical consistency across every URL in the sitemap.
 *
 * Rules enforced (per Google's hreflang guidelines):
 *
 *   1. Every sitemap URL is fetchable and returns HTML.
 *   2. If ANY page in the sitemap ships <link rel="alternate" hreflang="...">
 *      tags, the site is treated as multi-locale and every sitemap URL MUST:
 *        a. declare the full hreflang cluster (same set of locales, same
 *           target URLs — order-insensitive)
 *        b. include a self-referential hreflang entry pointing at itself
 *        c. include an `x-default` entry
 *        d. self-reference its own canonical (canonical === page URL)
 *        e. every alternate URL must itself appear in the sitemap and
 *           point back with a matching hreflang cluster (bidirectional)
 *   3. If NO page ships hreflang tags, the site is single-locale: every
 *      URL still needs a self-referential canonical, and no page may
 *      leak a stray hreflang tag (which would imply a broken cluster).
 *
 * Exits non-zero on any violation so CI blocks merges.
 */

const CANONICAL_HOST = process.env.APP_URL || "https://raval.ai";
const SERVER = process.env.SITEMAP_BASE_URL ?? "http://localhost:8080";

const stripTrailingSlash = (u) => (u.endsWith("/") && u.length > 1 ? u.slice(0, -1) : u);
const normalizeUrl = (u) => stripTrailingSlash(u.trim());

function extractLocs(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function extractCanonical(html) {
  const m = html.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  return m ? m[1] : null;
}

function extractHreflangs(html) {
  // Returns array of { hreflang, href } from every <link rel="alternate" hreflang="..." href="...">.
  const out = [];
  const re = /<link\b[^>]*\brel=["']alternate["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    const lang = tag.match(/\bhreflang=["']([^"']+)["']/i);
    const href = tag.match(/\bhref=["']([^"']+)["']/i);
    if (lang && href) out.push({ hreflang: lang[1].toLowerCase(), href: href[1] });
  }
  return out;
}

function clusterKey(entries) {
  // Deterministic signature of a hreflang cluster for cross-page comparison.
  return entries
    .map((e) => `${e.hreflang}=>${normalizeUrl(e.href)}`)
    .sort()
    .join("|");
}

async function fetchPage(loc) {
  let pathname;
  try {
    pathname = new URL(loc).pathname;
  } catch {
    return { error: `malformed URL: ${loc}` };
  }
  try {
    const res = await fetch(`${SERVER}${pathname}`, { redirect: "follow" });
    if (!res.ok) return { error: `unreachable (HTTP ${res.status})` };
    const html = await res.text();
    return {
      canonical: extractCanonical(html),
      hreflangs: extractHreflangs(html),
    };
  } catch (err) {
    return { error: `fetch failed: ${err.message}` };
  }
}

async function main() {
  const sitemapUrl = `${SERVER}/sitemap.xml`;
  console.log(`Fetching sitemap: ${sitemapUrl}`);
  const res = await fetch(sitemapUrl);
  if (!res.ok) {
    console.error(`Failed to fetch sitemap: HTTP ${res.status}`);
    process.exit(1);
  }
  const locs = extractLocs(await res.text());
  if (locs.length === 0) {
    console.error("Sitemap has no <loc> entries.");
    process.exit(1);
  }
  const sitemapSet = new Set(locs.map(normalizeUrl));
  console.log(`Found ${locs.length} URL(s) in sitemap.`);

  const pages = new Map(); // loc -> { canonical, hreflangs }
  const errors = [];

  for (const loc of locs) {
    const result = await fetchPage(loc);
    if (result.error) {
      errors.push({ loc, problems: [result.error] });
      continue;
    }
    pages.set(loc, result);
  }

  // Determine mode: any page shipping hreflang tags => multi-locale mode.
  const multiLocale = [...pages.values()].some((p) => p.hreflangs.length > 0);
  console.log(`Mode: ${multiLocale ? "multi-locale (hreflang enforced)" : "single-locale"}`);

  if (!multiLocale) {
    // Single-locale mode: self-canonical only; forbid stray hreflang tags.
    for (const [loc, { canonical, hreflangs }] of pages) {
      const problems = [];
      if (!canonical) problems.push('missing <link rel="canonical">');
      else if (normalizeUrl(canonical) !== normalizeUrl(loc))
        problems.push(`canonical "${canonical}" does not self-reference "${loc}"`);
      if (hreflangs.length > 0)
        problems.push(
          `stray hreflang tag(s) present on a single-locale page: ${hreflangs.map((h) => h.hreflang).join(", ")} — either declare a full cluster on every URL or remove these`,
        );
      if (problems.length) errors.push({ loc, problems });
      else console.log(`  ok  ${loc} (self-canonical, no hreflang)`);
    }
  } else {
    // Multi-locale mode: enforce cluster consistency + bidirectionality.
    const clusters = new Map(); // loc -> normalized cluster key
    for (const [loc, { hreflangs }] of pages) {
      clusters.set(loc, clusterKey(hreflangs));
    }
    // Group sitemap URLs by cluster; each cluster's members must reference each other.
    const clusterGroups = new Map(); // key -> Set<loc>
    for (const [loc, key] of clusters) {
      if (!clusterGroups.has(key)) clusterGroups.set(key, new Set());
      clusterGroups.get(key).add(loc);
    }

    for (const [loc, { canonical, hreflangs }] of pages) {
      const problems = [];
      const locNorm = normalizeUrl(loc);

      // a. Non-empty cluster
      if (hreflangs.length === 0) {
        problems.push(
          "no hreflang tags, but other pages declare a cluster — every URL must ship the cluster",
        );
        errors.push({ loc, problems });
        continue;
      }

      // b. Self-reference in the cluster
      const selfEntry = hreflangs.find((h) => normalizeUrl(h.href) === locNorm);
      if (!selfEntry)
        problems.push(`hreflang cluster is missing a self-referential entry pointing at "${loc}"`);

      // c. x-default present
      if (!hreflangs.some((h) => h.hreflang === "x-default"))
        problems.push('hreflang cluster is missing "x-default"');

      // d. Duplicate locales
      const seen = new Set();
      for (const h of hreflangs) {
        if (seen.has(h.hreflang)) problems.push(`duplicate hreflang locale "${h.hreflang}"`);
        seen.add(h.hreflang);
      }

      // e. Self-referential canonical
      if (!canonical) problems.push('missing <link rel="canonical">');
      else if (normalizeUrl(canonical) !== locNorm)
        problems.push(`canonical "${canonical}" does not self-reference "${loc}"`);

      // f. Every alternate must be in the sitemap and point back
      for (const h of hreflangs) {
        if (h.hreflang === "x-default") continue;
        const altNorm = normalizeUrl(h.href);
        if (altNorm === locNorm) continue;
        if (!sitemapSet.has(altNorm)) {
          problems.push(
            `hreflang="${h.hreflang}" points to "${h.href}" which is not in sitemap.xml`,
          );
          continue;
        }
        const altPage = [...pages.entries()].find(([l]) => normalizeUrl(l) === altNorm);
        if (!altPage) continue;
        const [, altData] = altPage;
        const backLink = altData.hreflangs.find((x) => normalizeUrl(x.href) === locNorm);
        if (!backLink) {
          problems.push(
            `hreflang="${h.hreflang}" → "${h.href}" is not reciprocated (target page has no hreflang entry pointing back to "${loc}")`,
          );
        }
      }

      // g. Cluster parity — every page in the same cluster group must ship the same cluster
      const key = clusters.get(loc);
      const group = clusterGroups.get(key);
      // If sitemap URLs partition into more than one cluster group, the whole site is inconsistent.
      if (clusterGroups.size > 1 && group.size !== pages.size) {
        problems.push(
          `hreflang cluster differs from other sitemap pages (found ${clusterGroups.size} distinct clusters across the sitemap; every URL must ship an identical cluster)`,
        );
      }

      if (problems.length) errors.push({ loc, problems });
      else console.log(`  ok  ${loc} (canonical + hreflang cluster consistent)`);
    }
  }

  if (errors.length > 0) {
    console.error("\nhreflang/canonical validation FAILED:\n");
    for (const { loc, problems } of errors) {
      console.error(`  ✗ ${loc}`);
      for (const p of problems) console.error(`      - ${p}`);
    }
    process.exit(1);
  }
  console.log("\nhreflang/canonical validation passed.");
  // Suppress unused-var warning
  void CANONICAL_HOST;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
