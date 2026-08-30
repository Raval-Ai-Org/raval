#!/usr/bin/env node
/**
 * Validate public/robots.txt against the running app.
 *
 * Asserts:
 *   1. A single `Sitemap:` directive is present and points at the canonical
 *      host's /sitemap.xml.
 *   2. That sitemap URL is fetchable.
 *   3. No URL inside the sitemap is Disallow-ed by robots.txt (would mean an
 *      indexable page was accidentally blocked from crawling).
 *   4. Every `Disallow:` path in robots.txt actually responds with a
 *      `noindex` robots meta OR redirects to a noindex page (so we don't
 *      accidentally ship a "disallowed" route that Google can still index
 *      via inbound links because it lacks a noindex tag).
 *
 * Exits non-zero on any violation so CI blocks merges.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CANONICAL_HOST = process.env.APP_URL || "https://raval.ai";
const EXPECTED_SITEMAP = `${CANONICAL_HOST}/sitemap.xml`;
const SERVER = process.env.SITEMAP_BASE_URL ?? "http://localhost:8080";
const ROBOTS_PATH = resolve(process.cwd(), "public/robots.txt");

function parseRobots(text) {
  const disallow = [];
  const allow = [];
  const sitemaps = [];
  let currentAgent = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const [k, ...rest] = line.split(":");
    const key = k.trim().toLowerCase();
    const val = rest.join(":").trim();
    if (key === "user-agent") currentAgent = val;
    else if (key === "disallow" && currentAgent === "*" && val) disallow.push(val);
    else if (key === "allow" && currentAgent === "*" && val) allow.push(val);
    else if (key === "sitemap") sitemaps.push(val);
  }
  return { disallow, allow, sitemaps };
}

function isDisallowed(pathname, { disallow, allow }) {
  const matches = (rules) =>
    rules.filter(
      (r) =>
        pathname === r ||
        pathname.startsWith(r.endsWith("/") ? r : r + "/") ||
        pathname === r.replace(/\/$/, ""),
    );
  const d = matches(disallow);
  const a = matches(allow);
  if (d.length === 0) return false;
  // More-specific Allow wins.
  const longestD = Math.max(...d.map((r) => r.length));
  const longestA = a.length ? Math.max(...a.map((r) => r.length)) : -1;
  return longestA < longestD;
}

function extractLocs(xml) {
  const out = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1].trim());
  return out;
}

function extractRobotsMeta(html) {
  const m = html.match(/<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["']/i);
  return m ? m[1].toLowerCase() : null;
}

async function main() {
  const errors = [];
  const robotsText = readFileSync(ROBOTS_PATH, "utf8");
  const parsed = parseRobots(robotsText);

  // 1. Sitemap directive
  if (parsed.sitemaps.length === 0) {
    errors.push("robots.txt is missing a `Sitemap:` directive");
  } else if (parsed.sitemaps.length > 1) {
    errors.push(`robots.txt has ${parsed.sitemaps.length} Sitemap directives; expected exactly 1`);
  } else if (parsed.sitemaps[0] !== EXPECTED_SITEMAP) {
    errors.push(
      `robots.txt Sitemap points to "${parsed.sitemaps[0]}", expected "${EXPECTED_SITEMAP}"`,
    );
  }

  // 2. Fetch sitemap and cross-check
  let locs = [];
  try {
    const res = await fetch(`${SERVER}/sitemap.xml`);
    if (!res.ok) {
      errors.push(`sitemap.xml unreachable at ${SERVER}/sitemap.xml (HTTP ${res.status})`);
    } else {
      locs = extractLocs(await res.text());
    }
  } catch (err) {
    errors.push(`sitemap.xml fetch failed: ${err.message}`);
  }

  // 3. No sitemap URL is blocked by robots.txt
  for (const loc of locs) {
    let path;
    try {
      path = new URL(loc).pathname;
    } catch {
      errors.push(`sitemap contains malformed URL: ${loc}`);
      continue;
    }
    if (isDisallowed(path, parsed)) {
      errors.push(`sitemap URL ${loc} is Disallow-ed in robots.txt (indexable but blocked)`);
    } else {
      console.log(`  ok  sitemap ${path} is crawlable`);
    }
  }

  // 4. Every Disallow-ed route must serve noindex (or redirect to one)
  for (const rule of parsed.disallow) {
    // Skip patterns / trailing-slash duplicates and API endpoints (JSON, not HTML).
    // Skip patterns, API JSON endpoints, and namespace prefix rules
    // (trailing slash = "everything under here", not a single page).
    if (rule.includes("*") || rule.endsWith("/") || rule === "/api") continue;
    const path = rule;
    let res;
    try {
      res = await fetch(`${SERVER}${path}`, { redirect: "follow" });
    } catch (err) {
      errors.push(`Disallow path ${path} fetch failed: ${err.message}`);
      continue;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html")) {
      console.log(`  ok  ${path} (non-HTML: ${ct.split(";")[0]})`);
      continue;
    }
    const robots = extractRobotsMeta(await res.text());
    if (!robots || !/\bnoindex\b/.test(robots)) {
      errors.push(
        `Disallow path ${path} is missing a noindex meta (robots="${robots ?? "<none>"}") — search engines may still index it via inbound links`,
      );
    } else {
      console.log(`  ok  ${path} serves noindex`);
    }
  }

  if (errors.length > 0) {
    console.error("\nrobots.txt validation FAILED:\n");
    for (const e of errors) console.error(`  ✗ ${e}`);
    process.exit(1);
  }
  console.log("\nrobots.txt validation passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
