// verify.ts — decides whether findings are really fixed, from a fresh
// targeted scan. Pure; the worker (src/server/geo/fixes/verify.server.ts)
// runs the scan and persists the outcome.
//
//   verified      every target rule now evaluates PASS on its page
//   not_verified  at least one target still warns or fails
//   inconclusive  a target page couldn't be fetched/analysed, or the rule
//                 can't be evaluated there (N/A) — never counted as fixed
//
// A commit, a merged pull request or a missing finding row is never evidence
// on its own: only an explicit pass on a page that was actually analysed.

import type { RuleCheckState } from "./fix-contracts";
import { fingerprintFor, ruleOutcomes, scoreScan } from "./score";
import type { CrawledPage, SiteArtifacts } from "./types";

export type VerificationTarget = { fingerprint: string; ruleId: string; pageUrl: string | null };

export type VerificationDecision = {
  outcome: "verified" | "not_verified" | "inconclusive";
  after: Record<string, RuleCheckState>;
  detail: string;
  regressions: { fingerprint: string; ruleId: string; title: string; pageUrl: string | null }[];
};

/**
 * Rules that compare a page with other pages. They are judged in multi-page
 * mode, and only mean something when the verification scan also read the pages
 * the finding was about (`comparisonUrls`): the pages that shared the title or
 * description, or the pages the broken links pointed to.
 */
export const COMPARISON_RULES: ReadonlySet<string> = new Set([
  "tech.duplicate_title",
  "tech.duplicate_description",
  "tech.broken_links",
]);

type BaselinePage = { url: string; title: string | null; description: string | null };

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** The other pages a comparison finding needs re-read to be verified. */
export function comparisonUrls(input: {
  targets: VerificationTarget[];
  /** Pages of the scan that raised the findings. */
  baselinePages: BaselinePage[];
  /** Evidence of each target finding, by fingerprint. */
  evidence: Record<string, Record<string, unknown> | undefined>;
  limit?: number;
}): string[] {
  const out = new Set<string>();
  const limit = input.limit ?? 12;
  for (const t of input.targets) {
    if (!COMPARISON_RULES.has(t.ruleId) || !t.pageUrl) continue;
    if (t.ruleId === "tech.broken_links") {
      const links = input.evidence[t.fingerprint]?.links;
      for (const l of Array.isArray(links) ? links : []) {
        const href = (l as { href?: unknown })?.href;
        if (typeof href === "string") out.add(href);
      }
      continue;
    }
    const self = input.baselinePages.find((p) => samePage(p.url, t.pageUrl!));
    if (!self) continue;
    const key = t.ruleId === "tech.duplicate_title" ? "title" : "description";
    const value = norm(self[key]);
    if (!value) continue;
    for (const p of input.baselinePages) {
      if (p.url !== self.url && norm(p[key]) === value) out.add(p.url);
    }
  }
  return [...out].slice(0, limit);
}

const samePage = (a: string, b: string) => {
  const norm = (u: string) => {
    try {
      const x = new URL(u);
      return `${x.hostname.replace(/^www\./, "")}${x.pathname.replace(/\/+$/, "") || "/"}${x.search}`;
    } catch {
      return u;
    }
  };
  return norm(a) === norm(b);
};

export function evaluateVerification(input: {
  targets: VerificationTarget[];
  site: SiteArtifacts;
  pages: CrawledPage[];
  /** Fingerprints the baseline scan had on the verified pages (for regressions). */
  baselineFingerprints: string[];
  /** Per comparison finding: the other pages the scan re-read for it. */
  comparison?: Record<string, string[]>;
}): VerificationDecision {
  const after: Record<string, RuleCheckState> = {};
  let failing = 0;
  let unknown = 0;

  for (const t of input.targets) {
    // Without the other pages in the scan, "unique" or "no broken links" would
    // be true by default — that is not evidence of a fix.
    if (COMPARISON_RULES.has(t.ruleId) && !input.comparison?.[t.fingerprint]?.length) {
      after[t.fingerprint] = {
        status: "missing",
        detail: "This check compares pages. Run a full scan to confirm it.",
        pageUrl: t.pageUrl,
      };
      unknown++;
      continue;
    }
    const outcomes = ruleOutcomes(input.site, input.pages, t.ruleId, {
      mode: COMPARISON_RULES.has(t.ruleId) ? "full" : "quick",
    });
    if (!outcomes) {
      after[t.fingerprint] = {
        status: "missing",
        detail: "This check no longer exists.",
        pageUrl: t.pageUrl,
      };
      unknown++;
      continue;
    }
    const match = t.pageUrl
      ? outcomes.find(
          (o) =>
            o.pageUrl &&
            (samePage(o.pageUrl, t.pageUrl!) ||
              fingerprintFor(t.ruleId, input.site.host, o.pageUrl) === t.fingerprint),
        )
      : outcomes[0];
    if (!match) {
      const page = input.pages.find(
        (p) => samePage(p.url, t.pageUrl ?? "") || samePage(p.finalUrl ?? "", t.pageUrl ?? ""),
      );
      const why = !page
        ? "The page wasn't part of the verification scan."
        : page.state !== "fetched"
          ? `The page couldn't be fetched (${page.skipReason ?? page.state}).`
          : (page.statusCode ?? 0) >= 400
            ? `The page returned HTTP ${page.statusCode}.`
            : "The page couldn't be analysed.";
      after[t.fingerprint] = { status: "missing", detail: why, pageUrl: t.pageUrl };
      unknown++;
      continue;
    }
    after[t.fingerprint] = {
      status: match.outcome.status,
      detail: match.outcome.detail,
      pageUrl: t.pageUrl,
    };
    if (match.outcome.status === "pass") continue;
    if (match.outcome.status === "na") unknown++;
    else failing++;
  }

  const { findings } = scoreScan(input.site, input.pages, { mode: "quick" });
  const baseline = new Set(input.baselineFingerprints);
  const targetSet = new Set(input.targets.map((t) => t.fingerprint));
  const regressions = findings
    .filter((f) => !baseline.has(f.fingerprint) && !targetSet.has(f.fingerprint))
    .slice(0, 20)
    .map((f) => ({
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      title: f.title,
      pageUrl: f.pageUrl,
    }));

  const total = input.targets.length;
  if (failing) {
    return {
      outcome: "not_verified",
      after,
      detail: `${failing} of ${total} check(s) still fail on the live site.`,
      regressions,
    };
  }
  if (unknown) {
    return {
      outcome: "inconclusive",
      after,
      detail: `${unknown} of ${total} check(s) couldn't be confirmed on the live site.`,
      regressions,
    };
  }
  return {
    outcome: "verified",
    after,
    detail: `All ${total} check(s) now pass on the live site.`,
    regressions,
  };
}
