// verify.server.ts — proof that a published backlink is actually on the page.
//
// After Mellox posts an article, it fetches the published URL through the
// SSRF-guarded fetcher and looks for the link in the real HTML. A platform
// returning "published" is not proof: some sanitise links, some add nofollow.
// Only this check decides whether a placement counts.
//
// It errs towards saying nothing. A bot wall, a truncated body or a page whose
// links are client-rendered comes back as "couldn't open the page", never as
// "the link is gone".
import "server-only";
import { extractLinks, matchLink } from "@/lib/backlinks/verify";
import type { VerificationResult } from "@/lib/backlinks/types";
import { safeFetch, SsrfBlockedError, assertPublicUrl } from "@/server/safe-fetch";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_BYTES = 2 * 1024 * 1024;

export type VerifyOutcome = {
  result: VerificationResult;
  httpStatus: number | null;
  linkFound: boolean | null;
  isNofollow: boolean | null;
  anchorFound: string | null;
  error: string | null;
};

function failure(
  result: VerificationResult,
  error: string,
  httpStatus: number | null = null,
): VerifyOutcome {
  return { result, httpStatus, linkFound: null, isNofollow: null, anchorFound: null, error };
}

export async function verifyUrl(input: {
  urlFrom: string;
  expectedTarget: string;
}): Promise<VerifyOutcome> {
  let url: URL;
  try {
    url = assertPublicUrl(input.urlFrom);
  } catch (error) {
    return failure(
      "blocked",
      error instanceof SsrfBlockedError
        ? "That address isn't allowed."
        : "That isn't a valid web address.",
    );
  }

  let response;
  try {
    response = await safeFetch(url, {
      method: "GET",
      timeoutMs: FETCH_TIMEOUT_MS,
      maxBytes: MAX_BYTES,
      onOverflow: "truncate",
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
  } catch (error) {
    if (error instanceof SsrfBlockedError) return failure("blocked", "That address isn't allowed.");
    return failure("unreachable", "Couldn't open the page.");
  }

  if (!response.ok) {
    // A brand new post can 404 for a few seconds while the platform's CDN
    // catches up, so this is "couldn't read it", not "the link is gone".
    return failure(
      "unreachable",
      response.status === 403 || response.status === 429
        ? "The site blocked our check."
        : `The page returned ${response.status}.`,
      response.status,
    );
  }

  const links = extractLinks(response.text(), response.url);
  if (links.length === 0) {
    return failure(
      "unreachable",
      "The page's links load in the browser, so we couldn't check.",
      response.status,
    );
  }

  const outcome = matchLink(links, input.expectedTarget);
  if (!outcome.linkFound && response.truncated) {
    return failure("unreachable", "The page was too large to check fully.", response.status);
  }

  return {
    result: outcome.result,
    httpStatus: response.status,
    linkFound: outcome.linkFound,
    isNofollow: outcome.isNofollow,
    anchorFound: outcome.anchorFound,
    error: null,
  };
}
