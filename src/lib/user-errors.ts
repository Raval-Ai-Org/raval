// user-errors.ts — what a person is allowed to read when something fails.
//
// Provider balances, key problems, model names and stack details are ours to
// fix, never the user's to see. Pure and browser-safe: the server applies it
// before an error leaves a route or is stored on a job, and the toast wrapper
// applies it again as a last line of defence. The original text always stays in
// the server logs.

const INTERNAL_PATTERNS: RegExp[] = [
  /open\s?router/i,
  /\bkie\b|kie\.ai/i,
  /anthropic|claude-|gemini|gpt-|google\.com\/|fal\.ai|replicate|tavily|firecrawl|rixot|dataforseo|resend|post\s?for\s?me|stripe/i,
  /supabase|postgres|pgrst|\bsql\b|\brls\b|row[- ]level|violates|duplicate key|relation ".*"/i,
  /api[\s_-]?key|secret|bearer|token (?:is )?(?:invalid|expired|missing)|\bsk-[a-z0-9_-]{6,}/i,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+){1,}\b/, // ENV_VAR_NAMES
  /insufficient (?:credits?|funds|balance)|out of credits|no credits|credit(?:s)? (?:limit|balance|exhausted)|payment required|billing hard limit|quota|exceeded your current/i,
  /not configured|misconfigur|set .* on the server|provider|upstream|gateway|endpoint|model (?:is )?(?:unavailable|not found|declined)|declined to answer/i,
  /\bat\s+\S+\s+\(.*:\d+:\d+\)|stack|ECONN|ENOTFOUND|ETIMEDOUT|fetch failed|socket hang up|unexpected token|JSON\.parse/i,
  /\b(?:4\d\d|5\d\d)\b\s*(?:error|status)|status (?:code )?(?:4\d\d|5\d\d)/i,
];

export const GENERIC_ERROR = "Something went wrong on our side. Please try again in a moment.";
export const UNAVAILABLE_ERROR =
  "This isn't available right now. We're working on it — please try again soon.";
export const BUSY_ERROR = "We're very busy right now. Please try again in a minute.";

/** True when the text mentions something only we should see. */
export function isInternalMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return INTERNAL_PATTERNS.some((p) => p.test(message));
}

/** A safe sentence for a provider/HTTP status. */
export function messageForStatus(status?: number): string {
  if (status === 429) return BUSY_ERROR;
  if (status === 503) return UNAVAILABLE_ERROR;
  return GENERIC_ERROR;
}

/** The message itself when it is safe to show, else a plain one. */
export function userSafeMessage(
  message: string | null | undefined,
  fallback: string = GENERIC_ERROR,
): string {
  const text = message?.trim();
  if (!text) return fallback;
  return isInternalMessage(text) ? fallback : text;
}
