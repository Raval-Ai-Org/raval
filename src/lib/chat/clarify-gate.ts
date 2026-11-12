// clarify-gate.ts — whether a first chat message is vague enough to be worth
// a clarifying-questions call (pure).
//
// Every new conversation used to send its first message to /api/clarify, a
// model call, although almost every message already says what it wants. Now
// only a short, bare request to make something ("write a post", "make a
// campaign") asks; a question, a message with specifics, or anything longer
// is answered straight away.

const MAKE_WORDS = /\b(make|create|write|draft|generate|design|plan|build|give me|need|want)\b/i;
const THING_WORDS =
  /\b(post|posts|caption|captions|carousel|reel|reels|video|videos|story|stories|ad|ads|campaign|content|blog|article|email|newsletter|strategy|ideas?|thread|tweet)\b/i;
const SPECIFICS = /["“”'‘’]|\d|https?:\/\/|@|#|\b(about|for|on|launch|sale|offer|event)\b/i;

/** At most this many words counts as a bare request. */
export const BARE_REQUEST_WORDS = 7;

export function shouldAskClarify(text: string): boolean {
  const t = text.trim();
  if (!t || t.endsWith("?")) return false;
  const words = t.split(/\s+/).length;
  if (words > BARE_REQUEST_WORDS) return false;
  if (SPECIFICS.test(t)) return false;
  return MAKE_WORDS.test(t) && THING_WORDS.test(t);
}
