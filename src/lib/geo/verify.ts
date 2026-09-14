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
}): VerificationDecision {
  const after: Record<string, RuleCheckState> = {};
  let failing = 0;
  let unknown = 0;

  for (const t of input.targets) {
    const outcomes = ruleOutcomes(input.site, input.pages, t.ruleId, { mode: "quick" });
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
