// Provider-neutral failure wording for video renders.
import "server-only";

// A provider's own safety filter refused the render. Phrases, not single
// words: "a minor error", "retry policy" or "case-sensitive" are not refusals.
const SAFETY_REFUSAL_RE =
  /\b(nsfw|content (?:policy|filter|moderation|guidelines?|safety)|safety (?:filter|system|check|policy|guidelines?|review)|usage polic(?:y|ies)|(?:violat\w*|against) (?:our |the |its )?(?:content |usage |safety |community )?(?:polic\w*|guidelines?|terms|rules)|(?:content|policy|safety) violation|(?:was|were|been|is|are) flagged|flagged (?:as|by|for)|sensitive (?:content|image|material|information)|prominent (?:people|person|figures?)|public figures?|celebrit\w*|minors? (?:detected|depicted|present|in the (?:image|input|photo))|child(?:ren)? (?:detected|safety)|real (?:people|person|human)s? (?:is|are)? ?not (?:allowed|supported)|photorealistic (?:people|person|faces?) (?:is|are)? ?not (?:allowed|supported)|inappropriate content|unsafe content)\b/i;

// The render ended without a result for a reason that is not about the
// content: worth one more submission.
const TRANSIENT_RE =
  /\b(internal (?:server )?error|server error|service (?:unavailable|busy|error)|temporar\w*|time ?out|timed out|try again|retry later|overload\w*|capacity|busy|high (?:load|demand)|queue (?:full|timeout)|gateway|upstream|network|connection|unavailable|5\d\d)\b/i;

export function isSafetyRefusal(message: string | null | undefined): boolean {
  return !!message && SAFETY_REFUSAL_RE.test(message);
}

/** A provider's failure message, reworded when it is a safety-filter block. */
export function friendlyFailure(message: string | null): string {
  if (!message) return "The provider couldn't render this video.";
  if (isSafetyRefusal(message)) {
    return "Safety review blocked this video. Do not bypass a safety refusal. Review /safety or contact support@mellox.ai to request review.";
  }
  return message.slice(0, 300);
}

/**
 * How a render that ended without a video is reported. A safety refusal is
 * final; a failure that reads as an outage or a hiccup may be submitted again
 * (the task has ended, so a new submission can never run twice).
 */
export function renderFailure(message: string | null): {
  code: "refusal" | "render_failed";
  message: string;
  retryable: boolean;
} {
  if (isSafetyRefusal(message))
    return { code: "refusal", message: friendlyFailure(message), retryable: false };
  return {
    code: "render_failed",
    message: friendlyFailure(message),
    retryable: !!message && TRANSIENT_RE.test(message),
  };
}
